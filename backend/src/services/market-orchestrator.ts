import { EventEmitter } from "events";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { WINDOW_CONFIGS, DEFAULTS } from "../types/index.js";
import {
  getDb,
  createTrade,
  resolveTrade,
  logAudit,
  loadActiveTradesWithMarkets,
} from "../db/client.js";
import * as schema from "../db/schema.js";
import { eq, and, desc, gte } from "drizzle-orm";

import { getMarketScanner, MarketScanner } from "./market-scanner.js";
import {
  getMarketWebSocketWatcher,
  MarketWebSocketWatcher,
} from "./market-ws-watcher.js";
import {
  getStrategyEngine,
  StrategyEngine,
  type MarketOpportunity,
} from "./strategy-engine.js";
import { executeBuyOrder, executeSellOrder } from "./order-executor.js";
import { getBtcPriceWatcher, BtcPriceWatcher } from "./btc-price-watcher.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import { PortfolioManager } from "./portfolio-manager.js";
import { positionTracker } from "./position-tracker.js";
import { balanceManager } from "./balance-manager.js";
import { tradingClient } from "./polymarket-trading-client.js";

import type { MarketResolvedEvent } from "../interfaces/websocket-types.js";

const logger = createModuleLogger("market-orchestrator");

/** Tracks an active market through its lifecycle */
interface ActiveMarketState {
  marketId: string;
  conditionId: string | null;
  yesTokenId: string;
  noTokenId: string;
  question: string;
  slug: string | null;
  endDate: Date;
  targetPrice: number | null;
  btcPriceAtWindowStart: number | null;
  outcomes: string[];
  lastPrices: Record<string, { bid: number; ask: number; mid: number }>;
  subscribedWs: boolean;
  resolved: boolean;
  tickSize: string;
  negRisk: boolean;
}

/** Tracks an open real position during resolution */
interface OpenPosition {
  tradeId: string;
  marketId: string;
  conditionId: string | null;
  tokenId: string;
  outcomeLabel: string;
  entryPrice: number;
  entryShares: number;
  fees: number;
  actualCost: number;
  marketEndDate: Date;
  minPriceDuringPosition: number;
  stopLossTriggered?: boolean;
  polymarketOrderId?: string;
  tickSize: string;
  negRisk: boolean;
}

/**
 * Central coordinator for the PenguinX system.
 *
 * Lifecycle:
 *   1. Scanner finds BTC markets for the configured window
 *   2. Orchestrator subscribes to CLOB WebSocket for real-time prices
 *   3. StrategyEngine evaluates entry conditions on every price update
 *   4. On opportunity: ExecutionSimulator fills a limit buy, trade is persisted
 *   5. After market ends: monitor for resolution via WS + polling
 *   6. Resolve trades as WIN/LOSS via oracle resolution
 */
export class MarketOrchestrator extends EventEmitter {
  private scanner: MarketScanner;
  private wsWatcher: MarketWebSocketWatcher;
  private strategyEngine: StrategyEngine;
  private btcWatcher: BtcPriceWatcher;
  private client: PolymarketClient;
  readonly portfolioManager: PortfolioManager;

  private activeMarkets: Map<string, ActiveMarketState> = new Map();
  /** conditionId → marketId for O(1) lookup on WS market_resolved events */
  private conditionIdMap: Map<string, string> = new Map();
  /** tokenId → marketId reverse index for O(1) lookup on every WS price tick */
  private tokenToMarket: Map<string, string> = new Map();
  private openPositions: Map<string, OpenPosition> = new Map();
  /** marketId → Set<tradeId> for O(1) "has open positions?" checks */
  private positionsByMarket: Map<string, Set<string>> = new Map();
  /** tokenId → Set<tradeId> for O(1) position lookup on price ticks & stop-loss */
  private positionsByToken: Map<string, Set<string>> = new Map();
  /** tokenIds currently being processed by onOpportunity — blocks concurrent duplicate executions */
  private inFlightTokenIds: Set<string> = new Set();
  /** marketIds that still need btcPriceAtWindowStart resolved — used to skip the fill loop when nothing is pending */
  private pendingBtcFills: Set<string> = new Set();
  private resolutionTimers: Map<string, ReturnType<typeof setInterval>> =
    new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** Cached from config at start() — never changes at runtime */
  private windowDurationMs = 5 * 60_000;

  private running = false;
  private paused = false;
  private cycleCount = 0;

  constructor() {
    super();
    this.scanner = getMarketScanner();
    this.wsWatcher = getMarketWebSocketWatcher();
    this.strategyEngine = getStrategyEngine();
    this.btcWatcher = getBtcPriceWatcher();
    this.client = getPolymarketClient();
    this.portfolioManager = new PortfolioManager();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const config = getConfig();
    this.windowDurationMs =
      WINDOW_CONFIGS[config.strategy.marketWindow]?.durationMs ?? 5 * 60_000;
    const windowLabel = WINDOW_CONFIGS[config.strategy.marketWindow].label;

    // Initialise portfolio (creates DB row on first run, reloads on restart)
    await this.portfolioManager.init();

    logger.info(
      {
        window: config.strategy.marketWindow,
        label: windowLabel,
        threshold: config.strategy.entryPriceThreshold,
        tradeWindowSec: config.strategy.tradeFromWindowSeconds,
        maxPositions: DEFAULTS.MAX_SIMULTANEOUS_POSITIONS,
      },
      "Starting market orchestrator",
    );

    // Load any existing open trades from DB
    await this.loadOpenPositions();

    // Load any existing active markets from DB
    await this.loadActiveMarkets();

    // Try to fill BTC prices for loaded markets
    this.tryFillBtcWindowStart();

    // Wire up event handlers
    this.wireEvents();

    // Start child services
    this.wsWatcher.start();
    await this.scanner.start();

    // Start periodic cleanup of expired markets without positions (every 10s)
    this.cleanupTimer = setInterval(() => this.cleanupExpiredMarkets(), 10_000);

    logger.info("Market orchestrator fully started");
  }

  stop(): void {
    this.running = false;
    this.scanner.stop();
    this.wsWatcher.stop();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [marketId, timer] of this.resolutionTimers) {
      clearTimeout(timer);
    }
    this.resolutionTimers.clear();

    logger.info("Market orchestrator stopped");
  }

  /**
   * Pause new trade entries. Existing open positions continue to be
   * tracked and resolved normally. Scanner stops but WS stays alive.
   */
  pause(): void {
    this.paused = true;
    this.scanner.stop();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    logger.warn("System paused — new positions blocked, existing tracked");
  }

  /**
   * Resume trading after a pause. Restarts the scanner and cleanup timer.
   */
  async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;

    // Reload portfolio state in case admin wiped + reset
    await this.portfolioManager.reload();

    // Restart scanner and cleanup
    await this.scanner.start();
    this.cleanupTimer = setInterval(() => this.cleanupExpiredMarkets(), 10_000);

    logger.info("System resumed — trading active");
  }

  isPaused(): boolean {
    return this.paused;
  }

  getStats() {
    const config = getConfig();
    const momentum = this.btcWatcher.getMomentum(
      DEFAULTS.MOMENTUM_LOOKBACK_MS,
      DEFAULTS.MOMENTUM_MIN_CHANGE_USD,
    );
    return {
      running: this.running,
      paused: this.paused,
      activeMarkets: this.activeMarkets.size,
      openPositions: this.openPositions.size,
      cycleCount: this.cycleCount,
      scanner: {
        discoveredCount: this.scanner.getDiscoveredCount(),
      },
      ws: this.wsWatcher.getStats(),
      strategy: this.strategyEngine.getStats(),
      btcConnected: this.btcWatcher.isConnected(),
      btcPrice: this.btcWatcher.getCurrentPrice()?.price ?? null,
      btcPriceAgeMs: this.btcWatcher.getPriceAgeMs(),
      btcPriceFresh: this.btcWatcher.isPriceFresh(),
      momentum,
    };
  }

  getLiveMarkets() {
    const now = Date.now();
    return Array.from(this.activeMarkets.values())
      .filter((m) => !m.resolved)
      .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())
      .map((m) => {
        const hasPosition = this.hasOpenPositionsForMarket(m.marketId);
        const windowStartMs = m.endDate.getTime() - this.windowDurationMs;
        // Three-state status:
        //   UPCOMING  — window has not yet opened (price to beat unknown)
        //   ACTIVE    — window is currently open (trading live)
        //   ENDED     — window closed, awaiting oracle resolution
        const status: "ACTIVE" | "ENDED" | "UPCOMING" =
          m.endDate.getTime() <= now
            ? "ENDED"
            : windowStartMs <= now
              ? "ACTIVE"
              : "UPCOMING";

        return {
          marketId: m.marketId,
          question: m.question,
          slug: m.slug,
          endDate: m.endDate.toISOString(),
          windowStart: new Date(windowStartMs).toISOString(),
          yesTokenId: m.yesTokenId,
          noTokenId: m.noTokenId,
          prices: { ...m.lastPrices },
          status,
          hasPosition,
          btcPriceAtWindowStart: m.btcPriceAtWindowStart,
        };
      });
  }

  /**
   * Returns the total cost basis of all open positions (cash invested, not mark-to-market).
   * value = sum( actualCost ) for each open position.
   * This gives the "invested amount" for portfolio display: cashBalance + openPositionsValue = total capital deployed.
   */
  computeOpenPositionsValue(): number {
    let total = 0;
    for (const pos of this.openPositions.values()) {
      total += pos.actualCost;
    }
    return total;
  }

  // ── Position index helpers ──────────────────────────────────────────────────

  /** Add a position and update all secondary indexes */
  private trackPosition(pos: OpenPosition): void {
    this.openPositions.set(pos.tradeId, pos);

    // marketId → tradeIds
    let byMarket = this.positionsByMarket.get(pos.marketId);
    if (!byMarket) {
      byMarket = new Set();
      this.positionsByMarket.set(pos.marketId, byMarket);
    }
    byMarket.add(pos.tradeId);

    // tokenId → tradeIds
    let byToken = this.positionsByToken.get(pos.tokenId);
    if (!byToken) {
      byToken = new Set();
      this.positionsByToken.set(pos.tokenId, byToken);
    }
    byToken.add(pos.tradeId);

    this.strategyEngine.setOpenPositionCount(this.openPositions.size);
  }

  /** Remove a position and update all secondary indexes */
  private untrackPosition(tradeId: string): void {
    const pos = this.openPositions.get(tradeId);
    if (!pos) return;
    this.openPositions.delete(tradeId);

    const byMarket = this.positionsByMarket.get(pos.marketId);
    if (byMarket) {
      byMarket.delete(tradeId);
      if (byMarket.size === 0) this.positionsByMarket.delete(pos.marketId);
    }

    const byToken = this.positionsByToken.get(pos.tokenId);
    if (byToken) {
      byToken.delete(tradeId);
      if (byToken.size === 0) this.positionsByToken.delete(pos.tokenId);
    }

    this.strategyEngine.setOpenPositionCount(this.openPositions.size);
  }

  /** O(1) check: does this market have any open positions? */
  private hasOpenPositionsForMarket(marketId: string): boolean {
    const set = this.positionsByMarket.get(marketId);
    return set !== undefined && set.size > 0;
  }

  /** Register a new market state and update all secondary indexes */
  private registerMarketState(state: ActiveMarketState): void {
    this.activeMarkets.set(state.marketId, state);
    this.tokenToMarket.set(state.yesTokenId, state.marketId);
    this.tokenToMarket.set(state.noTokenId, state.marketId);
    if (state.conditionId) {
      this.conditionIdMap.set(state.conditionId, state.marketId);
    }
  }

  private wireEvents(): void {
    // Scanner → new market discovered
    this.scanner.on("newMarket", async ({ market }) => {
      try {
        await this.onNewMarket(market);
      } catch (err) {
        logger.error(
          { err, marketId: market?.id },
          "Error handling new market",
        );
      }
    });

    // WS → token price updates (both events carry best_bid/best_ask)
    const handlePriceEvent = (ev: {
      tokenId: string;
      bestBid: string;
      bestAsk: string;
    }) =>
      this.onTokenPriceUpdate(
        ev.tokenId,
        parseFloat(ev.bestBid),
        parseFloat(ev.bestAsk),
      );
    this.wsWatcher.on("priceUpdate", handlePriceEvent);
    this.wsWatcher.on("bestBidAskUpdate", handlePriceEvent);

    // WS → market resolution
    this.wsWatcher.on("marketResolved", (ev: MarketResolvedEvent) =>
      this.onMarketResolved(ev),
    );

    // BTC price tick → try to fill window-start price for open markets.
    this.btcWatcher.on("btcPriceUpdate", () => this.tryFillBtcWindowStart());

    // Strategy → opportunity detected
    this.strategyEngine.on("opportunityDetected", (opp: MarketOpportunity) => {
      this.onOpportunity(opp).catch((err) => {
        logger.error(
          { err, marketId: opp.marketId },
          "Error handling opportunity",
        );
      });
    });
  }

  /**
   * Fill btcPriceAtWindowStart for any market whose window is now open.
   *
   * Strategy:
   *  1. If our price history predates the window start, use getPriceAt() for
   *     accuracy.  This is the normal case for markets discovered while running.
   *  2. Otherwise (server restarted mid-window, no history covering that moment),
   *     skip the historical lookup entirely and use the current live BTC price.
   *     This avoids flooding the log with repeated "No historical BTC price"
   *     warnings on every price tick while we wait for the BTC WS to connect.
   *  3. If current price is also null (BTC WS not yet connected), silently wait
   *     for the next tick — we’ll fill as soon as the first price arrives.
   */
  private tryFillBtcWindowStart(): void {
    // Fast-path: nothing is waiting — skip the entire loop.
    if (this.pendingBtcFills.size === 0) return;

    const nowMs = Date.now();

    for (const marketId of this.pendingBtcFills) {
      const state = this.activeMarkets.get(marketId);
      if (!state || state.btcPriceAtWindowStart !== null) {
        // Market removed or already filled — clean up the set.
        this.pendingBtcFills.delete(marketId);
        continue;
      }

      const windowStartMs = state.endDate.getTime() - this.windowDurationMs;
      if (nowMs < windowStartMs) continue; // window not open yet — wait

      let resolved: number | null = null;
      let source: "historical" | "current" = "historical";

      // Only attempt a historical lookup if our buffer actually predates the
      // window start.  If the oldest history entry is newer than windowStartMs
      // (or the buffer is empty), getPriceAt() will always return null — no
      // point calling it and producing noise.
      const oldestHistoryMs = this.btcWatcher.getOldestHistoryTimestamp();
      if (oldestHistoryMs !== null && oldestHistoryMs <= windowStartMs) {
        resolved = this.btcWatcher.getPriceAt(windowStartMs);
      }

      // Fallback: use current live price.  This is the expected path for
      // markets that were already open when the server (re)started.
      if (resolved === null) {
        const current = this.btcWatcher.getCurrentPrice();
        if (current !== null) {
          resolved = current.price;
          source = "current";
        }
      }

      if (resolved === null) continue; // BTC not connected yet — wait silently

      state.btcPriceAtWindowStart = resolved;
      this.pendingBtcFills.delete(marketId);

      logger.info(
        {
          marketId: state.marketId,
          btcPrice: resolved,
          source,
          ...(source === "current" ? { windowStartMs } : {}),
        },
        source === "current"
          ? "btcPriceAtWindowStart filled (current price — no history covering window start)"
          : "btcPriceAtWindowStart filled (historical)",
      );

      // For relative Up/Down markets the window-start price is the target.
      if (state.targetPrice === null) {
        this.strategyEngine.updateTargetPrice(state.yesTokenId, resolved);
        this.strategyEngine.updateTargetPrice(state.noTokenId, resolved);
      }
    }
  }

  /**
   * Handle a newly discovered market from the scanner.
   */
  private async onNewMarket(market: any): Promise<void> {
    if (this.paused) return;
    if (this.activeMarkets.has(market.id)) return;

    const tokenIds = PolymarketClient.parseClobTokenIds(market);
    const outcomes = PolymarketClient.parseOutcomes(market);
    const targetPrice = PolymarketClient.parseTargetPrice(market.question);

    if (tokenIds.length < 2 || outcomes.length < 2) {
      logger.warn(
        { marketId: market.id },
        "Market missing token IDs or outcomes",
      );
      return;
    }

    const endDate = market.endDate ? new Date(market.endDate) : new Date();

    // Skip already-expired markets (Gamma may return old unresolved ones).
    if (endDate.getTime() < Date.now()) {
      logger.debug(
        { marketId: market.id, endDate: endDate.toISOString() },
        "Skipping expired market",
      );
      return;
    }

    // Pre-fill btcPriceAtWindowStart if the window is already open.
    // If not, tryFillBtcWindowStart() will set it on the next BTC tick.
    const windowStartMs = endDate.getTime() - this.windowDurationMs;
    const btcPriceAtWindowStart =
      windowStartMs <= Date.now()
        ? (this.btcWatcher.getPriceAt(windowStartMs) ??
          this.btcWatcher.getCurrentPrice()?.price ??
          null)
        : null;

    const state: ActiveMarketState = {
      marketId: market.id,
      conditionId: market.conditionId ?? null,
      yesTokenId: tokenIds[0]!,
      noTokenId: tokenIds[1]!,
      question: market.question ?? "",
      slug: market.slug ?? null,
      endDate,
      targetPrice,
      btcPriceAtWindowStart,
      outcomes,
      lastPrices: {},
      subscribedWs: false,
      resolved: false,
      tickSize: "0.01",
      negRisk: false,
    };

    this.registerMarketState(state);
    // Only queue for fill if the window-start price wasn't resolved inline above.
    if (state.btcPriceAtWindowStart === null) {
      this.pendingBtcFills.add(market.id);
    }
    // Don't call tryFillBtcWindowStart() here — the next BTC tick will handle it.

    // Register both tokens with the strategy engine.
    // effectiveTargetPrice is null for relative Up/Down markets until tryFillBtcWindowStart sets it.
    const effectiveTargetPrice = targetPrice ?? btcPriceAtWindowStart;
    for (let i = 0; i < tokenIds.length; i++) {
      this.strategyEngine.registerMarket(
        market.id,
        tokenIds[i]!,
        outcomes[i] ?? `Outcome${i}`,
        endDate,
        effectiveTargetPrice,
      );
    }

    // Subscribe to WebSocket for real-time data
    this.wsWatcher.subscribe(tokenIds);
    state.subscribedWs = true;

    logger.info(
      {
        marketId: market.id,
        question: market.question,
        endDate: endDate.toISOString(),
        targetPrice,
        tokens: tokenIds.length,
      },
      "New market activated",
    );
  }

  /**
   * Handle token price updates from CLOB WebSocket.
   * Called by both price_change and best_bid_ask event types — both carry the
   * same data and require the same actions (cache price, evaluate strategy, check stop-loss).
   */
  private onTokenPriceUpdate(
    tokenId: string,
    bestBid: number,
    bestAsk: number,
  ): void {
    // O(1) lookup via reverse index
    const marketId = this.tokenToMarket.get(tokenId);
    if (marketId) {
      const state = this.activeMarkets.get(marketId);
      if (state && state.endDate > new Date()) {
        const mid = (bestBid + bestAsk) / 2;
        state.lastPrices[tokenId] = { bid: bestBid, ask: bestAsk, mid };
      }
      // else: market window ended — freeze prices until trade is settled
    }

    // Track lowest bestBid for open positions on this token (O(1) index lookup)
    // Only track during active market window (until window close)
    const tradeIds = this.positionsByToken.get(tokenId);
    if (tradeIds && marketId) {
      const state = this.activeMarkets.get(marketId);
      if (state && state.endDate > new Date()) {
        for (const tradeId of tradeIds) {
          const pos = this.openPositions.get(tradeId);
          if (pos && bestBid < pos.minPriceDuringPosition) {
            pos.minPriceDuringPosition = bestBid;
          }
        }
      }
    }

    const config = getConfig();
    const momentumSignal = this.btcWatcher.getMomentum(
      DEFAULTS.MOMENTUM_LOOKBACK_MS,
      DEFAULTS.MOMENTUM_MIN_CHANGE_USD,
    );

    this.strategyEngine.evaluatePrice(
      tokenId,
      bestBid,
      bestAsk,
      this.btcWatcher.getCurrentPrice(),
      momentumSignal,
    );

    this.checkStopLoss(tokenId, bestBid);
  }

  /**
   * Handle WebSocket market resolution event.
   * Uses in-memory conditionId → marketId map for O(1) lookup.
   */
  private async onMarketResolved(ev: MarketResolvedEvent): Promise<void> {
    const { conditionId, winningAssetId, winningOutcome } = ev;

    logger.info(
      { conditionId, winningAssetId, winningOutcome },
      "Market resolved via WebSocket",
    );

    // O(1) lookup via in-memory map
    const marketId = this.conditionIdMap.get(conditionId);
    if (!marketId) {
      // Fallback: DB lookup in case map missed it
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.markets)
        .where(eq(schema.markets.conditionId, conditionId))
        .limit(1);
      if (!row) return;

      const state = this.activeMarkets.get(row.id);
      if (!state || state.resolved) return;
      state.resolved = true;
      await this.resolvePositionsForMarket(
        row.id,
        winningAssetId,
        winningOutcome,
      );
      return;
    }

    const state = this.activeMarkets.get(marketId);
    if (!state || state.resolved) return;
    state.resolved = true;
    await this.resolvePositionsForMarket(
      marketId,
      winningAssetId,
      winningOutcome,
    );
  }

  /**
   * Execute a real FAK (Fill-And-Kill) buy order on Polymarket when the strategy
   * detects an opportunity.
   *
   * Flow:
   *   1. Compute position budget from real Polymarket balance
   *   2. Determine worst-case price from config
   *   3. Place real market buy order via SDK
   *   4. Track position and register with position-tracker for WS updates
   */
  private async onOpportunity(opp: MarketOpportunity): Promise<void> {
    if (this.paused) return;

    // Guard against concurrent executions for the same token
    if (this.inFlightTokenIds.has(opp.tokenId)) {
      logger.debug(
        { tokenId: opp.tokenId, marketId: opp.marketId },
        "onOpportunity skipped — already in-flight for this token",
      );
      return;
    }
    this.inFlightTokenIds.add(opp.tokenId);

    const config = getConfig();
    const market = this.activeMarkets.get(opp.marketId);

    try {
      // ── 1. Compute position budget from real balance ──
      const positionBudget =
        await this.portfolioManager.computePositionBudget();

      if (positionBudget <= 0) {
        logger.info(
          { balance: await balanceManager.getBalance() },
          "Insufficient Polymarket balance — skipping",
        );
        return;
      }

      // ── 2. Capture momentum context ──
      const momentum = this.btcWatcher.getMomentum(
        DEFAULTS.MOMENTUM_LOOKBACK_MS,
        DEFAULTS.MOMENTUM_MIN_CHANGE_USD,
      );

      // ── 3. Place real order via SDK ──
      const orderResult = await executeBuyOrder({
        tokenId: opp.tokenId,
        conditionId: market?.conditionId ?? undefined,
        marketId: opp.marketId,
        marketCategory: undefined,
        windowType: config.strategy.marketWindow,
        outcomeLabel: opp.outcomeLabel,
        positionBudget,
        worstPrice: config.strategy.maxEntryPrice,
        tickSize: market?.tickSize ?? "0.01",
        negRisk: market?.negRisk ?? false,
        btcPriceAtEntry: opp.btcPrice,
        btcTargetPrice: opp.btcTargetPrice,
        btcDistanceUsd: opp.btcDistanceUsd,
        momentumDirection: momentum?.direction ?? undefined,
        momentumChangeUsd: momentum ? Math.abs(momentum.changeUsd) : undefined,
      });

      if (!orderResult.success) {
        logger.warn(
          { error: orderResult.errorMessage, tokenId: opp.tokenId },
          "Buy order failed — will retry on next opportunity",
        );
        this.strategyEngine.clearEvaluated(opp.tokenId);
        return;
      }

      const filledShares = orderResult.filledShares ?? 0;
      const avgPrice = orderResult.avgPrice ?? config.strategy.maxEntryPrice;
      const totalCost = orderResult.totalCost ?? positionBudget;

      if (filledShares <= 0) {
        logger.warn({ tokenId: opp.tokenId }, "Zero fill — order not matched");
        this.strategyEngine.clearEvaluated(opp.tokenId);
        return;
      }

      // ── 4. Track position and register with position-tracker ──
      // The trade was already persisted by executeBuyOrder — we need the trade ID
      // We'll look it up by the polymarket order ID
      const db = getDb();
      const [tradeRow] = await db
        .select()
        .from(schema.trades)
        .where(eq(schema.trades.polymarketOrderId, orderResult.orderID!))
        .limit(1);

      if (!tradeRow) {
        logger.error(
          { orderID: orderResult.orderID },
          "Trade row not found after order execution",
        );
        return;
      }

      const tradeId = tradeRow.id;

      this.trackPosition({
        tradeId,
        marketId: opp.marketId,
        conditionId: market?.conditionId ?? null,
        tokenId: opp.tokenId,
        outcomeLabel: opp.outcomeLabel,
        entryPrice: avgPrice,
        entryShares: filledShares,
        fees: 0, // SDK handles fees
        actualCost: totalCost,
        marketEndDate: market?.endDate ?? new Date(),
        minPriceDuringPosition: avgPrice,
        polymarketOrderId: orderResult.orderID,
        tickSize: market?.tickSize ?? "0.01",
        negRisk: market?.negRisk ?? false,
      });

      // Register with position tracker for User WS updates
      if (orderResult.orderID) {
        positionTracker.trackOrder(orderResult.orderID, tradeId);
      }
      // Subscribe to User WS for this market's condition ID
      if (market?.conditionId) {
        positionTracker.subscribeMarket(market.conditionId);
      }

      this.scheduleResolutionMonitor(opp.marketId);

      const balance = await balanceManager.getBalance();
      await logAudit(
        "info",
        "TRADE_OPENED",
        `Trade ${tradeId} opened for ${opp.outcomeLabel}`,
        {
          tradeId,
          orderID: orderResult.orderID,
          tokenId: opp.tokenId,
          outcome: opp.outcomeLabel,
          avgPrice,
          shares: filledShares,
          positionBudget,
          actualCost: totalCost,
          btcPrice: opp.btcPrice,
          btcTarget: opp.btcTargetPrice,
          btcDistance: opp.btcDistanceUsd,
          secondsToEnd: opp.secondsToEnd,
          balanceRemaining: balance,
        },
      );

      this.cycleCount++;
      this.emit("tradeOpened", {
        tradeId,
        trade: tradeRow,
        ...opp,
        orderResult,
      });

      logger.info(
        {
          tradeId,
          orderID: orderResult.orderID,
          marketId: opp.marketId,
          outcome: opp.outcomeLabel,
          avgPrice: avgPrice.toFixed(4),
          shares: filledShares.toFixed(2),
          budget: positionBudget.toFixed(2),
          actualCost: totalCost.toFixed(4),
          btcPrice: opp.btcPrice.toFixed(2),
          btcDistance: opp.btcDistanceUsd.toFixed(2),
          balanceRemaining: balance.toFixed(2),
        },
        "📈 Real trade opened on Polymarket",
      );
    } catch (error) {
      logger.error(
        { error, marketId: opp.marketId, tokenId: opp.tokenId },
        "Failed to execute trade",
      );
      logAudit(
        "error",
        "SYSTEM",
        `Failed to execute trade for market ${opp.marketId}: ${error instanceof Error ? error.message : String(error)}`,
      ).catch(() => {});
    } finally {
      this.inFlightTokenIds.delete(opp.tokenId);
    }
  }

  // ── Stop-Loss ───────────────────────────────────────────────────────────────

  /**
   * Trigger stop-loss for any open position on `tokenId` when the bid falls
   * below the configured trigger price.
   *
   * IMPORTANT: Only fires while the market window is still OPEN (endDate > now).
   * After the window closes, all token prices drop naturally toward 0.50 during
   * the oracle resolution phase — triggering stop-loss then would incorrectly
   * close winning positions.
   */
  private checkStopLoss(tokenId: string, bestBid: number): void {
    const config = getConfig();

    const now = Date.now();
    const tradeIds = this.positionsByToken.get(tokenId);
    if (!tradeIds) return;

    for (const tradeId of tradeIds) {
      const pos = this.openPositions.get(tradeId);
      if (!pos) continue;
      if (pos.stopLossTriggered) continue;
      // 🔑 Critical guard: stop-loss must ONLY fire while the market window is open.
      // After endDate, prices drift to ~0.50 during settlement — this would
      // incorrectly trigger stop-loss on winning positions.
      if (pos.marketEndDate.getTime() <= now) continue;

      if (bestBid < config.strategy.stopLossPriceTrigger) {
        pos.stopLossTriggered = true;
        logger.warn(
          {
            tradeId,
            tokenId,
            bestBid: bestBid.toFixed(4),
            trigger: config.strategy.stopLossPriceTrigger,
          },
          `Stop-loss triggered: bid ${bestBid.toFixed(4)} < ${config.strategy.stopLossPriceTrigger} trigger`,
        );
        this.executeStopLoss(tradeId, pos, bestBid).catch((err) => {
          logger.error({ err, tradeId }, "Stop-loss execution failed");
          const position = this.openPositions.get(tradeId);
          if (position) position.stopLossTriggered = false;
        });
      }
    }
  }

  private async executeStopLoss(
    tradeId: string,
    pos: OpenPosition,
    triggerBid: number,
  ): Promise<void> {
    try {
      const sellResult = await executeSellOrder({
        tokenId: pos.tokenId,
        shares: pos.entryShares,
        worstPrice: 0.01,
        tickSize: pos.tickSize,
        negRisk: pos.negRisk,
        tradeId,
      });

      let exitPrice: number;
      let exitOrderId: string | undefined;

      if (sellResult.success) {
        exitPrice = sellResult.avgPrice ?? triggerBid;
        exitOrderId = sellResult.orderID;
      } else {
        exitPrice = triggerBid;
        logger.warn(
          { tradeId, error: sellResult.errorMessage },
          "Stop-loss sell order failed — resolving with trigger bid",
        );
      }

      const pnl = (exitPrice - pos.entryPrice) * pos.entryShares;
      await this.settleTrade(
        tradeId,
        pos,
        "STOP_LOSS",
        pnl,
        exitPrice,
        exitOrderId,
        "STOP_LOSS",
        "warn",
      );
    } catch (error) {
      logger.error({ error, tradeId }, "Stop-loss execution error");
      logAudit(
        "error",
        "SYSTEM",
        `Stop-loss execution error for trade ${tradeId}: ${error instanceof Error ? error.message : String(error)}`,
      ).catch(() => {});
      const position = this.openPositions.get(tradeId);
      if (position) position.stopLossTriggered = false;
    }
  }

  /**
   * Schedule persistent resolution polling for a market.
   *
   * Polls every 5s for the first 2 minutes (when auto-resolution typically fires),
   * then backs off to every 30s. After 30 minutes hard-timeout: force-resolve as
   * LOSS so positions never stay open indefinitely.
   */
  private scheduleResolutionMonitor(marketId: string): void {
    if (this.resolutionTimers.has(marketId)) return;

    const FAST_INTERVAL = 5_000; // 5s
    const SLOW_INTERVAL = 30_000; // 30s
    const FAST_PHASE_MS = 2 * 60_000; // 2 min of fast polling
    const HARD_TIMEOUT_MS = 30 * 60_000; // 30 min hard cutoff
    const startTime = Date.now();

    const poll = async () => {
      if (!this.running) {
        clearTimeout(timerId);
        this.resolutionTimers.delete(marketId);
        return;
      }

      // Check if any positions still exist for this market
      const hasPositions = this.hasOpenPositionsForMarket(marketId);
      if (!hasPositions) {
        clearTimeout(timerId);
        this.resolutionTimers.delete(marketId);
        return;
      }

      const elapsed = Date.now() - startTime;

      // Hard timeout: force close remaining positions
      if (elapsed > HARD_TIMEOUT_MS) {
        clearTimeout(timerId);
        this.resolutionTimers.delete(marketId);
        await this.forceResolveExpired(marketId);
        return;
      }

      // Try to poll for resolution
      await this.pollResolution(marketId);

      // Schedule next poll (fast for first 2 min, slow after)
      const interval = elapsed < FAST_PHASE_MS ? FAST_INTERVAL : SLOW_INTERVAL;
      timerId = setTimeout(poll, interval);
      this.resolutionTimers.set(marketId, timerId);
    };

    // Start first poll after a short delay (market just ended)
    let timerId = setTimeout(poll, FAST_INTERVAL);
    this.resolutionTimers.set(marketId, timerId);
  }

  /**
   * Poll Gamma API for market resolution status.
   */
  private async pollResolution(marketId: string): Promise<void> {
    try {
      const market = await this.client.getMarketById(marketId);
      if (!market) return;

      // Check resolved status — market is resolved when closed and prices hit 1/0
      if (!market.closed) return;

      const state = this.activeMarkets.get(marketId);
      if (state) state.resolved = true;

      // Determine winning token
      const outcomes = PolymarketClient.parseOutcomes(market);
      const prices = PolymarketClient.parseOutcomePrices(market);
      const tokenIds = PolymarketClient.parseClobTokenIds(market);

      let winningTokenId: string | null = null;
      let winningOutcome: string | null = null;

      for (let i = 0; i < outcomes.length; i++) {
        const price = prices[i] ?? 0;
        if (price >= 0.99) {
          winningTokenId = tokenIds[i] ?? null;
          winningOutcome = outcomes[i] ?? null;
          break;
        }
      }

      if (winningTokenId && winningOutcome) {
        await this.resolvePositionsForMarket(
          marketId,
          winningTokenId,
          winningOutcome,
        );

        // Clean up timer
        const timer = this.resolutionTimers.get(marketId);
        if (timer) {
          clearInterval(timer);
          this.resolutionTimers.delete(marketId);
        }
      }
    } catch (error) {
      logger.error({ error, marketId }, "Resolution poll failed");
      logAudit(
        "error",
        "SYSTEM",
        `Resolution poll failed for market ${marketId}: ${error instanceof Error ? error.message : String(error)}`,
      ).catch(() => {});
    }
  }

  /**
   * Settle a single trade: persist outcome, untrack, audit, and emit event.
   */
  private async settleTrade(
    tradeId: string,
    pos: OpenPosition,
    outcome: "WIN" | "LOSS" | "STOP_LOSS",
    pnl: number,
    exitPrice: number,
    exitOrderId?: string,
    auditCategory = "TRADE_RESOLVED",
    auditLevel: "info" | "warn" = "info",
  ): Promise<void> {
    const resolvedTrade = await resolveTrade(
      tradeId,
      outcome,
      pnl.toFixed(6),
      exitPrice.toFixed(6),
      pos.minPriceDuringPosition.toFixed(8),
      exitOrderId,
    );

    if (pos.polymarketOrderId) {
      positionTracker.untrackOrder(pos.polymarketOrderId);
    }

    this.untrackPosition(tradeId);
    balanceManager.invalidate();

    const isWin = outcome === "WIN" || (outcome === "STOP_LOSS" && pnl > 0);

    await logAudit(
      auditLevel,
      auditCategory,
      `Trade ${tradeId} ${outcome}: PnL ${pnl.toFixed(4)}`,
      { tradeId, marketId: pos.marketId, outcome, exitPrice, exitOrderId, pnl },
    );

    logger.info(
      {
        tradeId,
        marketId: pos.marketId,
        outcome,
        pnl: pnl.toFixed(4),
        exitPrice,
      },
      outcome === "WIN"
        ? "✅ Trade WON"
        : outcome === "STOP_LOSS"
          ? "🛑 Stop-loss"
          : "❌ Trade LOST",
    );

    this.emit("tradeResolved", {
      tradeId,
      isWin,
      pnl,
      exitPrice,
      trade: resolvedTrade,
    });
  }

  /**
   * Resolve all open positions for a market.
   */
  private async resolvePositionsForMarket(
    marketId: string,
    winningTokenId: string,
    _winningOutcome: string,
  ): Promise<void> {
    for (const [tradeId, pos] of this.openPositions) {
      if (pos.marketId !== marketId) continue;

      const isWin = pos.tokenId === winningTokenId;
      const exitPrice = isWin ? 1.0 : 0.0;
      const pnl = isWin ? pos.entryShares - pos.actualCost : -pos.actualCost;

      await this.settleTrade(
        tradeId,
        pos,
        isWin ? "WIN" : "LOSS",
        pnl,
        exitPrice,
      );

      // Redeem winning tokens from CTF contract
      if (isWin && pos.conditionId) {
        tradingClient
          .redeemPositions(pos.conditionId)
          .catch((err) =>
            logger.warn(
              { error: err, tradeId, conditionId: pos.conditionId },
              "Auto-redeem failed — redeem manually",
            ),
          );
      }
    }

    if (!this.hasOpenPositionsForMarket(marketId)) {
      this.cleanupMarket(marketId);
    }
  }

  /**
   * Force-resolve expired positions after resolution watch hard timeout.
   */
  private async forceResolveExpired(marketId: string): Promise<void> {
    await this.pollResolution(marketId);

    const remaining: [string, OpenPosition][] = [];
    for (const [tradeId, pos] of this.openPositions) {
      if (pos.marketId === marketId) remaining.push([tradeId, pos]);
    }

    for (const [tradeId, pos] of remaining) {
      await this.settleTrade(
        tradeId,
        pos,
        "LOSS",
        -pos.actualCost,
        0,
        undefined,
        "TRADE_FORCE_RESOLVED",
        "warn",
      );
    }
  }

  /**
   * Load existing open trades from the database on startup (single JOIN query).
   */
  private async loadOpenPositions(): Promise<void> {
    const rows = await loadActiveTradesWithMarkets();

    for (const { trade, marketEndDate } of rows) {
      this.trackPosition({
        tradeId: trade.id,
        marketId: trade.marketId ?? "",
        conditionId: trade.conditionId ?? null,
        tokenId: trade.tokenId ?? "",
        outcomeLabel: trade.outcomeLabel ?? "",
        entryPrice: parseFloat(trade.entryPrice ?? "0"),
        entryShares: parseFloat(trade.entryShares ?? "0"),
        fees: parseFloat(trade.entryFees ?? "0"),
        actualCost: parseFloat(trade.actualCost ?? "0"),
        marketEndDate: marketEndDate ? new Date(marketEndDate) : new Date(),
        minPriceDuringPosition: parseFloat(
          trade.minPriceDuringPosition &&
            parseFloat(trade.minPriceDuringPosition) > 0
            ? trade.minPriceDuringPosition
            : (trade.entryPrice ?? "0"),
        ),
        polymarketOrderId: trade.polymarketOrderId ?? undefined,
        tickSize: "0.01",
        negRisk: false,
      });

      // Register with position tracker for User WS updates
      if (trade.polymarketOrderId) {
        positionTracker.trackOrder(trade.polymarketOrderId, trade.id);
      }
      // Subscribe User WS for this market's condition ID
      if (trade.conditionId) {
        positionTracker.subscribeMarket(trade.conditionId);
      }

      // Set up resolution monitoring for existing positions
      if (trade.marketId) this.scheduleResolutionMonitor(trade.marketId);
    }

    if (rows.length > 0) {
      logger.info(
        { count: rows.length },
        "Loaded existing open positions from database",
      );
    }
  }

  /**
   * Load existing active markets from the database on startup.
   * Only loads markets that are:
   * - Active in DB
   * - Match current window configuration
   * - Have end dates in the future, or recently past if they have open positions
   */
  private async loadActiveMarkets(): Promise<void> {
    const config = getConfig();
    const windowConfig = WINDOW_CONFIGS[config.strategy.marketWindow];
    const db = getDb();

    // Load markets that are active and match our window type
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const marketRows = await db
      .select()
      .from(schema.markets)
      .where(
        and(
          eq(schema.markets.active, true),
          eq(schema.markets.windowType, config.strategy.marketWindow),
          gte(schema.markets.endDate, cutoff.toISOString()),
        ),
      )
      .orderBy(desc(schema.markets.endDate))
      .limit(50);

    for (const row of marketRows) {
      // Skip if already loaded
      if (this.activeMarkets.has(row.id)) continue;

      const tokenIds = row.clobTokenIds as string[] | null;
      const outcomes = row.outcomes as string[] | null;

      if (
        !tokenIds ||
        tokenIds.length < 2 ||
        !outcomes ||
        outcomes.length < 2
      ) {
        logger.warn(
          { marketId: row.id },
          "Skipping market with invalid token IDs or outcomes",
        );
        continue;
      }

      const endDate = row.endDate ? new Date(row.endDate) : new Date();
      const targetPrice = row.targetPrice ? parseFloat(row.targetPrice) : null;

      // Check if this market has open positions
      const hasOpenPositions = this.hasOpenPositionsForMarket(row.id);

      // Skip markets that ended more than 30 minutes ago and have no open positions
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
      if (endDate.getTime() < thirtyMinutesAgo && !hasOpenPositions) {
        continue;
      }

      const state: ActiveMarketState = {
        marketId: row.id,
        conditionId: row.conditionId ?? null,
        yesTokenId: tokenIds[0]!,
        noTokenId: tokenIds[1]!,
        question: row.question ?? "",
        slug: row.slug ?? null,
        endDate,
        targetPrice,
        btcPriceAtWindowStart: null, // Will be filled by tryFillBtcWindowStart
        outcomes,
        lastPrices: {},
        subscribedWs: false,
        resolved: false,
        tickSize: row.tickSize ?? "0.01",
        negRisk: row.negRisk ?? false,
      };

      this.registerMarketState(state);
      this.pendingBtcFills.add(row.id);

      // Register both tokens with the strategy engine
      const effectiveTargetPrice = targetPrice ?? null; // btcPriceAtWindowStart will be set later
      for (let i = 0; i < tokenIds.length; i++) {
        this.strategyEngine.registerMarket(
          row.id,
          tokenIds[i]!,
          outcomes[i] ?? `Outcome${i}`,
          endDate,
          effectiveTargetPrice,
        );
      }

      // Subscribe to WebSocket for real-time data
      this.wsWatcher.subscribe(tokenIds);
      state.subscribedWs = true;

      // For ENDED markets with open positions, the CLOB has stopped streaming.
      // Fetch current midpoints once via REST so lastPrices is seeded immediately
      // and the frontend can show a real price rather than a blank on first load.
      if (endDate.getTime() < Date.now() && hasOpenPositions) {
        this.seedLastPricesForEndedMarket(state).catch((err) =>
          logger.debug(
            { err, marketId: row.id },
            "Could not seed prices for ended market — will show pending",
          ),
        );
      }

      logger.info(
        {
          marketId: row.id,
          question: row.question,
          endDate: endDate.toISOString(),
          hasOpenPositions,
        },
        "Loaded existing active market from database",
      );
    }

    if (marketRows.length > 0) {
      logger.info(
        { count: marketRows.length, active: this.activeMarkets.size },
        "Loaded existing active markets from database",
      );
    }
  }

  /**
   * Fetch CLOB midpoints for both tokens of an ended market and seed lastPrices.
   *
   * Called once on startup for markets that have ended but still have open positions.
   * After market close the CLOB stops streaming WS updates, so without this the
   * frontend has no price to display while waiting for oracle resolution.
   */
  private async seedLastPricesForEndedMarket(
    state: ActiveMarketState,
  ): Promise<void> {
    const tokenIds = [state.yesTokenId, state.noTokenId];

    await Promise.all(
      tokenIds.map(async (tokenId) => {
        try {
          const { mid: midStr } = await this.client.getMidpoint(tokenId);
          const mid = parseFloat(midStr);
          if (!isFinite(mid) || mid <= 0) return;

          // Approximate bid/ask as ±0.5¢ around mid (no real spread data needed)
          state.lastPrices[tokenId] = {
            bid: Math.max(0, mid - 0.005),
            ask: Math.min(1, mid + 0.005),
            mid,
          };

          logger.debug(
            { marketId: state.marketId, tokenId, mid: mid.toFixed(4) },
            "Seeded lastPrices for ended market from CLOB midpoint",
          );
        } catch {
          // Non-fatal: if CLOB can't quote an expired token, we just won't have a price
        }
      }),
    );
  }

  /**
   * Periodically remove expired markets that have no open positions.
   * Markets with open positions are kept until those positions resolve.
   */
  private cleanupExpiredMarkets(): void {
    const now = Date.now();
    const toClean: string[] = [];

    for (const [marketId, state] of this.activeMarkets) {
      if (state.resolved) {
        toClean.push(marketId);
        continue;
      }
      // Keep active markets
      if (state.endDate.getTime() > now) continue;
      // Keep ended markets that have open positions
      const hasPosition = this.hasOpenPositionsForMarket(marketId);
      if (hasPosition) continue;
      // Expired + no positions → safe to clean up
      toClean.push(marketId);
    }

    for (const marketId of toClean) {
      this.cleanupMarket(marketId);
    }

    if (toClean.length > 0) {
      logger.debug(
        { cleaned: toClean.length, remaining: this.activeMarkets.size },
        "Cleaned up expired markets",
      );
    }
  }

  /**
   * Cleanup a fully resolved market.
   */
  private cleanupMarket(marketId: string): void {
    const state = this.activeMarkets.get(marketId);
    if (!state) return;

    // Safety: never clean up a market that still has open positions
    if (this.hasOpenPositionsForMarket(marketId)) return;

    // Unsubscribe from WS
    if (state.subscribedWs) {
      this.wsWatcher.unsubscribe([state.yesTokenId, state.noTokenId]);
    }

    // Unregister from strategy engine (also clears evaluatedTokens)
    this.strategyEngine.unregisterMarket(state.yesTokenId);
    this.strategyEngine.unregisterMarket(state.noTokenId);

    // Remove from conditionId map (O(1) via stored conditionId)
    if (state.conditionId) {
      this.conditionIdMap.delete(state.conditionId);
    }

    // Remove tokenId reverse index entries
    this.tokenToMarket.delete(state.yesTokenId);
    this.tokenToMarket.delete(state.noTokenId);

    this.activeMarkets.delete(marketId);
  }
}

// Singleton
let instance: MarketOrchestrator | null = null;
export function getMarketOrchestrator(): MarketOrchestrator {
  if (!instance) instance = new MarketOrchestrator();
  return instance;
}
