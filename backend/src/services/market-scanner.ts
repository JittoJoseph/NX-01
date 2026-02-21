import { EventEmitter } from "events";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import {
  WINDOW_CONFIGS,
  type GammaEvent,
  type GammaMarket,
} from "../types/index.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import { insertMarketIfNew } from "../db/client.js";

const logger = createModuleLogger("market-scanner");

/**
 * Discovers BTC markets for the configured window type from Polymarket Gamma API.
 *
 * Emits:
 *   "newMarket" — { market: GammaMarket, event: GammaEvent }
 *
 * Deduplication: tracks discovered market IDs in-memory so each market is
 * emitted and written to the DB exactly once.
 */
export class MarketScanner extends EventEmitter {
  private client: PolymarketClient;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private knownMarketIds: Set<string> = new Set();
  private discoveredCount = 0;
  private running = false;

  constructor() {
    super();
    this.client = getPolymarketClient();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const config = getConfig();
    const windowConfig = WINDOW_CONFIGS[config.strategy.marketWindow];

    logger.info(
      { window: config.strategy.marketWindow, tagSlug: windowConfig.tagSlug },
      "Starting market scanner",
    );

    // Initial scan
    await this.scan();

    // Periodic scanning
    this.scanInterval = setInterval(() => {
      this.scan().catch((err) =>
        logger.error({ error: err }, "Scan iteration failed"),
      );
    }, config.strategy.scanIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    logger.info("Market scanner stopped");
  }

  getDiscoveredCount(): number {
    return this.discoveredCount;
  }

  async scan(): Promise<void> {
    const config = getConfig();
    const windowConfig = WINDOW_CONFIGS[config.strategy.marketWindow];

    try {
      // Only fetch events whose endDate is >= 30 seconds ago.
      // This excludes old unresolved markets (Polymarket keeps them as
      // active=true/closed=false indefinitely until oracle settlement) while
      // always including the current trading window.
      const endDateMin = new Date(Date.now() - 30_000).toISOString();

      const events = await this.client.getEvents({
        tag_slug: windowConfig.tagSlug,
        active: true,
        closed: false,
        end_date_min: endDateMin,
        limit: 50,
      });

      let newMarketsFound = 0;

      for (const event of events) {
        if (!this.isBtcWindowEvent(event, windowConfig)) continue;

        for (const market of event.markets ?? []) {
          // Skip markets we've already processed in a previous scan
          if (this.knownMarketIds.has(market.id)) continue;

          const wasNew = await this.catalogMarket(market, windowConfig);
          this.knownMarketIds.add(market.id);

          if (wasNew) {
            newMarketsFound++;
            this.discoveredCount++;
            this.emit("newMarket", { market, event });
          }
        }
      }

      if (newMarketsFound > 0) {
        logger.info(
          { newMarketsFound, total: this.discoveredCount },
          "Scan complete — new markets found",
        );
      } else {
        logger.debug("Scan complete — no new markets");
      }
    } catch (error) {
      logger.error({ error }, "Market scan failed");
    }
  }

  /**
   * Check if a Gamma event is a BTC event for our configured window.
   */
  private isBtcWindowEvent(
    event: GammaEvent,
    windowConfig: (typeof WINDOW_CONFIGS)[keyof typeof WINDOW_CONFIGS],
  ): boolean {
    const slug = event.slug ?? "";
    const seriesSlug = event.seriesSlug ?? "";

    // Match by slug prefix or series slug
    if (
      slug.startsWith(windowConfig.slugPrefix) ||
      seriesSlug === windowConfig.seriesSlug
    ) {
      return true;
    }

    // Also check if "btc" appears in slug/title as fallback
    const title = event.title?.toLowerCase() ?? "";
    const hasbtc =
      slug.includes("btc") ||
      title.includes("btc") ||
      title.includes("bitcoin");
    const hasWindow =
      slug.includes(windowConfig.slugPrefix) ||
      seriesSlug.includes(windowConfig.seriesSlug);

    return hasbtc && hasWindow;
  }

  /**
   * Catalog a discovered market into the database (INSERT only, no UPDATE).
   * Returns true if the market was truly new (inserted), false if it already existed.
   */
  private async catalogMarket(
    market: GammaMarket,
    windowConfig: (typeof WINDOW_CONFIGS)[keyof typeof WINDOW_CONFIGS],
  ): Promise<boolean> {
    try {
      const tokenIds = PolymarketClient.parseClobTokenIds(market);
      const outcomes = PolymarketClient.parseOutcomes(market);
      const targetPrice = PolymarketClient.parseTargetPrice(market.question);

      const wasNew = await insertMarketIfNew(market.id, {
        conditionId: market.conditionId,
        slug: market.slug ?? undefined,
        question: market.question ?? undefined,
        clobTokenIds: tokenIds,
        outcomes,
        windowType: getConfig().strategy.marketWindow,
        category: windowConfig.category,
        endDate: market.endDate,
        targetPrice,
        active: market.active ?? true,
        metadata: market,
      });

      return wasNew;
    } catch (error) {
      logger.error({ error, marketId: market.id }, "Failed to catalog market");
      return false;
    }
  }
}

// Singleton
let instance: MarketScanner | null = null;
export function getMarketScanner(): MarketScanner {
  if (!instance) instance = new MarketScanner();
  return instance;
}
