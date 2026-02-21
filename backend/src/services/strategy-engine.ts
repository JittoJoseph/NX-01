import { EventEmitter } from "events";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import type { Orderbook } from "../types/index.js";
import type { BtcPriceData } from "../interfaces/websocket-types.js";

const logger = createModuleLogger("strategy-engine");

/** Opportunity detected by the strategy engine */
export interface MarketOpportunity {
  marketId: string;
  tokenId: string;
  outcomeLabel: string; // "Up" or "Down"
  midpoint: number;
  bestAsk: number;
  bestBid: number;
  btcPrice: number;
  btcTargetPrice: number;
  btcDistanceUsd: number;
  secondsToEnd: number;
  askDepthUsd: number; // liquidity available at/near threshold
  trigger: string;
}

/** Per-token price state tracked by the engine */
interface TokenPriceState {
  bestBid: number;
  bestAsk: number;
  midpoint: number;
  lastUpdate: number;
}

/** Market info registered with the engine */
interface WatchedMarket {
  marketId: string;
  tokenId: string;
  outcomeLabel: string;
  endDate: Date;
  targetPrice: number | null; // BTC target price from market question
}

/**
 * Strategy: End-of-Window Micro-Profit
 *
 * Detects opportunities in the final seconds of a BTC market window
 * where one outcome is nearly certain (price ≥ threshold like 97¢).
 *
 * Entry conditions (ALL must be true):
 *   1. Within last TRADE_FROM_WINDOW_SECONDS of market end
 *   2. Token midpoint ≥ ENTRY_PRICE_THRESHOLD (e.g., 0.97)
 *   3. BTC price distance from target ≥ MIN_BTC_DISTANCE_USD
 *   4. Position limit not reached
 *   5. Not already holding this market/token
 *
 * Emits: "opportunityDetected" with MarketOpportunity
 */
export class StrategyEngine extends EventEmitter {
  private priceStates: Map<string, TokenPriceState> = new Map();
  private watchedMarkets: Map<string, WatchedMarket> = new Map(); // tokenId → market info
  private evaluatedTokens: Set<string> = new Set(); // tokenId combos already triggered
  private openPositionCount = 0;
  private triggersCount = 0;

  registerMarket(
    marketId: string,
    tokenId: string,
    outcomeLabel: string,
    endDate: Date,
    targetPrice: number | null,
  ): void {
    this.watchedMarkets.set(tokenId, {
      marketId,
      tokenId,
      outcomeLabel,
      endDate,
      targetPrice,
    });
  }

  unregisterMarket(tokenId: string): void {
    this.watchedMarkets.delete(tokenId);
    this.priceStates.delete(tokenId);
  }

  setOpenPositionCount(count: number): void {
    this.openPositionCount = count;
  }

  markTokenEvaluated(tokenId: string): void {
    this.evaluatedTokens.add(tokenId);
  }

  resetForNewWindow(): void {
    this.evaluatedTokens.clear();
  }

  getStats() {
    return {
      watchedTokens: this.watchedMarkets.size,
      triggersCount: this.triggersCount,
      evaluatedTokens: this.evaluatedTokens.size,
    };
  }

  /**
   * Called on every price update from the WebSocket.
   * Evaluates if a trade opportunity exists.
   */
  evaluatePrice(
    tokenId: string,
    bestBid: number,
    bestAsk: number,
    btcPriceData: BtcPriceData | null,
    orderbook?: Orderbook,
  ): void {
    // Update price state
    const midpoint = (bestBid + bestAsk) / 2;
    this.priceStates.set(tokenId, {
      bestBid,
      bestAsk,
      midpoint,
      lastUpdate: Date.now(),
    });

    // Get market info for this token
    const market = this.watchedMarkets.get(tokenId);
    if (!market) return;

    // Skip if already evaluated/triggered
    if (this.evaluatedTokens.has(tokenId)) return;

    const config = getConfig();
    const now = Date.now();
    const endTime = market.endDate.getTime();
    const secondsToEnd = (endTime - now) / 1000;

    // Condition 1: Must be in the trade window (last N seconds before market end)
    if (
      secondsToEnd < 0 ||
      secondsToEnd > config.strategy.tradeFromWindowSeconds
    ) {
      return;
    }

    // Condition 2: Midpoint must be at or above the entry threshold
    if (midpoint < config.strategy.entryPriceThreshold) {
      return;
    }

    // Condition 3: BTC price distance check
    if (!btcPriceData || btcPriceData.price <= 0) {
      logger.debug({ tokenId }, "No BTC price data available, skipping");
      return;
    }

    if (market.targetPrice === null) {
      logger.debug(
        { tokenId },
        "No target price parsed for market, skipping distance check",
      );
      // Allow trade without distance check if we can't parse target
    } else {
      const btcDistanceUsd = this.calculateBtcDistanceUsd(
        btcPriceData.price,
        market.targetPrice,
      );

      if (btcDistanceUsd < config.strategy.minBtcDistanceUsd) {
        logger.debug(
          {
            tokenId,
            btcDistanceUsd,
            minRequired: config.strategy.minBtcDistanceUsd,
          },
          "BTC distance too small, skipping (too volatile)",
        );
        return;
      }
    }

    // Condition 4: Position limit
    if (this.openPositionCount >= config.strategy.maxSimultaneousPositions) {
      return;
    }

    // Calculate ask-side depth (liquidity available)
    let askDepthUsd = 0;
    if (orderbook) {
      for (const level of orderbook.asks) {
        const price = parseFloat(level.price);
        const size = parseFloat(level.size);
        if (price <= bestAsk + 0.03) {
          askDepthUsd += price * size;
        }
      }
    }

    const btcDistanceUsd = market.targetPrice
      ? this.calculateBtcDistanceUsd(btcPriceData.price, market.targetPrice)
      : 0;

    const opportunity: MarketOpportunity = {
      marketId: market.marketId,
      tokenId,
      outcomeLabel: market.outcomeLabel,
      midpoint,
      bestAsk,
      bestBid,
      btcPrice: btcPriceData.price,
      btcTargetPrice: market.targetPrice ?? 0,
      btcDistanceUsd,
      secondsToEnd,
      askDepthUsd,
      trigger: "end_of_window_micro_profit",
    };

    // Mark as evaluated to prevent re-triggering
    this.evaluatedTokens.add(tokenId);
    this.triggersCount++;

    logger.info(
      {
        marketId: market.marketId,
        outcome: market.outcomeLabel,
        midpoint: midpoint.toFixed(4),
        bestAsk: bestAsk.toFixed(4),
        btcPrice: btcPriceData.price.toFixed(2),
        btcDistance: btcDistanceUsd.toFixed(2),
        secondsToEnd: secondsToEnd.toFixed(1),
      },
      "🎯 Opportunity detected: end-of-window micro-profit",
    );

    this.emit("opportunityDetected", opportunity);
  }

  /**
   * Calculate the percentage distance of current BTC price from the target.
   * For "Up" outcomes: positive distance means BTC is above target (good for Up buyers)
   * For "Down" outcomes: positive distance means BTC is below target (good for Down buyers)
   */
  private calculateBtcDistanceUsd(
    currentBtcPrice: number,
    targetPrice: number,
  ): number {
    // Absolute dollar distance between current BTC price and market target price
    return Math.abs(currentBtcPrice - targetPrice);
  }

  getPriceState(tokenId: string): TokenPriceState | undefined {
    return this.priceStates.get(tokenId);
  }
}

// Singleton
let instance: StrategyEngine | null = null;
export function getStrategyEngine(): StrategyEngine {
  if (!instance) instance = new StrategyEngine();
  return instance;
}
