import { z } from "zod";

// ============================================
// Window Configuration
// ============================================

export const MARKET_WINDOWS = ["5M", "15M", "1H", "4H", "1D"] as const;
export type MarketWindow = (typeof MARKET_WINDOWS)[number];

export interface WindowConfig {
  tagSlug: string;
  slugPrefix: string;
  seriesSlug: string;
  durationMs: number;
  category: string;
  label: string;
}

export const WINDOW_CONFIGS: Record<MarketWindow, WindowConfig> = {
  "5M": {
    tagSlug: "5M",
    slugPrefix: "btc-updown-5m",
    seriesSlug: "btc-up-or-down-5m",
    durationMs: 5 * 60 * 1000,
    category: "btc-5m",
    label: "BTC 5-Minute",
  },
  "15M": {
    tagSlug: "15M",
    slugPrefix: "btc-updown-15m",
    seriesSlug: "btc-up-or-down-15m",
    durationMs: 15 * 60 * 1000,
    category: "btc-15m",
    label: "BTC 15-Minute",
  },
  "1H": {
    tagSlug: "1H",
    slugPrefix: "btc-updown-1h",
    seriesSlug: "btc-up-or-down-1h",
    durationMs: 60 * 60 * 1000,
    category: "btc-1h",
    label: "BTC 1-Hour",
  },
  "4H": {
    tagSlug: "4H",
    slugPrefix: "btc-updown-4h",
    seriesSlug: "btc-up-or-down-4h",
    durationMs: 4 * 60 * 60 * 1000,
    category: "btc-4h",
    label: "BTC 4-Hour",
  },
  "1D": {
    tagSlug: "1D",
    slugPrefix: "btc-updown-1d",
    seriesSlug: "btc-up-or-down-1d",
    durationMs: 24 * 60 * 60 * 1000,
    category: "btc-1d",
    label: "BTC 1-Day",
  },
};

// ============================================
// API URL Constants (hardcoded, not env vars)
// ============================================

export const POLY_URLS = {
  GAMMA_API_BASE: "https://gamma-api.polymarket.com",
  CLOB_BASE: "https://clob.polymarket.com",
  CLOB_WS: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  RTDS_WS: "wss://ws-live-data.polymarket.com",
  DATA_API_BASE: "https://data-api.polymarket.com",
  USER_WS: "wss://ws-subscriptions-clob.polymarket.com/ws/user",
  POLYGON_RPC: "https://polygon-rpc.com",
} as const;

// CTF (Conditional Tokens Framework) contract addresses on Polygon
export const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
export const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// ============================================
// Hardcoded operational defaults (not worth env vars)
// ============================================

export const DEFAULTS = {
  HOST: "0.0.0.0",
  LOG_LEVEL: "info" as const,
  SCAN_INTERVAL_MS: 60_000,
  MAX_SIMULTANEOUS_POSITIONS: 5,
  MIN_BTC_DISTANCE_USD: 50,
  MOMENTUM_LOOKBACK_MS: 90_000,
  MOMENTUM_MIN_CHANGE_USD: 20,
} as const;

// ============================================
// Momentum Signal
// ============================================

export interface MomentumSignal {
  /** Net direction of BTC over the lookback window */
  direction: "UP" | "DOWN" | "NEUTRAL";
  /** Raw USD change over lookback window (positive = up, negative = down) */
  changeUsd: number;
  /** Lookback window in milliseconds */
  lookbackMs: number;
  /** Whether enough historical data exists to compute signal */
  hasData: boolean;
}

/**
 * Polymarket protocol minimum order size (in shares).
 * Returned by the CLOB orderbook API as `min_order_size`.
 * This is a protocol-level constant — not configurable.
 */
export const POLYMARKET_MIN_ORDER_SIZE = 5;

// ============================================
// Configuration Schema
// ============================================

export const ConfigSchema = z.object({
  db: z.object({
    url: z.string(),
  }),
  polymarket: z.object({
    privateKey: z.string().min(1),
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    apiPassphrase: z.string().min(1),
    funderAddress: z.string().min(1),
  }),
  portfolio: z.object({
    startingCapital: z.number().min(1).max(10_000_000),
  }),
  strategy: z.object({
    marketWindow: z.enum(MARKET_WINDOWS),
    tradeFromWindowSeconds: z.number().min(5).max(600),
    entryPriceThreshold: z.number().min(0.5).max(0.99),
    maxEntryPrice: z.number().min(0.5).max(0.99),
    stopLossPriceTrigger: z.number().min(0.01).max(0.95),
  }),
  admin: z.object({
    password: z.string().min(1),
  }),
  server: z.object({
    port: z.number().min(1).max(65535),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================
// Gamma API Types
// ============================================

export const GammaTagSchema = z.object({
  id: z.number().or(z.string()),
  label: z.string().optional(),
  slug: z.string().optional(),
});
export type GammaTag = z.infer<typeof GammaTagSchema>;

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
// CLOB API Types
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
  min_order_size: z.string().optional(),
  tick_size: z.string(),
  neg_risk: z.boolean(),
});

export type Orderbook = z.infer<typeof OrderbookSchema>;
export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;

export const PriceResponseSchema = z.object({ price: z.string() });
export type PriceResponse = z.infer<typeof PriceResponseSchema>;

export const MidpointResponseSchema = z.object({ mid: z.string() });
export type MidpointResponse = z.infer<typeof MidpointResponseSchema>;

// ============================================
// API Response Wrapper
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; retryAfter?: number };
}

// ============================================
// Polymarket Trading Types
// ============================================

/** Order lifecycle status in our system */
export type TradeStatus =
  | "PENDING"
  | "MATCHED"
  | "CONFIRMED"
  | "SETTLED"
  | "FAILED";

/** Polymarket trade status from User WS channel */
export type PolymarketTradeStatus =
  | "MATCHED"
  | "MINED"
  | "CONFIRMED"
  | "RETRYING"
  | "FAILED";

/** Result from placing a real order via the CLOB SDK */
export interface OrderResult {
  success: boolean;
  orderID?: string;
  /** Shares filled immediately (FAK partial fill) */
  filledShares?: number;
  /** Average fill price */
  avgPrice?: number;
  /** Total cost including fees */
  totalCost?: number;
  /** Raw response from Polymarket */
  rawResponse?: Record<string, unknown>;
  /** Error message if failed */
  errorMessage?: string;
}

/** User WS channel trade update payload */
export interface UserTradeUpdate {
  asset_id: string;
  associate_trades: Array<{
    id: string;
    status: PolymarketTradeStatus;
    match_time: string;
    last_update: string;
    outcome: string;
    maker_address: string;
    market: string;
    owner: string;
    price: string;
    side: string;
    size: string;
    fee_rate_bps: string;
    transaction_hash?: string;
    bucket_index?: string;
    type: string;
  }>;
  id: string;
  market: string;
  original_size: string;
  outcome: string;
  owner: string;
  price: string;
  side: string;
  size_matched: string;
  status: string;
  timestamp: string;
  type: string;
}

/** Data API position response */
export interface PolymarketPosition {
  asset: string;
  conditionId: string;
  curPrice: number;
  currentValue: number;
  initialValue: number;
  percentPnl: number;
  pnl: number;
  realizedPnl: number;
  size: number;
  avgPrice: number;
  unrealizedPnl: number;
}

/** Balance & allowance from CLOB API */
export interface BalanceAllowance {
  balance: string;
  allowance: string;
}
