import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { POLYMARKET_MIN_ORDER_SIZE, DEFAULTS } from "../types/index.js";
import { getPortfolio, initPortfolio } from "../db/client.js";
import { balanceManager } from "./balance-manager.js";

const logger = createModuleLogger("portfolio-manager");

/**
 * PortfolioManager
 *
 * Uses the real Polymarket USDC.e balance (via BalanceManager) for position sizing.
 * No local cash tracking — the on-chain balance is the source of truth.
 *
 * Key rules:
 * - Position sizing = availableBalance / maxPositions
 * - Only place orders if real balance can cover the position budget
 * - Minimum position: POLYMARKET_MIN_ORDER_SIZE shares (protocol-level = 5)
 * - DB portfolio row tracks initial capital for P&L calculations
 */
export class PortfolioManager {
  private initialCapital: Decimal = new Decimal(0);

  /** Initialise from DB or create fresh portfolio row. */
  async init(): Promise<void> {
    const config = getConfig();
    const portfolio = await initPortfolio(config.portfolio.startingCapital);
    if (!portfolio) {
      throw new Error("Failed to initialise portfolio row");
    }
    this.initialCapital = new Decimal(portfolio.initialCapital);

    // Seed balance cache from Polymarket
    const balance = await balanceManager.getBalance();

    logger.info(
      {
        initialCapital: this.initialCapital.toString(),
        realBalance: balance.toFixed(2),
        maxPositions: DEFAULTS.MAX_SIMULTANEOUS_POSITIONS,
      },
      "Portfolio initialised with real Polymarket balance",
    );
  }

  /** Reload from DB after wipe/reset. */
  async reload(): Promise<void> {
    const portfolio = await getPortfolio();
    if (!portfolio) {
      throw new Error("Portfolio row missing — call init() first");
    }
    this.initialCapital = new Decimal(portfolio.initialCapital);
    balanceManager.invalidate();
  }

  // ── Getters ──────────────────────────────────────────────────

  /** Get the real USDC.e balance from Polymarket (cached with 5s TTL). */
  async getBalance(): Promise<number> {
    return balanceManager.getBalance();
  }

  getInitialCapital(): number {
    return this.initialCapital.toNumber();
  }

  // ── Position sizing ──────────────────────────────────────────

  /**
   * Compute the budget for the next position using real Polymarket balance.
   *
   *   balance    = real USDC.e on Polymarket
   *   rawBudget  = balance / maxSimultaneousPositions
   *   minBudget  = MIN_ORDER_SIZE × maxEntryPrice (rough minimum)
   *   budget     = max(rawBudget, minBudget), capped at balance
   *
   * @returns Budget in USD, or 0 if balance can't cover the minimum order
   */
  async computePositionBudget(): Promise<number> {
    const config = getConfig();
    const minShares = POLYMARKET_MIN_ORDER_SIZE;
    const maxPrice = config.strategy.maxEntryPrice;
    const balance = new Decimal(await balanceManager.getBalance());
    const rawBudget = balance.div(DEFAULTS.MAX_SIMULTANEOUS_POSITIONS);

    // Minimum cost: shares × maxEntryPrice (fees handled by SDK)
    const minBudget = new Decimal(maxPrice).mul(minShares);

    const budget = Decimal.max(rawBudget, minBudget);

    if (balance.lt(minBudget)) {
      logger.warn(
        {
          balance: balance.toString(),
          minBudget: minBudget.toString(),
          minShares,
          maxEntryPrice: maxPrice,
        },
        "Insufficient Polymarket balance for minimum order — skipping",
      );
      return 0;
    }

    const capped = Decimal.min(budget, balance);
    return capped.toDP(8).toNumber();
  }
}
