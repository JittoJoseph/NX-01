/**
 * WebSocket types for Polymarket CLOB Market Channel
 * Docs: https://docs.polymarket.com/market-data/websocket/market-channel
 */

/** Raw CLOB WS message */
export interface ClobWsMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  timestamp?: number | string;
  // book event
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  hash?: string;
  // price_change event
  price_changes?: Array<{
    asset_id: string;
    price: string;
    size: string;
    side: string;
    hash: string;
    best_bid: string;
    best_ask: string;
  }>;
  // best_bid_ask event (requires custom_feature_enabled)
  best_bid?: string;
  best_ask?: string;
  spread?: string;
  // last_trade_price event
  price?: string;
  size?: string;
  side?: string;
  fee_rate_bps?: string;
  // tick_size_change event
  old_tick_size?: string;
  new_tick_size?: string;
  // market_resolved event (requires custom_feature_enabled)
  winning_asset_id?: string;
  winning_outcome?: string;
  id?: string;
  question?: string;
  slug?: string;
  assets_ids?: string[];
  outcomes?: string[];
  [key: string]: unknown;
}

/** Emitted price update event */
export interface PriceUpdateEvent {
  tokenId: string;
  bestBid: string;
  bestAsk: string;
  midpoint: number;
  timestamp: number;
}

/** Emitted best bid/ask event */
export interface BestBidAskEvent {
  tokenId: string;
  bestBid: string;
  bestAsk: string;
  spread: string;
  timestamp: number;
}

/** Emitted when a market resolves via WS */
export interface MarketResolvedEvent {
  marketId: string;
  conditionId: string;
  winningAssetId: string;
  winningOutcome: string;
  timestamp: number;
}

/** Emitted orderbook update */
export interface OrderbookUpdateEvent {
  tokenId: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  hash: string;
  timestamp: number;
}

/** Emitted tick size change */
export interface TickSizeChangeEvent {
  tokenId: string;
  oldTickSize: string;
  newTickSize: string;
  timestamp: number;
}

/** CLOB WS subscription message */
export interface MarketSubscriptionMessage {
  assets_ids: string[];
  type: "market";
  custom_feature_enabled: boolean;
}

/** CLOB WS dynamic subscribe/unsubscribe */
export interface SubscriptionUpdateMessage {
  assets_ids: string[];
  operation: "subscribe" | "unsubscribe";
}

/** RTDS real-time BTC price message */
export interface RTDSMessage {
  topic: string;
  type: string;
  timestamp: number;
  payload: {
    symbol: string;
    timestamp: number;
    value: number;
  };
}

/** BTC price data from RTDS */
export interface BtcPriceData {
  price: number;
  timestamp: number;
}
