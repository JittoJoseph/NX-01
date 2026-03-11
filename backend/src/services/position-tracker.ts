import { createModuleLogger } from "../utils/logger.js";
import { tradingClient } from "./polymarket-trading-client.js";
import { updateTradeStatus, logAudit } from "../db/client.js";
import { balanceManager } from "./balance-manager.js";
import { POLY_URLS } from "../types/index.js";
import WebSocket from "ws";

const logger = createModuleLogger("position-tracker");

type TradeCallback = (
  orderId: string,
  update: {
    status: string;
    tradeIds: string[];
    transactionHashes: string[];
    price?: string;
    size?: string;
  },
) => void;

/**
 * Tracks trade lifecycle via the Polymarket User WebSocket channel.
 * Receives MATCHED → MINED → CONFIRMED updates and persists them.
 */
class PositionTracker {
  private ws: WebSocket | null = null;
  private apiKey: string = "";
  private apiSecret: string = "";
  private apiPassphrase: string = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private onTradeUpdate: TradeCallback | null = null;

  /** Map of polymarket order ID → our internal trade ID for lookups. */
  private orderToTradeId = new Map<string, string>();
  /** Condition IDs to subscribe to on the User WS channel. */
  private subscribedMarkets = new Set<string>();

  init(creds: {
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
  }): void {
    this.apiKey = creds.apiKey;
    this.apiSecret = creds.apiSecret;
    this.apiPassphrase = creds.apiPassphrase;
  }

  /** Register a callback for when a trade update is received. */
  setTradeUpdateCallback(cb: TradeCallback): void {
    this.onTradeUpdate = cb;
  }

  /** Track a new order so we can map WS updates to our trade ID. */
  trackOrder(polymarketOrderId: string, internalTradeId: string): void {
    this.orderToTradeId.set(polymarketOrderId, internalTradeId);
  }

  /** Stop tracking an order (after settlement). */
  untrackOrder(polymarketOrderId: string): void {
    this.orderToTradeId.delete(polymarketOrderId);
  }

  connect(): void {
    if (this.ws) return;

    try {
      this.ws = new WebSocket(POLY_URLS.USER_WS);

      this.ws.on("open", () => {
        logger.info("User WS channel connected");
        // Authenticate + subscribe using the documented User Channel format
        this.sendSubscription();

        // User channel requires PING every 10s to stay alive
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send("PING");
          }
        }, 10_000);
      });

      this.ws.on("message", (data) => {
        try {
          const text = data.toString();
          // PONG is a text response to our PING keepalive
          if (text === "PONG") return;
          const msg = JSON.parse(text);
          this.handleMessage(msg);
        } catch {
          // Ignore unparseable messages
        }
      });

      this.ws.on("close", () => {
        logger.warn("User WS channel disconnected — reconnecting in 5s");
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        logger.error({ error: err }, "User WS channel error");
      });
    } catch (err) {
      logger.error({ error: err }, "Failed to connect User WS channel");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5_000);
  }

  /**
   * Send the User WS subscription message in the documented format.
   * Includes credentials and any currently tracked market condition IDs.
   */
  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const markets = Array.from(this.subscribedMarkets);
    this.ws.send(
      JSON.stringify({
        auth: {
          apiKey: this.apiKey,
          secret: this.apiSecret,
          passphrase: this.apiPassphrase,
        },
        markets,
        type: "user",
      }),
    );
    logger.debug({ marketCount: markets.length }, "Sent User WS subscription");
  }

  /** Subscribe to updates for a specific market (condition ID). */
  subscribeMarket(conditionId: string): void {
    if (this.subscribedMarkets.has(conditionId)) return;
    this.subscribedMarkets.add(conditionId);
    // Re-send subscription to include the new market
    this.sendSubscription();
  }

  /** Unsubscribe from a specific market. */
  unsubscribeMarket(conditionId: string): void {
    this.subscribedMarkets.delete(conditionId);
  }

  private handleMessage(msg: any): void {
    // The User WS sends trade updates with type "trade"
    if (msg.type === "trade" || msg.event_type === "trade") {
      void this.handleTradeUpdate(msg);
      return;
    }
    // Auth confirmation
    if (msg.type === "auth" && msg.status === "success") {
      logger.info("User WS authenticated successfully");
      return;
    }
  }

  private async handleTradeUpdate(msg: any): Promise<void> {
    try {
      const orderId = msg.id || msg.order_id;
      if (!orderId) return;

      const internalTradeId = this.orderToTradeId.get(orderId);
      if (!internalTradeId) {
        logger.debug(
          { orderId },
          "Trade update for untracked order — ignoring",
        );
        return;
      }

      // Extract trade IDs and transaction hashes from associate_trades
      const associateTrades: any[] = msg.associate_trades || [];
      const tradeIds = associateTrades.map((t: any) => t.id).filter(Boolean);
      const txHashes = associateTrades
        .map((t: any) => t.transaction_hash)
        .filter(Boolean);

      // Determine the highest status (MATCHED < MINED < CONFIRMED)
      const statuses = associateTrades.map((t: any) => t.status);
      let highestStatus = "MATCHED";
      if (statuses.includes("CONFIRMED")) highestStatus = "CONFIRMED";
      else if (statuses.includes("MINED")) highestStatus = "MINED";

      // Update the DB
      await updateTradeStatus(internalTradeId, {
        tradeStatus: highestStatus,
        polymarketTradeIds: tradeIds,
        transactionHashes: txHashes,
        rawTradeData: msg,
        // Update status to CONFIRMED when all trades are confirmed
        ...(highestStatus === "CONFIRMED" ? { status: "CONFIRMED" } : {}),
      });

      // Notify the orchestrator callback
      if (this.onTradeUpdate) {
        this.onTradeUpdate(orderId, {
          status: highestStatus,
          tradeIds,
          transactionHashes: txHashes,
          price: msg.price,
          size: msg.size_matched,
        });
      }

      // Refresh balance when trade is confirmed
      if (highestStatus === "CONFIRMED") {
        balanceManager.invalidate();
      }

      logger.debug(
        {
          orderId,
          internalTradeId,
          highestStatus,
          tradeCount: tradeIds.length,
        },
        "Trade update processed",
      );
    } catch (err) {
      logger.error({ error: err }, "Error handling trade update from User WS");
    }
  }
}

export const positionTracker = new PositionTracker();
