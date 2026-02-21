import WebSocket from "ws";
import { EventEmitter } from "events";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import { calculateBackoff } from "../utils/retry.js";
import { logAudit } from "../db/client.js";
import type { ClobWsMessage } from "../interfaces/index.js";

const logger = createModuleLogger("market-ws-watcher");

interface MarketSubscription {
  marketId: string;
  tokenId: string;
  marketCategory: string;
  marketEndTime: Date;
}

/**
 * Market WebSocket Watcher - Real-time orderbook monitoring for target markets
 *
 * Key differences from old ws-watcher:
 * - Subscribes to MARKETS not user positions
 * - Monitors orderbook updates for strategy opportunities
 * - Feeds data to StrategyEngine for evaluation
 * - Subscribes based on discovered markets from MarketScanner
 */
export class MarketWebSocketWatcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Markets we're actively watching
  private subscribedTokens = new Set<string>();
  private marketSubscriptions = new Map<string, MarketSubscription>();

  constructor() {
    super();
  }

  /**
   * Start the watcher service
   * Connects to Polymarket CLOB WebSocket
   */
  async start(): Promise<void> {
    logger.info("Starting Market WebSocket Watcher");
    this.shouldReconnect = true;

    try {
      await this.connect();
    } catch (error) {
      logger.error(
        {
          error:
            error instanceof Error
              ? error.message
              : String(error) || "Failed to start WebSocket watcher",
        },
        "Failed to start WebSocket watcher",
      );
      // Don't throw - let the system continue without WebSocket
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    logger.info("Stopping Market WebSocket Watcher");
    this.shouldReconnect = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.subscribedTokens.clear();
    this.marketSubscriptions.clear();
  }

  /**
   * Connect to Polymarket CLOB WebSocket
   */
  private async connect(): Promise<void> {
    if (this.ws) {
      logger.warn("WebSocket already exists, closing before reconnecting");
      this.ws.close();
    }

    const config = getConfig();
    // Per docs: market channel URL is wss://ws-subscriptions-clob.polymarket.com/ws/market
    // The config stores the base path; we append 'market' for the market channel
    let wsUrl = config.poly.clobWs;
    if (wsUrl && !wsUrl.endsWith("/market")) {
      wsUrl = wsUrl.endsWith("/") ? wsUrl + "market" : wsUrl + "/market";
    }

    if (!wsUrl || !wsUrl.startsWith("wss://")) {
      logger.error({ wsUrl }, "Invalid WebSocket URL");
      this.scheduleReconnect();
      return;
    }

    logger.info({ url: wsUrl }, "Connecting to Polymarket CLOB WebSocket");

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => this.handleOpen());
      this.ws.on("message", (data) => this.handleMessage(data));
      this.ws.on("error", (error) => this.handleError(error));
      this.ws.on("close", () => this.handleClose());

      // Add connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          logger.error("WebSocket connection timeout after 10 seconds");
          this.ws?.close();
        }
      }, 10000);

      // Clear timeout on successful connection
      this.ws.once("open", () => {
        clearTimeout(connectionTimeout);
      });
    } catch (error) {
      logger.error(
        {
          error:
            error instanceof Error
              ? error.message
              : String(error) || "Failed to create WebSocket",
          wsUrl,
        },
        "Failed to create WebSocket connection",
      );
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    logger.info("WebSocket connected");
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.emit("connected");

    // Start heartbeat
    this.startPingInterval();

    // Resubscribe to all markets if reconnecting
    if (this.marketSubscriptions.size > 0) {
      logger.info(
        { count: this.marketSubscriptions.size },
        "Resubscribing to markets after reconnect",
      );
      this.resubscribeToAllMarkets();
    }

    logAudit("info", "websocket", "Market WebSocket connected", {
      subscribedMarkets: this.marketSubscriptions.size,
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const raw = data.toString();

      // Handle known text responses that are not JSON
      if (raw === "PONG") return;
      if (raw === "INVALID OPERATION") {
        // This occurs when subscribing to non-existent or expired tokens - expected behavior
        logger.debug("Received INVALID OPERATION from WebSocket (token may not exist or is expired)");
        return;
      }

      const parsed = JSON.parse(raw);

      // Handle array messages — Polymarket WS may send arrays of events
      const messages: ClobWsMessage[] = Array.isArray(parsed)
        ? parsed
        : [parsed];

      for (const message of messages) {
        if (!message || typeof message !== "object") continue;

        // Handle different message types
        if (message.event_type === "book") {
          this.handleOrderbookUpdate(message);
        } else if (
          message.event_type === "tick" ||
          message.event_type === "price_change"
        ) {
          this.handlePriceTick(message);
        } else {
          // Log unknown event types at debug level so we can discover the actual format
          logger.debug(
            { event_type: message.event_type, keys: Object.keys(message) },
            "Unhandled WS event type",
          );
        }
      }
    } catch (error) {
      logger.error(
        { error, data: data.toString().slice(0, 200) },
        "Failed to parse WebSocket message",
      );
    }
  }

  private handleOrderbookUpdate(message: ClobWsMessage): void {
    const tokenId = message.asset_id;
    if (!tokenId || !this.subscribedTokens.has(tokenId)) {
      return; // Not a token we're watching
    }

    const subscription = this.marketSubscriptions.get(tokenId);
    if (!subscription) {
      return;
    }

    // Extract orderbook from message
    const orderbook = this.parseOrderbook(message);
    if (!orderbook) {
      return;
    }

    // Emit to StrategyEngine for evaluation
    this.emit("orderbookUpdate", {
      marketId: subscription.marketId,
      tokenId,
      marketCategory: subscription.marketCategory,
      marketEndTime: subscription.marketEndTime,
      orderbook,
      timestamp: new Date(),
    });
  }

  /**
   * Handle price_change events — the SINGLE authoritative price source.
   *
   * Each price_change contains best_bid/best_ask per asset after that order change.
   * We compute (best_bid + best_ask) / 2 as the midpoint — identical to what the
   * REST /midpoint endpoint returns, but in real-time.
   *
   * This is the ONLY event that emits priceUpdate. No other handlers compete.
   */
  private handlePriceTick(message: ClobWsMessage): void {
    const priceChanges = message.price_changes;
    if (priceChanges && Array.isArray(priceChanges)) {
      for (const change of priceChanges) {
        const tokenId = change.asset_id;
        if (!tokenId || !this.subscribedTokens.has(tokenId)) continue;

        const subscription = this.marketSubscriptions.get(tokenId);
        if (!subscription) continue;

        const bestBid = parseFloat(change.best_bid);
        const bestAsk = parseFloat(change.best_ask);

        if (isNaN(bestBid) || isNaN(bestAsk) || bestBid <= 0 || bestAsk <= 0)
          continue;

        const midpoint = (bestBid + bestAsk) / 2;

        this.emit("priceUpdate", {
          marketId: subscription.marketId,
          tokenId,
          marketCategory: subscription.marketCategory,
          marketEndTime: subscription.marketEndTime,
          price: midpoint,
          bestBid,
          bestAsk,
          timestamp: new Date(),
        });
      }
      return;
    }

    // Fallback: older tick format with direct asset_id + price
    const tokenId = message.asset_id;
    if (!tokenId || !this.subscribedTokens.has(tokenId)) return;

    const subscription = this.marketSubscriptions.get(tokenId);
    if (!subscription) return;

    const price = message.price ? parseFloat(message.price) : null;
    if (!price || price <= 0 || price >= 1) return;

    this.emit("priceUpdate", {
      marketId: subscription.marketId,
      tokenId,
      marketCategory: subscription.marketCategory,
      marketEndTime: subscription.marketEndTime,
      price,
      timestamp: new Date(),
    });
  }

  private handleError(error: Error): void {
    logger.error(
      {
        error: error?.message || error?.toString() || "Unknown WebSocket error",
        errorName: error?.name || "Unknown",
        stack: error?.stack || "No stack trace",
        isConnected: this.isConnected,
        wsUrl: getConfig().poly.clobWs,
      },
      "WebSocket error",
    );
    this.emit("error", error);
  }

  private handleClose(): void {
    logger.warn("WebSocket disconnected");
    this.isConnected = false;
    this.emit("disconnected");

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Clear any pending connection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const backoffMs = calculateBackoff(
      this.reconnectAttempts,
      60000,
      1000,
      300,
    );
    this.reconnectAttempts++;

    logger.info(
      { attempt: this.reconnectAttempts, backoffMs },
      "Scheduling WebSocket reconnect",
    );

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, backoffMs);
  }

  private startPingInterval(): void {
    // Per docs: Send "PING" text message every 5-10 seconds to maintain connection
    // Using 10 seconds as the interval
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        try {
          this.ws.send("PING");
        } catch (error) {
          logger.error({ error }, "Failed to send PING");
        }
      }
    }, 10000);
  }

  /**
   * Subscribe to a market token
   */
  private subscribeToMarket(tokenId: string): void {
    if (!this.ws || !this.isConnected) {
      logger.warn({ tokenId }, "Cannot subscribe - WebSocket not connected");
      return;
    }

    try {
      // Per docs: Market channel uses 'assets_ids' (token IDs)
      // https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
      const subscribeMessage = {
        assets_ids: [tokenId],
        operation: "subscribe",
        type: "market",
      };

      this.ws.send(JSON.stringify(subscribeMessage));
      this.subscribedTokens.add(tokenId);

      logger.info({ tokenId }, "Subscribed to market");
    } catch (error) {
      logger.error({ error, tokenId }, "Failed to subscribe to market");
    }
  }

  /**
   * Resubscribe to all markets with a single message (used on reconnect)
   */
  private resubscribeToAllMarkets(): void {
    if (!this.ws || !this.isConnected || this.marketSubscriptions.size === 0) {
      return;
    }

    try {
      const allTokenIds = Array.from(this.marketSubscriptions.keys());

      // Send single subscription message with all tokens
      const resubscribeMessage = {
        assets_ids: allTokenIds,
        type: "market",
      };

      this.ws.send(JSON.stringify(resubscribeMessage));

      // Mark all as subscribed
      for (const tokenId of allTokenIds) {
        this.subscribedTokens.add(tokenId);
      }

      logger.info(
        { tokenIds: allTokenIds, count: allTokenIds.length },
        "Resubscribed to all markets",
      );
    } catch (error) {
      logger.error({ error }, "Failed to resubscribe to all markets");
    }
  }

  /**
   * Update subscription with current list of all markets
   */
  private updateSubscription(): void {
    if (!this.ws || !this.isConnected) {
      return;
    }

    try {
      const allTokenIds = Array.from(this.marketSubscriptions.keys());

      if (allTokenIds.length === 0) {
        // No markets to subscribe to
        return;
      }

      // Send subscription message with all current tokens
      const subscriptionMessage = {
        assets_ids: allTokenIds,
        type: "market",
      };

      this.ws.send(JSON.stringify(subscriptionMessage));

      // Mark all as subscribed
      for (const tokenId of allTokenIds) {
        this.subscribedTokens.add(tokenId);
      }

      logger.info(
        { tokenIds: allTokenIds, count: allTokenIds.length },
        "Updated market subscription",
      );
    } catch (error) {
      logger.error({ error }, "Failed to update market subscription");
    }
  }

  /**
   * Add a market to watch
   */
  addMarket(subscription: MarketSubscription): void {
    const { tokenId, marketId, marketCategory, marketEndTime } = subscription;

    // Store subscription info
    this.marketSubscriptions.set(tokenId, subscription);

    // Subscribe if connected
    if (this.isConnected) {
      this.updateSubscription();
    } else {
      logger.debug({ tokenId }, "Market added but WebSocket not connected yet");
    }

    logger.info(
      {
        marketId,
        tokenId,
        category: marketCategory,
        endTime: marketEndTime,
        totalSubscriptions: this.marketSubscriptions.size,
      },
      "Market added to watch list",
    );
  }

  /**
   * Remove a market from watch list
   */
  removeMarket(tokenId: string): void {
    this.marketSubscriptions.delete(tokenId);
    this.subscribedTokens.delete(tokenId);

    // Update subscription with remaining markets
    if (this.ws && this.isConnected) {
      this.updateSubscription();
    }

    logger.info({ tokenId }, "Market removed from watch list");
  }

  /**
   * Parse orderbook from WebSocket message
   */
  private parseOrderbook(message: ClobWsMessage): {
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
  } | null {
    // CLOB WebSocket sends book updates with bids/asks arrays
    const { bids, asks } = message;

    if (!bids || !asks || !Array.isArray(bids) || !Array.isArray(asks)) {
      return null;
    }

    return {
      bids: bids.map((b) => ({
        price: String(b.price ?? (b as any)[0] ?? "0"),
        size: String(b.size ?? (b as any)[1] ?? "0"),
      })),
      asks: asks.map((a) => ({
        price: String(a.price ?? (a as any)[0] ?? "0"),
        size: String(a.size ?? (a as any)[1] ?? "0"),
      })),
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    isConnected: boolean;
    subscribedMarkets: number;
    reconnectAttempts: number;
  } {
    return {
      isConnected: this.isConnected,
      subscribedMarkets: this.marketSubscriptions.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Singleton instance
let watcherInstance: MarketWebSocketWatcher | null = null;

export function getMarketWebSocketWatcher(): MarketWebSocketWatcher {
  if (!watcherInstance) {
    watcherInstance = new MarketWebSocketWatcher();
  }
  return watcherInstance;
}
