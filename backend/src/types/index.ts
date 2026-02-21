import { z } from "zod";

// ============================================
// Configuration Schema
// ============================================

export const ConfigSchema = z.object({
  poly: z.object({
    gammaApiBase: z.string().url(),
    clobBase: z.string().url(),
    clobWs: z.string(),
  }),
  db: z.object({
    url: z.string(),
  }),
  simulation: z.object({
    amountUsd: z.number().min(0.01).max(1000),
    entryThreshold: z.number().min(0.5).max(0.99),
    entryThresholdMax: z.number().min(0.5).max(0.99),
    claimDelayMs: z.number().min(0),
  }),
  strategy: z.object({
    maxSimultaneousPositions: z.number().min(1).max(200),
    nearEndWindowSeconds: z.number().min(5).max(600),
    scanIntervalMs: z.number().min(10000),
    minLookAheadMs: z.number().min(60000),
  }),
  stopLoss: z.object({
    enabled: z.boolean(),
    threshold: z.number().min(0.10).max(0.75), // Trigger if price drops to this level
  }),
  wipe: z.object({
    password: z.string().min(1),
  }),
  server: z.object({
    port: z.number().min(1).max(65535),
    host: z.string(),
  }),
  logging: z.object({
    level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
  }),
  env: z.enum(["development", "production", "test"]),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================
// Gamma API - Tag
// ============================================
export const GammaTagSchema = z.object({
  id: z.number().or(z.string()),
  label: z.string().optional(),
  slug: z.string().optional(),
});

export type GammaTag = z.infer<typeof GammaTagSchema>;

// ============================================
// Gamma API - Markets
// Per docs: https://docs.polymarket.com/developers/gamma-markets-api/get-markets
// ============================================
export const GammaMarketSchema = z.object({
  id: z.string(),
  question: z.string().nullable().optional(),
  conditionId: z.string().optional(),
  slug: z.string().nullable().optional(),
  clobTokenIds: z.string().nullable().optional(),
  outcomes: z.string().nullable().optional(),
  outcomePrices: z.string().nullable().optional(),
  volume: z.string().nullable().optional(),
  volumeNum: z.number().nullable().optional(),
  liquidity: z.string().nullable().optional(),
  liquidityNum: z.number().nullable().optional(),
  active: z.boolean().nullable().optional(),
  closed: z.boolean().nullable().optional(),
  enableOrderBook: z.boolean().nullable().optional(),
  acceptingOrders: z.boolean().nullable().optional(),
  makerBaseFee: z.number().nullable().optional(),
  takerBaseFee: z.number().nullable().optional(),
  fee: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  bestBid: z.number().nullable().optional(),
  bestAsk: z.number().nullable().optional(),
  lastTradePrice: z.number().nullable().optional(),
  spread: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  resolutionSource: z.string().nullable().optional(),
  tags: z.array(GammaTagSchema).optional(),
  events: z.array(z.record(z.unknown())).optional(),
});

export type GammaMarket = z.infer<typeof GammaMarketSchema>;

// ============================================
// Gamma API - Event (contains one or more markets)
// Per docs: https://docs.polymarket.com/developers/gamma-markets-api/overview
// ============================================
export const GammaEventSchema = z.object({
  id: z.string().or(z.number()),
  slug: z.string().optional(),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
  closed: z.boolean().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  tags: z.array(GammaTagSchema).optional(),
  markets: z.array(GammaMarketSchema).optional(),
  seriesSlug: z.string().nullable().optional(),
});

export type GammaEvent = z.infer<typeof GammaEventSchema>;

// ============================================
// CLOB API - Orderbook
// Per docs: https://docs.polymarket.com/api-reference/orderbook/get-order-book-summary
// ============================================
export const OrderbookLevelSchema = z.object({
  price: z.string(),
  size: z.string(),
});

export const OrderbookSchema = z.object({
  market: z.string(),
  asset_id: z.string(),
  timestamp: z.string(),
  hash: z.string(),
  bids: z.array(OrderbookLevelSchema),
  asks: z.array(OrderbookLevelSchema),
  min_order_size: z.string(),
  tick_size: z.string(),
  neg_risk: z.boolean(),
});

export type Orderbook = z.infer<typeof OrderbookSchema>;
export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;

// ============================================
// CLOB API - Price
// Per docs: https://docs.polymarket.com/api-reference/pricing/get-market-price
// ============================================
export const PriceResponseSchema = z.object({
  price: z.string(),
});

export type PriceResponse = z.infer<typeof PriceResponseSchema>;

// ============================================
// CLOB API - Midpoint
// Per docs: https://docs.polymarket.com/api-reference/pricing/get-midpoint-price
// ============================================
export const MidpointResponseSchema = z.object({
  mid: z.string(),
});

export type MidpointResponse = z.infer<typeof MidpointResponseSchema>;

// ============================================
// API Response Wrappers
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryAfter?: number;
  };
}
