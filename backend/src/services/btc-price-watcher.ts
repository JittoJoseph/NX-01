import { EventEmitter } from "events";
import WebSocket from "ws";
import { createModuleLogger } from "../utils/logger.js";
import { POLY_URLS } from "../types/index.js";
import type {
  RTDSMessage,
  BtcPriceData,
} from "../interfaces/websocket-types.js";

const logger = createModuleLogger("btc-price-watcher");

/**
 * Real-time BTC price watcher via Polymarket RTDS WebSocket.
 * Connects to wss://ws-live-data.polymarket.com and subscribes to
 * the crypto_prices topic for BTC (Binance source, relayed through Polymarket).
 *
 * Emits: "btcPriceUpdate" { price: number, timestamp: number }
 */
export class BtcPriceWatcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private currentPrice: number | null = null;
  private lastTimestamp: number = 0;
  private running = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly PING_INTERVAL = 5000; // every 5s per docs
  private static readonly MAX_RECONNECT_DELAY = 30000;
  private static readonly BASE_RECONNECT_DELAY = 1000;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
    logger.info("BTC price watcher started");
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    logger.info("BTC price watcher stopped");
  }

  getCurrentPrice(): BtcPriceData | null {
    if (this.currentPrice === null) return null;
    return { price: this.currentPrice, timestamp: this.lastTimestamp };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (!this.running) return;

    try {
      this.ws = new WebSocket(POLY_URLS.RTDS_WS);

      this.ws.on("open", () => {
        logger.info("RTDS WebSocket connected");
        this.reconnectAttempt = 0;

        // Subscribe to BTC price (Binance source via Polymarket RTDS)
        const subscribeMsg = JSON.stringify({
          action: "subscribe",
          subscriptions: [
            {
              topic: "crypto_prices",
              type: "update",
              filters: "btcusdt",
            },
          ],
        });
        this.ws!.send(subscribeMsg);
        logger.debug("Subscribed to RTDS crypto_prices (btcusdt)");

        // Start ping keepalive
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send("PING");
          }
        }, BtcPriceWatcher.PING_INTERVAL);
      });

      this.ws.on("message", (rawData: WebSocket.Data) => {
        try {
          const text = rawData.toString();
          if (text === "PONG") return;

          const msg: RTDSMessage = JSON.parse(text);
          if (
            msg.topic === "crypto_prices" &&
            msg.type === "update" &&
            msg.payload?.symbol === "btcusdt"
          ) {
            this.currentPrice = msg.payload.value;
            this.lastTimestamp = msg.payload.timestamp || msg.timestamp;
            this.emit("btcPriceUpdate", {
              price: this.currentPrice,
              timestamp: this.lastTimestamp,
            } satisfies BtcPriceData);
          }
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        logger.warn(
          { code, reason: reason.toString() },
          "RTDS WebSocket closed",
        );
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.on("error", (error: Error) => {
        logger.error({ error: error.message }, "RTDS WebSocket error");
      });
    } catch (error) {
      logger.error({ error }, "Failed to create RTDS WebSocket");
      this.scheduleReconnect();
    }
  }

  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const delay =
      Math.min(
        BtcPriceWatcher.BASE_RECONNECT_DELAY *
          Math.pow(2, this.reconnectAttempt),
        BtcPriceWatcher.MAX_RECONNECT_DELAY,
      ) +
      Math.random() * 500;

    this.reconnectAttempt++;
    logger.info(
      { delay: Math.round(delay), attempt: this.reconnectAttempt },
      "RTDS reconnecting",
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

// Singleton
let instance: BtcPriceWatcher | null = null;
export function getBtcPriceWatcher(): BtcPriceWatcher {
  if (!instance) instance = new BtcPriceWatcher();
  return instance;
}
