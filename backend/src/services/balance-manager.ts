import { createModuleLogger } from "../utils/logger.js";
import { tradingClient } from "./polymarket-trading-client.js";
import { updateLastKnownBalance } from "../db/client.js";

const logger = createModuleLogger("balance-manager");

const CACHE_TTL_MS = 5_000;

/** Cached USDC.e balance from Polymarket with TTL-based refresh. */
class BalanceManager {
  private cachedBalance: number = 0;
  private lastFetchedAt: number = 0;
  private refreshing: Promise<number> | null = null;

  /** Get the current available USDC.e balance (cached, 5s TTL). */
  async getBalance(): Promise<number> {
    const now = Date.now();
    if (now - this.lastFetchedAt < CACHE_TTL_MS && this.cachedBalance > 0) {
      return this.cachedBalance;
    }
    return this.refresh();
  }

  /** Force-refresh the balance from Polymarket. */
  async refresh(): Promise<number> {
    // Coalesce concurrent refresh calls
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async doRefresh(): Promise<number> {
    try {
      const { balance } = await tradingClient.getUsdcBalance();
      this.cachedBalance = parseFloat(balance);
      this.lastFetchedAt = Date.now();

      // Persist to DB asynchronously
      updateLastKnownBalance(balance).catch((err) =>
        logger.error({ error: err }, "Failed to persist balance to DB"),
      );

      return this.cachedBalance;
    } catch (err) {
      logger.error(
        { error: err },
        "Failed to fetch USDC balance from Polymarket",
      );
      // Return stale cache rather than crashing
      return this.cachedBalance;
    }
  }

  /** Invalidate cache so next getBalance() fetches fresh data. */
  invalidate(): void {
    this.lastFetchedAt = 0;
  }

  /** Get the cached value without triggering a refresh. */
  getCachedBalance(): number {
    return this.cachedBalance;
  }
}

export const balanceManager = new BalanceManager();
