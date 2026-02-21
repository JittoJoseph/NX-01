import axios, { AxiosInstance, AxiosError } from "axios";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import { withRetry, isRateLimitError } from "../utils/retry.js";
import {
  GammaMarket,
  GammaMarketSchema,
  GammaEvent,
  GammaEventSchema,
  Orderbook,
  OrderbookSchema,
  PriceResponse,
  PriceResponseSchema,
  MidpointResponse,
  MidpointResponseSchema,
} from "../types/index.js";
import { z } from "zod";
import { logAudit } from "../db/client.js";

const logger = createModuleLogger("polymarket-client");

/**
 * Polymarket API client — BTC 15-minute markets only.
 *
 * APIs used:
 *  1. Gamma API — market discovery & metadata
 *     Docs: https://docs.polymarket.com/developers/gamma-markets-api/overview
 *     Rate limit: 300 req / 10s (markets), 500 req / 10s (events)
 *
 *  2. CLOB API — orderbook, price, midpoint
 *     Docs: https://docs.polymarket.com/developers/CLOB/introduction
 *     Rate limit: 1500 req / 10s (book/price/midpoint)
 *
 *  3. CLOB WebSocket — real-time orderbook + price ticks (handled by market-ws-watcher)
 *     Docs: https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
 */
export class PolymarketClient {
  private gammaApi: AxiosInstance;
  private clobApi: AxiosInstance;
  private requestCounts = {
    gammaApi: 0,
    clobApi: 0,
    errors429: 0,
  };

  constructor() {
    const config = getConfig();

    // Gamma API client
    this.gammaApi = axios.create({
      baseURL: config.poly.gammaApiBase,
      timeout: 30000,
      headers: {
        Accept: "application/json",
        "User-Agent": "PenguinX/2.0",
      },
    });

    // CLOB API client
    this.clobApi = axios.create({
      baseURL: config.poly.clobBase,
      timeout: 30000,
      headers: {
        Accept: "application/json",
        "User-Agent": "PenguinX/2.0",
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    const handleError = (apiName: string) => async (error: AxiosError) => {
      if (error.response?.status === 429) {
        this.requestCounts.errors429++;
        logger.warn(
          { api: apiName, url: error.config?.url },
          "Rate limited (429)",
        );
        await logAudit("warn", "rate_limit", `Rate limited on ${apiName}`, {
          url: error.config?.url,
          retryAfter: error.response.headers["retry-after"],
        });
      }
      throw error;
    };

    this.gammaApi.interceptors.response.use((r) => {
      this.requestCounts.gammaApi++;
      return r;
    }, handleError("gammaApi"));

    this.clobApi.interceptors.response.use((r) => {
      this.requestCounts.clobApi++;
      return r;
    }, handleError("clobApi"));
  }

  getRequestCounts() {
    return { ...this.requestCounts };
  }

  // ============================================
  // Gamma API — Market Discovery
  // Docs: https://docs.polymarket.com/developers/gamma-markets-api/get-markets
  // ============================================

  /**
   * Get events with filtering.
   * Per docs: GET /events?active=true&closed=false&limit=N
   * Used to discover BTC 15M events (tag_slug=15M).
   * Rate limit: 500 requests / 10s
   */
  async getEvents(
    options: {
      limit?: number;
      offset?: number;
      closed?: boolean;
      active?: boolean;
      tag_slug?: string;
      slug?: string;
    } = {},
  ): Promise<GammaEvent[]> {
    return withRetry(
      async () => {
        const params: Record<string, string | number | boolean> = {
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
        };

        if (options.closed !== undefined) params.closed = options.closed;
        if (options.active !== undefined) params.active = options.active;
        if (options.tag_slug) params.tag_slug = options.tag_slug;
        if (options.slug) params.slug = options.slug;

        logger.debug({ params }, "Fetching events from Gamma API");
        const response = await this.gammaApi.get("/events", { params });

        const events = z.array(GammaEventSchema).parse(response.data);
        logger.debug({ count: events.length }, "Fetched events");
        return events;
      },
      {
        maxRetries: 3,
        retryOn: isRateLimitError,
      },
    );
  }

  /**
   * Get market by ID.
   * Per docs: GET /markets?id={id}
   */
  async getMarketById(marketId: string): Promise<GammaMarket | null> {
    return withRetry(
      async () => {
        const response = await this.gammaApi.get("/markets", {
          params: { id: marketId },
        });

        const markets = z.array(GammaMarketSchema).parse(response.data);
        return markets[0] ?? null;
      },
      {
        maxRetries: 3,
        retryOn: isRateLimitError,
      },
    );
  }

  // ============================================
  // CLOB API — Orderbook & Pricing
  // Docs: https://docs.polymarket.com/api-reference/orderbook/get-order-book-summary
  // ============================================

  /**
   * Get orderbook for a token.
   * Per docs: GET /book?token_id={token_id}
   * Rate limit: 1500 requests / 10s
   */
  async getOrderbook(
    tokenId: string,
  ): Promise<{ data: Orderbook; raw: unknown }> {
    return withRetry(
      async () => {
        const response = await this.clobApi.get("/book", {
          params: { token_id: tokenId },
        });

        const raw = response.data;
        const data = OrderbookSchema.parse(raw);
        return { data, raw };
      },
      {
        maxRetries: 3,
        retryOn: isRateLimitError,
      },
    );
  }

  /**
   * Get price for a token.
   * Per docs: GET /price?token_id={token_id}&side={side}
   * Rate limit: 1500 requests / 10s
   */
  async getPrice(
    tokenId: string,
    side: "BUY" | "SELL",
  ): Promise<PriceResponse> {
    return withRetry(
      async () => {
        const response = await this.clobApi.get("/price", {
          params: { token_id: tokenId, side },
        });
        return PriceResponseSchema.parse(response.data);
      },
      {
        maxRetries: 3,
        retryOn: isRateLimitError,
      },
    );
  }

  /**
   * Get midpoint price for a token.
   * Per docs: GET /midpoint?token_id={token_id}
   * Rate limit: 1500 requests / 10s
   */
  async getMidpoint(tokenId: string): Promise<MidpointResponse> {
    return withRetry(
      async () => {
        const response = await this.clobApi.get("/midpoint", {
          params: { token_id: tokenId },
        });
        return MidpointResponseSchema.parse(response.data);
      },
      {
        maxRetries: 3,
        retryOn: isRateLimitError,
      },
    );
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Parse clobTokenIds from Gamma market response.
   * The field is a JSON string like '["123456","789012"]'.
   */
  static parseClobTokenIds(market: GammaMarket): string[] {
    if (!market.clobTokenIds) return [];
    try {
      const parsed = JSON.parse(market.clobTokenIds);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Parse outcomes from Gamma market response.
   * The field is a JSON string like '["Up","Down"]'.
   */
  static parseOutcomes(market: GammaMarket): string[] {
    if (!market.outcomes) return [];
    try {
      const parsed = JSON.parse(market.outcomes);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Parse outcomePrices from Gamma market response.
   */
  static parseOutcomePrices(market: GammaMarket): number[] {
    if (!market.outcomePrices) return [];
    try {
      const parsed = JSON.parse(market.outcomePrices);
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  }
}

// Singleton instance
let clientInstance: PolymarketClient | null = null;

export function getPolymarketClient(): PolymarketClient {
  if (!clientInstance) {
    clientInstance = new PolymarketClient();
  }
  return clientInstance;
}
