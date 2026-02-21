/**
 * API client for the PenguinX BTC 15-minute claim simulation backend.
 */

import type {
  TradesResponse,
  SystemStats,
  MarketsResponse,
  TriggersResponse,
  ExperimentsResponse,
  PerformanceMetrics,
  AuditResponse,
  HealthResponse,
  WsMessage,
  ActiveMarket,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "https://penguinx.onrender.com";
const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_BASE_URL || "wss://penguinx.onrender.com";

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retries = 3,
  delay = 1000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error as Error;
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getHealth(): Promise<HealthResponse> {
    return fetchWithRetry(`${this.baseUrl}/health`);
  }

  async ping(): Promise<{ message: string }> {
    return fetchWithRetry(`${this.baseUrl}/ping`);
  }

  async getActiveMarket(): Promise<ActiveMarket | null> {
    return fetchWithRetry(`${this.baseUrl}/api/active-market`);
  }

  async getSystemStats(): Promise<SystemStats> {
    return fetchWithRetry(`${this.baseUrl}/api/system/stats`);
  }

  async getTrades(params?: {
    status?: string;
    limit?: number;
    offset?: number;
    experimentId?: string;
  }): Promise<TradesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    if (params?.experimentId)
      searchParams.set("experimentId", params.experimentId);

    const qs = searchParams.toString();
    return fetchWithRetry(`${this.baseUrl}/api/trades${qs ? `?${qs}` : ""}`);
  }

  async getMarkets(params?: { active?: boolean }): Promise<MarketsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.active !== undefined)
      searchParams.set("active", String(params.active));

    const qs = searchParams.toString();
    return fetchWithRetry(`${this.baseUrl}/api/markets${qs ? `?${qs}` : ""}`);
  }

  async getTriggers(params?: {
    limit?: number;
    executed?: boolean;
  }): Promise<TriggersResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.executed !== undefined)
      searchParams.set("executed", String(params.executed));

    const qs = searchParams.toString();
    return fetchWithRetry(`${this.baseUrl}/api/triggers${qs ? `?${qs}` : ""}`);
  }

  async getExperiments(params?: {
    status?: string;
  }): Promise<ExperimentsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);

    const qs = searchParams.toString();
    return fetchWithRetry(
      `${this.baseUrl}/api/experiments${qs ? `?${qs}` : ""}`,
    );
  }

  async getPerformance(
    period: "1D" | "1W" | "1M" | "ALL" = "1D",
  ): Promise<PerformanceMetrics> {
    const searchParams = new URLSearchParams();
    searchParams.set("period", period);
    return fetchWithRetry(
      `${this.baseUrl}/api/performance?${searchParams.toString()}`,
    );
  }

  async getAuditLogs(params?: {
    level?: string;
    category?: string;
    limit?: number;
  }): Promise<AuditResponse> {
    const searchParams = new URLSearchParams();
    if (params?.level) searchParams.set("level", params.level);
    if (params?.category) searchParams.set("category", params.category);
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    return fetchWithRetry(`${this.baseUrl}/api/audit${qs ? `?${qs}` : ""}`);
  }
}

/**
 * WebSocket client for real-time updates.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private listeners: Map<string, Set<(data: WsMessage) => void>> = new Map();
  private isConnecting = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(wsUrl: string = WS_BASE_URL) {
    this.wsUrl = `${wsUrl}/ws/simulated`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          this.emit(message.type, message);
          this.emit("*", message);
        } catch {
          // Ignore invalid messages
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.stopHeartbeat();
        this.attemptReconnect();
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };
    } catch {
      this.isConnecting = false;
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
  }

  on(type: string, callback: (data: WsMessage) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private emit(type: string, message: WsMessage): void {
    this.listeners.get(type)?.forEach((cb) => cb(message));
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

// Singleton instances
let apiClient: ApiClient | null = null;
let wsClient: WsClient | null = null;

export function getApiClient(): ApiClient {
  if (!apiClient) {
    apiClient = new ApiClient();
  }
  return apiClient;
}

export function getWsClient(): WsClient {
  if (!wsClient) {
    wsClient = new WsClient();
  }
  return wsClient;
}
