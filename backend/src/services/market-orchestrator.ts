import { EventEmitter } from "events";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { getMarketScanner } from "./market-scanner.js";
import { getStrategyEngine, MarketOpportunity } from "./strategy-engine.js";
import { getMarketWebSocketWatcher } from "./market-ws-watcher.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import {
  getDb,
  createSimulatedTrade,
  saveOrderbookSnapshot,
  resolveTradeImmediately,
  createExperimentRun,
  logAudit,
} from "../db/client.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  executeSimulatedOrder,
  ExecutionConfig,
} from "./execution-simulator.js";
import Decimal from "decimal.js";

const logger = createModuleLogger("market-orchestrator");

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * MarketOrchestrator — BTC 15-minute market simulation.
 *
 * Flow:
 *  1. MarketScanner discovers BTC 15M markets via Gamma API.
 *  2. MarketWebSocketWatcher subscribes for real-time orderbook/price.
 *  3. StrategyEngine detects high-probability near-end opportunities.
 *  4. Orchestrator executes a simulated BUY (entry only).
 *  5. When the 15-min window ends → close positions with WIN/LOSS and record P&L.
 */
export class MarketOrchestrator extends EventEmitter {
  private isRunning = false;
  private experimentId: string;
  private executionConfig: ExecutionConfig;

  /**
   * Track open positions by tokenId so we can close them
   * when their market window ends.
   */
  private openPositions = new Map<
    string,
    {
      tradeId: string;
      tokenId: string;
      marketId: string;
      outcomeLabel: string;
      marketEndTime: Date;
      entryTs: Date;
      entryPrice: number;
      sharesHeld: number;
      entryFees: number;
    }
  >();

  /** tokenId → outcome label ("Up" / "Down") */
  private tokenOutcomeLabels = new Map<string, string>();
  /** All discovered markets keyed by marketId for active market promotion */
  private knownMarkets = new Map<
    string,
    {
      marketId: string;
      conditionId: string | null;
      question: string | null;
      slug: string | null;
      endDate: Date;
      upTokenId: string | null;
      downTokenId: string | null;
      initialUpPrice: number;
      initialDownPrice: number;
      polymarketUrl: string;
    }
  >();
  /** Currently active market window for live display */
  private activeMarketData: {
    marketId: string;
    conditionId: string | null;
    question: string | null;
    slug: string | null;
    endDate: Date;
    upTokenId: string | null;
    downTokenId: string | null;
    upPrice: number;
    downPrice: number;
    polymarketUrl: string;
    activeBet: {
      tradeId: string;
      outcomeLabel: string;
      entryPrice: number;
      shares: number;
    } | null;
  } | null = null;
  /** Throttle active-market broadcasts */
  private lastActiveMarketBroadcast = 0;
  /** Throttle price tick updates to frontend (once per second) */
  private priceTickThrottleTimeout: NodeJS.Timeout | null = null;
  /** Periodic timer to check if OPEN trades' windows have ended */
  private endCheckInterval: NodeJS.Timeout | null = null;
  /** Timestamp of last DB sweep for orphaned trades (throttle to 60s) */
  private lastOrphanSweepTime = 0;
  /** Guard: trades currently being resolved (prevents async race conditions) */
  private resolvingTrades = new Set<string>();
  /** Guard: prevent overlapping checkWindowEnds calls */
  private isCheckingWindowEnds = false;

  constructor() {
    super();
    this.experimentId = `exp_${Date.now()}`;

    this.executionConfig = {
      latencyMin: 50,
      latencyMax: 300,
      slippageModel: "realistic",
      feeModel: "15m", // always 15M fee model
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Orchestrator already running");
      return;
    }

    logger.info(
      { experimentId: this.experimentId },
      "Starting Market Orchestrator (BTC 15M simulation)",
    );
    this.isRunning = true;

    await createExperimentRun({
      id: this.experimentId,
      name: `BTC-15M simulation - ${new Date().toISOString()}`,
      description: "BTC 15-minute up/down market simulation",
      strategyVariant: "taker_only",
      parameters: {
        strategy: "high_prob_near_end",
        executionConfig: this.executionConfig,
      },
    });

    // Initialize sub-services
    const scanner = getMarketScanner();
    const strategyEngine = getStrategyEngine();
    const wsWatcher = getMarketWebSocketWatcher();

    this.setupEventListeners();

    // Hydrate open positions from DB BEFORE starting services
    // This recovers trades that were OPEN when the server last restarted
    await this.hydrateOpenPositionsFromDb();

    try {
      await scanner.start();
      await strategyEngine.start();
      await wsWatcher.start();
    } catch (error) {
      logger.error({ error }, "Failed to start one or more services");
    }

    // Periodic: check if any OPEN trades' windows have ended
    // Also sweeps DB for orphaned OPEN trades not in memory
    this.endCheckInterval = setInterval(() => this.checkWindowEnds(), 5000);

    await logAudit("info", "orchestrator", "Orchestrator started", {
      experimentId: this.experimentId,
    });
  }

  stop(): void {
    logger.info("Stopping Market Orchestrator");
    this.isRunning = false;

    if (this.endCheckInterval) {
      clearInterval(this.endCheckInterval);
      this.endCheckInterval = null;
    }

    if (this.priceTickThrottleTimeout) {
      clearTimeout(this.priceTickThrottleTimeout);
      this.priceTickThrottleTimeout = null;
    }

    const scanner = getMarketScanner();
    const strategyEngine = getStrategyEngine();
    const wsWatcher = getMarketWebSocketWatcher();

    // Remove event listeners registered by setupEventListeners()
    // to prevent duplicate handlers accumulating across start/stop cycles
    scanner.removeAllListeners();
    strategyEngine.removeAllListeners();
    wsWatcher.removeAllListeners();

    scanner.stop();
    strategyEngine.stop();
    wsWatcher.stop();
  }

  // ============================================
  // Event wiring
  // ============================================

  private setupEventListeners(): void {
    const scanner = getMarketScanner();
    const strategyEngine = getStrategyEngine();
    const wsWatcher = getMarketWebSocketWatcher();

    // New market discovered → subscribe tokens to WS
    scanner.on("newMarket", async ({ marketId, market }) => {
      logger.info({ marketId }, "New market discovered, subscribing tokens");

      const tokenIds = PolymarketClient.parseClobTokenIds(market);
      const outcomes = PolymarketClient.parseOutcomes(market);
      const endDate = market.endDate;

      if (tokenIds.length === 0 || !endDate) {
        logger.warn({ marketId }, "Missing token IDs or endDate, skipping");
        return;
      }

      const endTime = new Date(endDate);

      // Store token → outcome label mapping and subscribe
      for (let i = 0; i < tokenIds.length; i++) {
        const label = outcomes[i];
        if (label && tokenIds[i]) {
          this.tokenOutcomeLabels.set(tokenIds[i]!, label);
        }
        wsWatcher.addMarket({
          marketId,
          tokenId: tokenIds[i]!,
          marketCategory: "btc-15m",
          marketEndTime: endTime,
        });
      }

      // Store discovered market data for active market promotion
      const upIdx = outcomes.findIndex((o) => o?.toLowerCase() === "up");
      const downIdx = outcomes.findIndex((o) => o?.toLowerCase() === "down");
      const outcomePrices = PolymarketClient.parseOutcomePrices(market);
      const initialUpPrice = upIdx >= 0 ? (outcomePrices[upIdx] ?? 0) : 0;
      const initialDownPrice = downIdx >= 0 ? (outcomePrices[downIdx] ?? 0) : 0;

      this.knownMarkets.set(marketId, {
        marketId,
        conditionId: market.conditionId || null,
        question: market.question || null,
        slug: market.slug || null,
        endDate: endTime,
        upTokenId: upIdx >= 0 ? (tokenIds[upIdx] ?? null) : null,
        downTokenId: downIdx >= 0 ? (tokenIds[downIdx] ?? null) : null,
        initialUpPrice,
        initialDownPrice,
        polymarketUrl: market.slug
          ? `https://polymarket.com/event/${market.slug}`
          : `https://polymarket.com`,
      });

      // Promote this or the best market as active
      this.promoteNextActiveMarket();
    });

    // Orderbook update → evaluate via strategy engine (NOT used for display prices)
    wsWatcher.on("orderbookUpdate", async (data) => {
      const { marketId, tokenId, marketEndTime, orderbook } = data;
      const currentPrice = this.calculateMidPrice(orderbook);
      const outcomeLabel = this.resolveOutcomeLabel(marketId, tokenId);

      await strategyEngine.evaluateMarket({
        marketId,
        tokenId,
        outcomeLabel,
        marketEndTime,
        currentPrice,
        orderbook,
      });
    });

    // Price tick (from WS price_change best_bid/best_ask) — SINGLE authoritative price source
    // Updates both: (1) strategy engine evaluation and (2) frontend display
    wsWatcher.on("priceUpdate", async (data) => {
      const { marketId, tokenId, marketEndTime, price } = data;
      const outcomeLabel = this.resolveOutcomeLabel(marketId, tokenId);

      // Update active market display prices + emit to frontend
      if (
        this.activeMarketData &&
        this.activeMarketData.marketId === marketId &&
        price > 0 &&
        price < 1
      ) {
        let changed = false;
        if (tokenId === this.activeMarketData.upTokenId) {
          if (Math.abs(price - this.activeMarketData.upPrice) >= 0.005) {
            this.activeMarketData.upPrice = price;
            changed = true;
          }
        } else if (tokenId === this.activeMarketData.downTokenId) {
          if (Math.abs(price - this.activeMarketData.downPrice) >= 0.005) {
            this.activeMarketData.downPrice = price;
            changed = true;
          }
        }

        if (changed) {
          // Throttle price tick updates to once per second
          if (this.priceTickThrottleTimeout) {
            clearTimeout(this.priceTickThrottleTimeout);
          }
          // Capture current prices to avoid null reference in timeout
          const currentUpPrice = this.activeMarketData.upPrice;
          const currentDownPrice = this.activeMarketData.downPrice;
          this.priceTickThrottleTimeout = setTimeout(() => {
            this.emit("priceTickUpdate", {
              marketId,
              tokenId,
              upPrice: currentUpPrice,
              downPrice: currentDownPrice,
              source: "ws",
            });
            this.priceTickThrottleTimeout = null;
          }, 1000);
        }
      }

      // Check stop-loss for open positions
      const config = getConfig();
      if (config.stopLoss.enabled) {
        await this.checkStopLoss(tokenId, price);
      }

      // Feed strategy engine
      await strategyEngine.evaluateMarket({
        marketId,
        tokenId,
        outcomeLabel,
        marketEndTime,
        currentPrice: price,
      });
    });

    // Opportunity detected → execute simulated BUY
    strategyEngine.on(
      "opportunityDetected",
      async (opportunity: MarketOpportunity) => {
        await this.executeSimulatedTrade(opportunity);
      },
    );

    // WS lifecycle events (non-critical)
    wsWatcher.on("error", (err) => logger.error({ err }, "WS watcher error"));
    wsWatcher.on("disconnected", () => logger.warn("WS watcher disconnected"));
    wsWatcher.on("connected", () => logger.info("WS watcher connected"));
  }

  // ============================================
  // Trade execution (entry only — no sell-at-98c)
  // ============================================

  private async executeSimulatedTrade(
    opportunity: MarketOpportunity,
  ): Promise<void> {
    const { marketId, tokenId, outcomeLabel, price } = opportunity;

    // ── Hard guard: reject trades for ended markets ──
    if (opportunity.marketEndTime.getTime() <= Date.now()) {
      logger.warn(
        {
          marketId,
          tokenId,
          outcomeLabel,
          marketEndTime: opportunity.marketEndTime.toISOString(),
        },
        "Rejected trade for ended market — window already closed",
      );
      return;
    }

    // ── Duplicate guard: prevent double-booking for the same token ──
    if (this.openPositions.has(tokenId)) {
      logger.warn(
        { marketId, tokenId, outcomeLabel },
        "Duplicate trade blocked — position already open for this token",
      );
      return;
    }

    // Also guard at the market level: no two trades for the same market
    for (const pos of this.openPositions.values()) {
      if (pos.marketId === marketId) {
        logger.warn(
          { marketId, tokenId, existingTokenId: pos.tokenId },
          "Duplicate trade blocked — position already open for this market",
        );
        return;
      }
    }

    logger.info(
      { marketId, tokenId, outcomeLabel, price },
      "Executing simulated BUY",
    );

    try {
      const client = getPolymarketClient();

      // Fetch current orderbook
      const { data: orderbook, raw: orderbookRaw } =
        await client.getOrderbook(tokenId);

      const snapshotId = `snap_${Date.now()}_${tokenId}`;
      await saveOrderbookSnapshot(snapshotId, tokenId, orderbookRaw);

      const config = getConfig();
      const amountUsd = config.simulation.amountUsd;

      // Look up the real takerBaseFee from the DB for accurate fee calculation
      let takerBaseFee: number | null = null;
      try {
        const db = getDb();
        const marketRows = await db
          .select({ takerBaseFee: schema.markets.takerBaseFee })
          .from(schema.markets)
          .where(eq(schema.markets.id, marketId))
          .limit(1);
        if (marketRows[0]?.takerBaseFee) {
          takerBaseFee = parseFloat(marketRows[0].takerBaseFee);
        }
      } catch (err) {
        logger.warn(
          { err, marketId },
          "Failed to fetch takerBaseFee from DB, using default",
        );
      }

      const execution = executeSimulatedOrder(
        orderbook,
        new Decimal(amountUsd),
        "BUY",
        this.executionConfig,
        takerBaseFee,
      );

      const trade = await createSimulatedTrade({
        experimentId: this.experimentId,
        marketId,
        tokenId,
        outcomeLabel,
        entryTs: new Date(),
        entryPrice: execution.averagePrice.toString(),
        entryShares: execution.totalShares.toString(),
        entryOrderbookSnapshotId: snapshotId,
        simulatedUsdAmount: amountUsd,
        entryFees: execution.fees.toString(),
        entrySlippage: execution.slippage.toString(),
        entryLatencyMs: execution.latencyMs.toString(),
        fillStatus: execution.isPartialFill ? "PARTIAL" : "FULL",
        strategyTrigger: opportunity.triggerReason,
        raw: {
          opportunity,
          execution: { fillDetails: execution.fillDetails },
        },
      });

      if (!trade) throw new Error("Failed to create simulated trade");

      // Track for window-end monitoring
      this.openPositions.set(tokenId, {
        tradeId: trade.id,
        tokenId,
        marketId,
        outcomeLabel,
        marketEndTime: opportunity.marketEndTime,
        entryTs: new Date(),
        entryPrice: execution.averagePrice.toNumber(),
        sharesHeld: execution.totalShares.toNumber(),
        entryFees: execution.fees.toNumber(),
      });

      logger.info(
        {
          tradeId: trade.id,
          tokenId,
          outcomeLabel,
          entryPrice: execution.averagePrice.toString(),
          shares: execution.totalShares.toString(),
          fees: execution.fees.toString(),
        },
        "Simulated BUY executed",
      );

      this.emit("tradeExecuted", { trade, execution });

      // Update active market bet indicator
      if (
        this.activeMarketData &&
        this.activeMarketData.marketId === marketId
      ) {
        this.activeMarketData.activeBet = {
          tradeId: trade.id,
          outcomeLabel,
          entryPrice: execution.averagePrice.toNumber(),
          shares: execution.totalShares.toNumber(),
        };
        this.broadcastActiveMarket();
      }
    } catch (error) {
      logger.error({ error, opportunity }, "Failed to execute simulated trade");

      // Remove from evaluated markets so this opportunity can be re-evaluated
      // if another price tick arrives before the window ends
      const strategyEngine = getStrategyEngine();
      const key = `${marketId}:${tokenId}`;
      strategyEngine.removeEvaluated(key);
    }
  }

  // ============================================
  // Window-end → CLOSE positions
  // ============================================

  /**
   * Check all open positions (in-memory + DB).
   * If the 15-min window has ended, close them with WIN/LOSS outcome and P&L.
   *
   * Two-pass approach:
   *  1. In-memory positions — fast path
   *  2. DB sweep — catch orphaned OPEN trades from previous server runs
   */
  private async checkWindowEnds(): Promise<void> {
    // Prevent overlapping calls (interval can fire while previous is still running)
    if (this.isCheckingWindowEnds) return;
    this.isCheckingWindowEnds = true;

    try {
      const now = Date.now();

      // Expire active market if its window ended, promote next
      if (
        this.activeMarketData &&
        this.activeMarketData.endDate.getTime() <= now
      ) {
        logger.info(
          { marketId: this.activeMarketData.marketId },
          "Active market window ended, promoting next",
        );
        this.activeMarketData = null;
        this.promoteNextActiveMarket();
      }

      const client = getPolymarketClient();

      // Pass 1: In-memory positions (normal fast path)
      for (const [tokenId, pos] of this.openPositions.entries()) {
        if (pos.marketEndTime.getTime() > now) continue; // window still running

        // Skip if already being resolved by another code path (e.g., stop-loss)
        if (this.resolvingTrades.has(pos.tradeId)) continue;

        // Claim this trade synchronously before any async work
        this.resolvingTrades.add(pos.tradeId);

        // Window ended — resolve immediately
        try {
          const resolved = await this.resolvePositionImmediately(client, pos);
          if (resolved) {
            // Only remove from in-memory tracker if fully resolved
            this.openPositions.delete(tokenId);
          }
        } catch (err) {
          logger.error(
            { err, tradeId: pos.tradeId },
            "Failed to resolve trade immediately",
          );
        } finally {
          this.resolvingTrades.delete(pos.tradeId);
        }
      }

      // Pass 2: DB sweep for orphaned OPEN trades not in memory
      // Throttled to once per 60s to avoid excessive DB queries
      if (now - this.lastOrphanSweepTime >= 60_000) {
        this.lastOrphanSweepTime = now;
        await this.sweepOrphanedTrades(client);
      }
    } finally {
      this.isCheckingWindowEnds = false;
    }
  }

  /**
   * On startup, load all OPEN trades from the DB into the in-memory openPositions map.
   * This recovers state after server restarts (e.g., Render redeploy/sleep).
   * Also syncs StrategyEngine.openPositionsCount and marks markets as evaluated.
   */
  private async hydrateOpenPositionsFromDb(): Promise<void> {
    try {
      const db = getDb();
      const openTrades = await db
        .select({
          id: schema.simulatedTrades.id,
          tokenId: schema.simulatedTrades.tokenId,
          marketId: schema.simulatedTrades.marketId,
          outcomeLabel: schema.simulatedTrades.outcomeLabel,
          entryTs: schema.simulatedTrades.entryTs,
          entryPrice: schema.simulatedTrades.entryPrice,
          entryShares: schema.simulatedTrades.entryShares,
          entryFees: schema.simulatedTrades.entryFees,
          market: {
            endDate: schema.markets.endDate,
          },
        })
        .from(schema.simulatedTrades)
        .leftJoin(
          schema.markets,
          eq(schema.simulatedTrades.marketId, schema.markets.id),
        )
        .where(eq(schema.simulatedTrades.status, "OPEN"));

      if (openTrades.length === 0) {
        logger.info("No orphaned OPEN trades found in DB");
        return;
      }

      const strategyEngine = getStrategyEngine();

      for (const trade of openTrades) {
        if (!trade.tokenId || !trade.marketId) continue;

        // Parse market end time from the joined market data
        let marketEndTime = new Date(0);
        if (trade.market?.endDate) {
          marketEndTime = new Date(trade.market.endDate);
        }

        this.openPositions.set(trade.tokenId, {
          tradeId: trade.id,
          tokenId: trade.tokenId,
          marketId: trade.marketId,
          outcomeLabel: trade.outcomeLabel || "Unknown",
          marketEndTime,
          entryTs: trade.entryTs,
          entryPrice: parseFloat(trade.entryPrice),
          sharesHeld: parseFloat(trade.entryShares),
          entryFees: parseFloat(trade.entryFees?.toString() || "0"),
        });

        // Mark this market/token as already evaluated to prevent duplicate trades
        strategyEngine.markAsEvaluated(trade.marketId, trade.tokenId);
      }

      // Sync strategy engine position count
      strategyEngine.syncPositionCount(this.openPositions.size);

      logger.info(
        { count: openTrades.length, tradeIds: openTrades.map((t) => t.id) },
        "Hydrated open positions from DB after restart",
      );

      await logAudit(
        "info",
        "orchestrator",
        `Hydrated ${openTrades.length} open positions from DB`,
        { tradeIds: openTrades.map((t) => t.id) },
      );
    } catch (err) {
      logger.error({ err }, "Failed to hydrate open positions from DB");
    }
  }

  /**
   * Sweep DB for OPEN trades that are NOT in the in-memory map.
   * These are orphans from previous server runs.
   * Attempts to resolve them via the Polymarket API. Trades stay OPEN until
   * the API provides real resolution data.
   */
  private async sweepOrphanedTrades(client: PolymarketClient): Promise<void> {
    try {
      const db = getDb();

      // Find OPEN trades in DB whose tokenId is NOT in our in-memory map
      const openTrades = await db
        .select({
          id: schema.simulatedTrades.id,
          tokenId: schema.simulatedTrades.tokenId,
          marketId: schema.simulatedTrades.marketId,
          outcomeLabel: schema.simulatedTrades.outcomeLabel,
          entryTs: schema.simulatedTrades.entryTs,
          entryPrice: schema.simulatedTrades.entryPrice,
          entryShares: schema.simulatedTrades.entryShares,
          entryFees: schema.simulatedTrades.entryFees,
          market: {
            endDate: schema.markets.endDate,
          },
        })
        .from(schema.simulatedTrades)
        .leftJoin(
          schema.markets,
          eq(schema.simulatedTrades.marketId, schema.markets.id),
        )
        .where(eq(schema.simulatedTrades.status, "OPEN"));

      for (const trade of openTrades) {
        if (!trade.tokenId || !trade.marketId) continue;

        // Skip if already tracked in memory (handled by Pass 1)
        if (this.openPositions.has(trade.tokenId)) continue;

        // Parse market end time
        let marketEndTime = new Date(0); // default to epoch (will trigger timeout)
        if (trade.market?.endDate) {
          marketEndTime = new Date(trade.market.endDate);
        }

        // Only process if market window has ended
        if (marketEndTime.getTime() > Date.now()) {
          // Market still running — add to in-memory map so Pass 1 handles it next time
          this.openPositions.set(trade.tokenId, {
            tradeId: trade.id,
            tokenId: trade.tokenId,
            marketId: trade.marketId,
            outcomeLabel: trade.outcomeLabel || "Unknown",
            marketEndTime,
            entryTs: trade.entryTs,
            entryPrice: parseFloat(trade.entryPrice),
            sharesHeld: parseFloat(trade.entryShares),
            entryFees: parseFloat(trade.entryFees?.toString() || "0"),
          });
          continue;
        }

        // Market window ended — try to resolve
        // Skip if already being resolved by another code path
        if (this.resolvingTrades.has(trade.id)) continue;
        this.resolvingTrades.add(trade.id);

        const pos = {
          tradeId: trade.id,
          tokenId: trade.tokenId,
          marketId: trade.marketId,
          outcomeLabel: trade.outcomeLabel || "Unknown",
          marketEndTime,
          entryPrice: parseFloat(trade.entryPrice),
          sharesHeld: parseFloat(trade.entryShares),
          entryFees: parseFloat(trade.entryFees?.toString() || "0"),
        };

        try {
          const resolved = await this.resolvePositionImmediately(client, pos);
          if (resolved) {
            logger.info(
              { tradeId: trade.id },
              "Resolved orphaned OPEN trade from DB sweep",
            );
          }
        } catch (err) {
          logger.error(
            { err, tradeId: trade.id },
            "Failed to resolve orphaned trade in DB sweep",
          );
        } finally {
          this.resolvingTrades.delete(trade.id);
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to sweep orphaned trades from DB");
    }
  }

  /**
   * Check if an open position should be stopped out due to price drop.
   * Triggers when current price drops below the configured threshold (default 50¢).
   * This protects capital by selling at a loss rather than risking total loss.
   */
  private async checkStopLoss(
    tokenId: string,
    currentPrice: number,
  ): Promise<void> {
    const position = this.openPositions.get(tokenId);
    if (!position) return;

    const config = getConfig();
    const threshold = config.stopLoss.threshold;

    // Only trigger if price dropped below threshold
    if (currentPrice > threshold) return;

    // ── Synchronous guard: claim this trade immediately ──
    // Prevents concurrent price ticks from triggering duplicate stop-losses
    if (this.resolvingTrades.has(position.tradeId)) return;
    this.resolvingTrades.add(position.tradeId);
    this.openPositions.delete(tokenId);

    logger.info(
      {
        tradeId: position.tradeId,
        tokenId,
        entryPrice: position.entryPrice,
        currentPrice,
        threshold,
      },
      "Stop-loss triggered — selling position to limit losses",
    );

    try {
      // Calculate realized loss based on selling at current price
      const shares = new Decimal(position.sharesHeld);
      const entryPrice = new Decimal(position.entryPrice);
      const exitPrice = new Decimal(currentPrice);
      const fees = new Decimal(position.entryFees);

      // Amount recovered from selling at stop-loss price
      const recoveredAmount = shares.mul(exitPrice);
      // Original investment
      const invested = shares.mul(entryPrice);
      // Net P&L (will be negative)
      const realizedPnl = recoveredAmount.minus(invested).minus(fees);

      // Resolve trade immediately with STOP_LOSS outcome
      await resolveTradeImmediately(
        position.tradeId,
        "STOP_LOSS",
        realizedPnl.toFixed(4),
        exitPrice.toFixed(4),
      );

      // Notify strategy engine of position closure
      const strategyEngine = getStrategyEngine();
      strategyEngine.onPositionClosed();

      // Emit event for frontend
      this.emit("tradeStopped", {
        tradeId: position.tradeId,
        tokenId,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        shares: position.sharesHeld,
        realizedPnl: realizedPnl.toNumber(),
        recoveredAmount: recoveredAmount.toNumber(),
      });

      // Notify WS clients
      this.emit("tradeClosed", {
        tradeId: position.tradeId,
        outcome: "STOP_LOSS",
        realizedPnl: realizedPnl.toNumber(),
      });

      // Update active market display (position removed)
      this.broadcastActiveMarket();

      await logAudit(
        "info",
        "stop_loss_triggered",
        "Trade stopped to limit loss",
        {
          tradeId: position.tradeId,
          tokenId,
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          threshold,
          realizedPnl: realizedPnl.toNumber(),
          recoveredAmount: recoveredAmount.toNumber(),
        },
      );
    } catch (err) {
      // Stop-loss failed — re-add to openPositions so it can be retried
      this.openPositions.set(tokenId, position);
      logger.error(
        { err, tradeId: position.tradeId },
        "Failed to execute stop-loss",
      );
    } finally {
      this.resolvingTrades.delete(position.tradeId);
    }
  }

  /**
   * Resolve a position when its market window ends.
   * Fetches market data from Polymarket API, determines WIN/LOSS, calculates P&L.
   *
   * This method NEVER fabricates outcomes. If the API cannot provide
   * definitive resolution data, it returns false and the trade stays OPEN
   * in both memory and DB until a subsequent check succeeds.
   *
   * @returns true if the trade was resolved with real data, false to retry later
   */
  private async resolvePositionImmediately(
    client: PolymarketClient,
    pos: {
      tradeId: string;
      tokenId: string;
      marketId: string;
      outcomeLabel: string;
      marketEndTime?: Date;
      entryPrice: number;
      sharesHeld: number;
      entryFees: number;
    },
  ): Promise<boolean> {
    // Fetch market data to determine outcome
    let market = await client.getMarketById(pos.marketId);

    // If market not found, try a scan then retry
    if (!market) {
      const scanner = getMarketScanner();
      await scanner.scan();
      market = await client.getMarketById(pos.marketId);
    }

    if (!market) {
      logger.warn(
        { tradeId: pos.tradeId, marketId: pos.marketId },
        "Market not found in API, will retry on next check",
      );
      return false;
    }

    // Wait for market to be closed before resolving
    if (!market.closed) {
      logger.debug(
        { tradeId: pos.tradeId, marketId: pos.marketId },
        "Market not yet closed, will retry on next check",
      );
      return false;
    }

    // Parse market resolution data
    const outcomePrices = PolymarketClient.parseOutcomePrices(market);
    const tokenIds = PolymarketClient.parseClobTokenIds(market);

    if (outcomePrices.length === 0 || tokenIds.length === 0) {
      logger.warn(
        { tradeId: pos.tradeId, marketId: pos.marketId },
        "Market missing resolution data, will retry",
      );
      return false;
    }

    // Find our token's resolution price
    const tokenIndex = tokenIds.indexOf(pos.tokenId);
    if (tokenIndex === -1) {
      logger.error(
        { tradeId: pos.tradeId, tokenId: pos.tokenId, tokenIds },
        "Token not found in market tokenIds, will retry",
      );
      return false;
    }

    const tokenOutcomePrice = outcomePrices[tokenIndex] ?? 0;

    // Determine WIN/LOSS from real resolution price
    let outcome: "WIN" | "LOSS";
    if (tokenOutcomePrice >= 0.9) {
      outcome = "WIN";
    } else if (tokenOutcomePrice <= 0.1) {
      outcome = "LOSS";
    } else {
      // Market closed but outcome price is ambiguous — keep retrying
      logger.debug(
        { tradeId: pos.tradeId, tokenPrice: tokenOutcomePrice },
        "Market closed but outcome price ambiguous, will retry",
      );
      return false;
    }

    // Calculate P&L from real data
    const entryPrice = new Decimal(pos.entryPrice);
    const shares = new Decimal(pos.sharesHeld);
    const entryFees = new Decimal(pos.entryFees);
    let realizedPnl: Decimal;

    if (outcome === "WIN") {
      // Token resolves to $1; profit = (1 - entryPrice) * shares - fees
      realizedPnl = new Decimal(1)
        .minus(entryPrice)
        .mul(shares)
        .minus(entryFees);
    } else {
      // Token resolves to $0; loss = -(entryPrice * shares) - fees
      realizedPnl = entryPrice.mul(shares).plus(entryFees).neg();
    }

    // Close trade (OPEN → CLOSED)
    await resolveTradeImmediately(pos.tradeId, outcome, realizedPnl.toString());

    // Notify strategy engine
    const strategyEngine = getStrategyEngine();
    strategyEngine.onPositionClosed();

    logger.info(
      {
        tradeId: pos.tradeId,
        outcome,
        realizedPnl: realizedPnl.toString(),
        outcomeLabel: pos.outcomeLabel,
        tokenPrice: tokenOutcomePrice,
      },
      "Trade resolved with real market data",
    );

    this.emit("tradeClosed", {
      tradeId: pos.tradeId,
      outcome,
      realizedPnl: realizedPnl.toNumber(),
    });

    return true;
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Resolve the outcome label (Up / Down) for a given token within a market.
   * Looks up the market subscription metadata from the WS watcher.
   */
  private resolveOutcomeLabel(marketId: string, tokenId: string): string {
    return this.tokenOutcomeLabels.get(tokenId) ?? "Unknown";
  }

  private calculateMidPrice(orderbook: any): number {
    if (!orderbook?.bids?.length || !orderbook?.asks?.length) return 0;
    const bestBid = parseFloat(orderbook.bids[0]?.price || "0");
    const bestAsk = parseFloat(orderbook.asks[0]?.price || "0");
    return (bestBid + bestAsk) / 2;
  }

  /**
   * One-time REST midpoint fetch to bootstrap prices when a new market is promoted.
   * After this, WS price_change events take over as the single source of truth.
   */
  private async fetchInitialPrices(): Promise<void> {
    if (!this.activeMarketData) return;
    try {
      const client = getPolymarketClient();

      if (this.activeMarketData.upTokenId) {
        const resp = await client.getMidpoint(this.activeMarketData.upTokenId);
        const mid = parseFloat(resp.mid);
        if (!isNaN(mid) && mid > 0 && mid < 1) {
          this.activeMarketData.upPrice = mid;
        }
      }

      if (this.activeMarketData.downTokenId) {
        const resp = await client.getMidpoint(
          this.activeMarketData.downTokenId,
        );
        const mid = parseFloat(resp.mid);
        if (!isNaN(mid) && mid > 0 && mid < 1) {
          this.activeMarketData.downPrice = mid;
        }
      }

      // Broadcast the bootstrapped prices
      this.broadcastActiveMarket();
    } catch (error) {
      logger.debug({ error }, "Failed to fetch initial prices (non-critical)");
    }
  }

  private broadcastActiveMarket(): void {
    if (!this.activeMarketData) {
      this.emit("activeMarketUpdate", null);
      return;
    }
    if (this.activeMarketData.endDate.getTime() < Date.now()) {
      this.activeMarketData = null;
      this.promoteNextActiveMarket();
      return;
    }
    this.emit("activeMarketUpdate", {
      ...this.activeMarketData,
      endDate: this.activeMarketData.endDate.toISOString(),
      openPositions: this.getOpenPositionsForDisplay(),
    });
  }

  /**
   * Promote the next soonest-ending market that hasn't expired yet.
   * Cleans up expired markets from knownMarkets registry.
   */
  private promoteNextActiveMarket(): void {
    const now = Date.now();

    // Clean up expired markets
    for (const [id, m] of this.knownMarkets.entries()) {
      if (m.endDate.getTime() <= now) {
        this.knownMarkets.delete(id);
      }
    }

    // If already have a valid active market, skip
    if (
      this.activeMarketData &&
      this.activeMarketData.endDate.getTime() > now
    ) {
      return;
    }

    // Find the soonest-ending future market
    let best: {
      marketId: string;
      conditionId: string | null;
      question: string | null;
      slug: string | null;
      endDate: Date;
      upTokenId: string | null;
      downTokenId: string | null;
      initialUpPrice: number;
      initialDownPrice: number;
      polymarketUrl: string;
    } | null = null;
    for (const m of this.knownMarkets.values()) {
      if (m.endDate.getTime() <= now) continue;
      if (!best || m.endDate < best.endDate) {
        best = m;
      }
    }

    if (!best) {
      // No future markets available
      if (this.activeMarketData) {
        this.activeMarketData = null;
      }
      this.emit("activeMarketUpdate", null);
      return;
    }

    // Check if any open position is on this market
    let activeBet: {
      tradeId: string;
      outcomeLabel: string;
      entryPrice: number;
      shares: number;
    } | null = null;
    for (const pos of this.openPositions.values()) {
      if (pos.marketId === best.marketId) {
        activeBet = {
          tradeId: pos.tradeId,
          outcomeLabel: pos.outcomeLabel,
          entryPrice: pos.entryPrice,
          shares: pos.sharesHeld,
        };
        break;
      }
    }

    this.activeMarketData = {
      marketId: best.marketId,
      conditionId: best.conditionId,
      question: best.question,
      slug: best.slug,
      endDate: best.endDate,
      upTokenId: best.upTokenId,
      downTokenId: best.downTokenId,
      upPrice: best.initialUpPrice,
      downPrice: best.initialDownPrice,
      polymarketUrl: best.polymarketUrl,
      activeBet,
    };

    logger.info(
      {
        marketId: best.marketId,
        endDate: best.endDate.toISOString(),
        question: best.question,
      },
      "Promoted next active market",
    );

    this.broadcastActiveMarket();

    // One-time REST fetch to bootstrap accurate prices before WS events arrive
    this.fetchInitialPrices().catch(() => {});
  }

  /** Get all open positions formatted for API/WS consumption */
  getOpenPositionsForDisplay() {
    const positions: Array<{
      tradeId: string;
      tokenId: string;
      marketId: string;
      outcomeLabel: string;
      entryPrice: number;
      shares: number;
      entryFees: number;
      currentPrice: number;
      entryTs: string;
      marketEndTime: string;
      market?: {
        question: string | null;
        slug: string | null;
        endDate: string;
      };
    }> = [];

    for (const [tokenId, pos] of this.openPositions.entries()) {
      // Get market data for this position
      const marketData = this.knownMarkets.get(pos.marketId);

      let currentPrice = 0;
      if (
        this.activeMarketData &&
        pos.marketId === this.activeMarketData.marketId
      ) {
        if (
          pos.outcomeLabel === "Up" &&
          this.activeMarketData.upTokenId === tokenId
        ) {
          currentPrice = this.activeMarketData.upPrice;
        } else if (
          pos.outcomeLabel === "Down" &&
          this.activeMarketData.downTokenId === tokenId
        ) {
          currentPrice = this.activeMarketData.downPrice;
        }
      }

      positions.push({
        tradeId: pos.tradeId,
        tokenId: pos.tokenId,
        marketId: pos.marketId,
        outcomeLabel: pos.outcomeLabel,
        entryPrice: pos.entryPrice,
        shares: pos.sharesHeld,
        entryFees: pos.entryFees,
        currentPrice,
        entryTs: pos.entryTs.toISOString(),
        marketEndTime: pos.marketEndTime.toISOString(),
        market: marketData
          ? {
              question: marketData.question,
              slug: marketData.slug,
              endDate: marketData.endDate.toISOString(),
            }
          : undefined,
      });
    }

    return positions;
  }

  /** Get live price map for open tokens (used by performance calculator) */
  getLivePriceMap(): Map<string, number> {
    const priceMap = new Map<string, number>();
    if (!this.activeMarketData) return priceMap;

    if (this.activeMarketData.upTokenId && this.activeMarketData.upPrice > 0) {
      priceMap.set(
        this.activeMarketData.upTokenId,
        this.activeMarketData.upPrice,
      );
    }
    if (
      this.activeMarketData.downTokenId &&
      this.activeMarketData.downPrice > 0
    ) {
      priceMap.set(
        this.activeMarketData.downTokenId,
        this.activeMarketData.downPrice,
      );
    }

    return priceMap;
  }

  getActiveMarket() {
    if (
      this.activeMarketData &&
      this.activeMarketData.endDate.getTime() < Date.now()
    ) {
      this.activeMarketData = null;
      this.promoteNextActiveMarket();
    }
    if (!this.activeMarketData) {
      // Try promotion on GET requests too
      this.promoteNextActiveMarket();
    }
    if (!this.activeMarketData) return null;
    return {
      ...this.activeMarketData,
      endDate: this.activeMarketData.endDate.toISOString(),
      openPositions: this.getOpenPositionsForDisplay(),
    };
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      experimentId: this.experimentId,
      openPositions: this.openPositions.size,
      activeMarket: this.getActiveMarket(),
    };
  }
}

// Singleton
let orchestratorInstance: MarketOrchestrator | null = null;

export function getMarketOrchestrator(): MarketOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new MarketOrchestrator();
  }
  return orchestratorInstance;
}
