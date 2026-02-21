/**
 * WebSocket message and event interfaces for CLOB WebSocket communication.
 * Per docs: https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
 */

/**
 * Raw message received from Polymarket CLOB WebSocket.
 */
export interface ClobWsMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  price?: string;
  size?: string;
  side?: string;
  timestamp?: number | string;
  // Orderbook update fields (book event)
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  // price_change event fields (per docs: Market Channel)
  price_changes?: Array<{
    asset_id: string;
    price: string;
    size: string;
    side: string;
    hash: string;
    best_bid: string;
    best_ask: string;
  }>;
  // best_bid_ask event fields
  best_bid?: string;
  best_ask?: string;
  spread?: string;
  // last_trade_price event fields
  fee_rate_bps?: string;
  [key: string]: unknown;
}

/**
 * Price update event emitted by WebSocketWatcher.
 */
export interface PriceUpdateEvent {
  tokenId: string | undefined;
  price: string | undefined;
  timestamp: number | undefined;
}

/**
 * Trade event emitted by WebSocketWatcher.
 */
export interface TradeEvent {
  tokenId: string | undefined;
  price: string | undefined;
  size: string | undefined;
  side: string | undefined;
  timestamp: number | undefined;
}

/**
 * WebSocket disconnection event data.
 */
export interface DisconnectedEvent {
  code: number;
  reason: string;
}

/**
 * CLOB WebSocket subscription message for MARKET channel.
 * Per docs: https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
 * Use `assets_ids` (token IDs) for market channel.
 */
export interface MarketSubscriptionMessage {
  assets_ids: string[];
  type: "market";
}

/**
 * CLOB WebSocket subscription update message.
 * Used to subscribe/unsubscribe to additional assets after initial connection.
 */
export interface SubscriptionUpdateMessage {
  assets_ids: string[];
  operation: "subscribe" | "unsubscribe";
}
