import { EventEmitter } from "events";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import { createModuleLogger } from "../utils/logger.js";
import { upsertMarket, logAudit } from "../db/client.js";
import { GammaMarket, GammaEvent } from "../types/index.js";
import { getConfig } from "../utils/config.js";

const logger = createModuleLogger("market-scanner");

interface ScannerConfig {
  /** Milliseconds between Gamma API scans */
  scanIntervalMs: number;
  /** Minimum look-ahead: only scan when no cataloged window covers now + this ms */
  minLookAheadMs: number;
}

/**
 * MarketScanner — BTC 15-minute market discovery only.
 *
 * Uses Gamma API `GET /events?tag_slug=15M&active=true&closed=false`
 * and filters to BTC-only events (slug starts with "btc-updown-15m").
 *
 * Smart scanning: skips API call when a previously-discovered window
 * already covers the next `minLookAheadMs` period.
 */
export class MarketScanner extends EventEmitter {
  private config: ScannerConfig;
  private scanTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private discoveredMarkets = new Set<string>();
  /** Track latest cataloged endDate so we know when to scan again */
  private latestEndDate: Date | null = null;

  constructor(config: Partial<ScannerConfig> = {}) {
    super();
    const appConfig = getConfig();
    this.config = {
      scanIntervalMs:
        config.scanIntervalMs ?? appConfig.strategy.scanIntervalMs,
      minLookAheadMs:
        config.minLookAheadMs ?? appConfig.strategy.minLookAheadMs,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("MarketScanner already running");
      return;
    }

    logger.info(
      {
        scanIntervalMs: this.config.scanIntervalMs,
        minLookAheadMs: this.config.minLookAheadMs,
      },
      "Starting MarketScanner (BTC 15M only)",
    );

    this.isRunning = true;

    // Initial scan immediately
    await this.performScan();

    // Periodic scan
    this.scanTimer = setInterval(
      () => this.performScan(),
      this.config.scanIntervalMs,
    );

    await logAudit("info", "market_scanner", "MarketScanner started", {
      config: this.config,
    });
  }

  stop(): void {
    logger.info("Stopping MarketScanner");
    this.isRunning = false;

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /**
   * Public method to trigger a market scan on demand.
   */
  async scan(): Promise<void> {
    await this.performScan();
  }

  /**
   * Smart scan — only hit the API when we need more windows.
   */
  private async performScan(): Promise<void> {
    const now = Date.now();

    // Skip scan if a previously-cataloged window covers the look-ahead
    if (
      this.latestEndDate &&
      this.latestEndDate.getTime() > now + this.config.minLookAheadMs
    ) {
      logger.debug(
        { latestEndDate: this.latestEndDate.toISOString() },
        "Sufficient look-ahead, skipping scan",
      );
      return;
    }

    await this.scanBtc15mMarkets();
  }

  /**
   * Scan for BTC 15-minute up/down markets.
   *
   * Uses Gamma API events endpoint with tag_slug=15M, then filters
   * to only BTC markets (excludes ETH, SOL, XRP).
   *
   * Example matching event slug: "btc-updown-15m-1770410700"
   * Example series slug: "btc-up-or-down-15m"
   */
  private async scanBtc15mMarkets(): Promise<void> {
    try {
      logger.debug("Scanning BTC 15M markets");
      const client = getPolymarketClient();

      const events = await client.getEvents({
        tag_slug: "15M",
        active: true,
        closed: false,
        limit: 50,
      });

      // Filter to BTC-only 15M events
      const btcEvents = events.filter((e) => this.isBtc15mEvent(e));

      let newCount = 0;

      for (const event of btcEvents) {
        const markets = event.markets ?? [];
        for (const market of markets) {
          if (market.closed || !market.active || !market.acceptingOrders)
            continue;

          const isNew = await this.catalogMarket(market);
          if (isNew) newCount++;
        }
      }

      logger.info(
        { events: btcEvents.length, new: newCount },
        "BTC 15M scan completed",
      );

      if (newCount > 0) {
        this.emit("marketsDiscovered", {
          category: "btc-15m",
          count: newCount,
        });
      }
    } catch (error) {
      logger.error({ error }, "Error scanning BTC 15M markets");
      this.emit("scanError", { category: "btc-15m", error });
    }
  }

  /**
   * Check if an event is a BTC 15M up/down market.
   */
  private isBtc15mEvent(event: GammaEvent): boolean {
    const slug = (event.slug || "").toLowerCase();
    if (slug.startsWith("btc-updown-15m")) return true;

    const seriesSlug = (event.seriesSlug || "").toLowerCase();
    if (seriesSlug === "btc-up-or-down-15m") return true;

    return false;
  }

  /**
   * Catalog a discovered market in the database.
   * Returns true if this is a newly discovered market.
   */
  private async catalogMarket(market: GammaMarket): Promise<boolean> {
    const marketId = market.id;
    const isNew = !this.discoveredMarkets.has(marketId);

    try {
      const endDate = market.endDate || null;
      const isActive = endDate ? new Date(endDate) > new Date() : true;

      const clobTokenIds = PolymarketClient.parseClobTokenIds(market);
      const outcomes = PolymarketClient.parseOutcomes(market);

      await upsertMarket(marketId, {
        conditionId: market.conditionId || undefined,
        slug: market.slug || undefined,
        question: market.question || undefined,
        clobTokenIds: clobTokenIds.length > 0 ? clobTokenIds : undefined,
        outcomes: outcomes.length > 0 ? outcomes : undefined,
        takerBaseFee: market.takerBaseFee ?? undefined,
        makerBaseFee: market.makerBaseFee ?? undefined,
        endDate: endDate || undefined,
        active: isActive,
        metadata: market as any,
      });

      // Update latestEndDate for smart scanning
      if (endDate) {
        const d = new Date(endDate);
        if (!this.latestEndDate || d > this.latestEndDate) {
          this.latestEndDate = d;
        }
      }

      if (isNew) {
        this.discoveredMarkets.add(marketId);
        logger.info(
          { marketId, question: market.question, endDate },
          "New BTC 15M market discovered",
        );
        this.emit("newMarket", { marketId, category: "btc-15m", market });
      }

      return isNew;
    } catch (error) {
      logger.error({ error, marketId }, "Failed to catalog market");
      return false;
    }
  }

  getDiscoveredCount(): number {
    return this.discoveredMarkets.size;
  }

  getDiscoveredMarkets(): string[] {
    return Array.from(this.discoveredMarkets);
  }
}

// Singleton instance
let scannerInstance: MarketScanner | null = null;

export function getMarketScanner(
  config?: Partial<ScannerConfig>,
): MarketScanner {
  if (!scannerInstance) {
    scannerInstance = new MarketScanner(config);
  }
  return scannerInstance;
}
