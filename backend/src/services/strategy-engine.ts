import { EventEmitter } from "events";
import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { logAudit, createStrategyTrigger, getDb } from "../db/client.js";
import { getConfig } from "../utils/config.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";

const logger = createModuleLogger("strategy-engine");

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

interface StrategyConfig {
  /** Minimum price to trigger entry (e.g. 0.75) */
  entryPriceMin: number;
  /** Maximum price to trigger entry (e.g. 0.80) */
  entryPriceMax: number;
  /** Seconds before market end to start evaluating */
  nearEndWindowSeconds: number;
  /** Max simultaneous open positions */
  maxSimultaneousPositions: number;
  /** Minimum orderbook depth ($) required on the ask side */
  minOrderbookDepth: number;
}

export interface MarketOpportunity {
  marketId: string;
  tokenId: string;
  /** "Up" or "Down" — the outcome label of the token we are buying */
  outcomeLabel: string;
  price: number;
  marketEndTime: Date;
  timeToEndSeconds: number;
  orderbookDepth: number;
  triggerReason: string;
}

/**
 * StrategyEngine — BTC 15-minute "high-probability near end" strategy.
 *
 * Logic:
 *  1. Near the end of a 15-min window (within `nearEndWindowSeconds`),
 *     check the price of both Up and Down tokens.
 *  2. If one side's price is ≥ `entryPriceMin` and ≤ `entryPriceMax`,
 *     emit an "opportunityDetected" event so the orchestrator can
 *     execute a simulated BUY on that token.
 *  3. After the window closes, the orchestrator closes the position and records P&L.
 */
export class StrategyEngine extends EventEmitter {
  private config: StrategyConfig;
  private isRunning = false;
  private openPositionsCount = 0;
  /** Track to avoid duplicate triggers: key = "marketId:tokenId" */
  private evaluatedMarkets = new Set<string>();

  constructor(config: Partial<StrategyConfig> = {}) {
    super();
    const appConfig = getConfig();
    this.config = {
      entryPriceMin:
        config.entryPriceMin ?? appConfig.simulation.entryThreshold,
      entryPriceMax:
        config.entryPriceMax ?? appConfig.simulation.entryThresholdMax,
      nearEndWindowSeconds:
        config.nearEndWindowSeconds ?? appConfig.strategy.nearEndWindowSeconds,
      maxSimultaneousPositions:
        config.maxSimultaneousPositions ??
        appConfig.strategy.maxSimultaneousPositions,
      minOrderbookDepth: config.minOrderbookDepth ?? 10,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("StrategyEngine already running");
      return;
    }

    logger.info(
      { strategy: "high_prob_near_end_btc15m", config: this.config },
      "Starting StrategyEngine",
    );

    this.isRunning = true;

    await logAudit("info", "strategy_engine", "StrategyEngine started", {
      config: this.config,
    });
  }

  stop(): void {
    logger.info("Stopping StrategyEngine");
    this.isRunning = false;
  }

  /**
   * Evaluate a market token for entry.
   * Called by the WebSocket watcher when price/orderbook data arrives.
   *
   * @param data.outcomeLabel  "Up" or "Down" — outcome corresponding to tokenId
   */
  async evaluateMarket(data: {
    marketId: string;
    tokenId: string;
    outcomeLabel: string;
    marketEndTime: Date;
    currentPrice: number;
    orderbook?: {
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
    };
  }): Promise<void> {
    if (!this.isRunning) return;

    const {
      marketId,
      tokenId,
      outcomeLabel,
      marketEndTime,
      currentPrice,
      orderbook,
    } = data;

    // Deduplicate — only trigger once per market/token
    const key = `${marketId}:${tokenId}`;
    if (this.evaluatedMarkets.has(key)) return;

    // Time to end
    const now = Date.now();
    const timeToEndSeconds = (marketEndTime.getTime() - now) / 1000;

    // Must be within near-end window and market not yet ended
    if (
      timeToEndSeconds > this.config.nearEndWindowSeconds ||
      timeToEndSeconds < 0
    ) {
      return;
    }

    // Price must be in the entry range [min, max]
    if (
      currentPrice < this.config.entryPriceMin ||
      currentPrice > this.config.entryPriceMax
    ) {
      return;
    }

    // Orderbook depth check
    if (orderbook) {
      const depth = this.calculateAskDepth(orderbook);
      if (depth < this.config.minOrderbookDepth) {
        logger.debug(
          { marketId, tokenId, depth, required: this.config.minOrderbookDepth },
          "Insufficient ask depth, skipping",
        );
        return;
      }
    }

    // Position limit
    if (this.openPositionsCount >= this.config.maxSimultaneousPositions) {
      logger.debug(
        {
          current: this.openPositionsCount,
          max: this.config.maxSimultaneousPositions,
        },
        "Max positions reached, skipping",
      );
      return;
    }

    // ---------- Opportunity detected ----------
    const opportunity: MarketOpportunity = {
      marketId,
      tokenId,
      outcomeLabel,
      price: currentPrice,
      marketEndTime,
      timeToEndSeconds,
      orderbookDepth: orderbook ? this.calculateAskDepth(orderbook) : 0,
      triggerReason: "high_prob_near_end",
    };

    logger.info(opportunity, "Strategy opportunity detected");

    this.evaluatedMarkets.add(key);

    await this.recordTrigger(opportunity);

    this.emit("opportunityDetected", opportunity);

    this.openPositionsCount++;
  }

  /**
   * Total $ depth on the ASK side (needed for BUY)
   */
  private calculateAskDepth(orderbook: {
    asks: Array<{ price: string; size: string }>;
    bids?: Array<{ price: string; size: string }>;
  }): number {
    return orderbook.asks.reduce((sum, level) => {
      const p = parseFloat(level.price);
      const s = parseFloat(level.size);
      return sum + p * s;
    }, 0);
  }

  private async recordTrigger(opp: MarketOpportunity): Promise<void> {
    try {
      const triggerId = `trig_${Date.now()}_${opp.tokenId}`;
      const now = new Date();

      await createStrategyTrigger({
        id: triggerId,
        marketId: opp.marketId,
        tokenId: opp.tokenId,
        triggerType: opp.triggerReason,
        triggerPrice: String(opp.price),
        triggerTs: now.toISOString(),
        windowStart: new Date(now.getTime() - 60000).toISOString(),
        windowEnd: opp.marketEndTime.toISOString(),
        executed: false,
        metadata: {
          outcomeLabel: opp.outcomeLabel,
          timeToEndSeconds: opp.timeToEndSeconds,
          orderbookDepth: opp.orderbookDepth,
        },
      });
    } catch (error) {
      logger.error({ error, opp }, "Failed to record trigger");
    }
  }

  async markTriggerExecuted(
    triggerId: string,
    simulatedTradeId: string,
  ): Promise<void> {
    try {
      const db = getDb();
      await db
        .update(schema.strategyTriggers)
        .set({ executed: true, simulatedTradeId })
        .where(eq(schema.strategyTriggers.id, triggerId));
    } catch (error) {
      logger.error({ error, triggerId }, "Failed to mark trigger executed");
    }
  }

  onPositionClosed(): void {
    if (this.openPositionsCount > 0) this.openPositionsCount--;
  }

  /**
   * Sync the open positions count from an external source (e.g., DB hydration on restart).
   * This ensures the position limit check is accurate after server restarts.
   */
  syncPositionCount(count: number): void {
    this.openPositionsCount = count;
    logger.info(
      { openPositionsCount: count },
      "Synced open positions count from DB",
    );
  }

  resetEvaluatedMarkets(): void {
    logger.info(
      { count: this.evaluatedMarkets.size },
      "Resetting evaluated markets cache",
    );
    this.evaluatedMarkets.clear();
  }

  /** Mark a market/token as already evaluated (e.g. hydrated from DB on restart). */
  markAsEvaluated(marketId: string, tokenId: string): void {
    const key = `${marketId}:${tokenId}`;
    this.evaluatedMarkets.add(key);
  }

  /** Remove a market/token from evaluated set (e.g., after failed trade execution). */
  removeEvaluated(key: string): void {
    this.evaluatedMarkets.delete(key);
  }

  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info({ newConfig: this.config }, "Strategy configuration updated");
    this.emit("configUpdated", this.config);
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      openPositions: this.openPositionsCount,
      evaluatedMarkets: this.evaluatedMarkets.size,
      config: this.config,
    };
  }
}

// Singleton
let engineInstance: StrategyEngine | null = null;

export function getStrategyEngine(
  config?: Partial<StrategyConfig>,
): StrategyEngine {
  if (!engineInstance) {
    engineInstance = new StrategyEngine(config);
  }
  return engineInstance;
}
