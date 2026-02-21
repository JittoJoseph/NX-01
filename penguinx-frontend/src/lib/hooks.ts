"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiClient, getWsClient } from "./api-client";
import type {
  SimulatedTrade,
  SimulatedPosition,
  SystemStats,
  DiscoveredMarket,
  StrategyTrigger,
  ExperimentRun,
  PerformanceMetrics,
  AuditLog,
  WsMessage,
  ActiveMarket,
  PriceTickUpdate,
} from "./types";

/**
 * Hook to fetch simulated trades.
 */
export function useTrades(
  status?: string,
  limit?: number,
  experimentId?: string,
) {
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getTrades({ status, limit, experimentId });
      setTrades(response.trades);
      setTotal(response.total);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [status, limit, experimentId]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  return { trades, total, loading, error, refetch: fetchTrades };
}

/**
 * Hook to fetch completed positions (CLOSED trades).
 * Uses the /api/trades endpoint with status=CLOSED filter.
 */
export function usePositions(limit?: number) {
  const [positions, setPositions] = useState<SimulatedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getTrades({ status: "CLOSED", limit });
      setPositions(response.trades);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return { positions, loading, error, refetch: fetchPositions };
}

/**
 * Hook to fetch system stats.
 * Only fetches once on mount.
 */
export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const api = getApiClient();
      const response = await api.getSystemStats();
      setStats(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}

/**
 * Hook to fetch discovered markets.
 */
export function useMarkets(active?: boolean) {
  const [markets, setMarkets] = useState<DiscoveredMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getMarkets({ active });
      setMarkets(response.markets);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  return { markets, loading, error, refetch: fetchMarkets };
}

/**
 * Hook to fetch strategy triggers.
 */
export function useTriggers(limit?: number, executed?: boolean) {
  const [triggers, setTriggers] = useState<StrategyTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTriggers = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getTriggers({ limit, executed });
      setTriggers(response.triggers);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [limit, executed]);

  useEffect(() => {
    fetchTriggers();
  }, [fetchTriggers]);

  return { triggers, loading, error, refetch: fetchTriggers };
}

/**
 * Hook to fetch experiment runs.
 */
export function useExperiments(status?: string) {
  const [experiments, setExperiments] = useState<ExperimentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchExperiments = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getExperiments({ status });
      setExperiments(response.experiments);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  return { experiments, loading, error, refetch: fetchExperiments };
}

/**
 * Hook to fetch portfolio performance with time period selection.
 * Only fetches once on mount and when period changes.
 */
export function usePerformance(period: "1D" | "1W" | "1M" | "ALL" = "1D") {
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchPerformance = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        const api = getApiClient();
        const response = await api.getPerformance(period);
        setPerformance(response);
        setError(null);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period],
  );

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  const refetch = useCallback(() => {
    fetchPerformance(true);
  }, [fetchPerformance]);

  return { performance, loading, refreshing, error, refetch };
}

/**
 * Hook to fetch audit logs.
 */
export function useAuditLogs(params?: {
  level?: string;
  category?: string;
  limit?: number;
}) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getAuditLogs(params);
      setLogs(response.logs);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [params?.level, params?.category, params?.limit]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { logs, loading, error, refetch: fetchLogs };
}

/**
 * Hook for WebSocket connection.
 */
export function useWsConnection() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const checkConnection = () => setIsConnected(ws.isConnected());
    checkConnection();

    const unsubscribe = ws.on("connected", () => setIsConnected(true));
    const interval = setInterval(checkConnection, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  return isConnected;
}

/**
 * Hook for subscribing to specific WebSocket events.
 */
export function useWsEvent(
  eventType: string,
  callback: (message: WsMessage) => void,
) {
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();
    const unsubscribe = ws.on(eventType, callback);
    return unsubscribe;
  }, [eventType, callback]);
}

/**
 * Hook for active market data with stable, flicker-free prices.
 *
 * Architecture — WebSocket-first real-time updates:
 * 1. REST fetch once on mount → bootstrap initial data
 * 2. WS `activeMarketUpdate` → triggers refetch when new market is promoted
 * 3. WS `priceTickUpdate` → live prices from Polymarket WS (best_bid/best_ask midpoint)
 *
 * The backend derives prices from ONE source: WS price_change events.
 * Prices are stored in a useRef to avoid re-renders on every tick.
 * Only triggers a re-render when the cent-level display value changes.
 */
export function useActiveMarket(): ActiveMarket | null {
  const [activeMarket, setActiveMarket] = useState<ActiveMarket | null>(null);

  // Ref to hold the latest prices without triggering re-renders
  const priceRef = useRef<{ upPrice: number; downPrice: number }>({
    upPrice: 0,
    downPrice: 0,
  });

  // Ref for the current displayed cents (used for change detection)
  const displayedCentsRef = useRef<{ up: number; down: number }>({
    up: 0,
    down: 0,
  });

  // Ref to current marketId to validate price ticks belong to current market
  const marketIdRef = useRef<string | null>(null);

  // Ref to track component mount status
  const mountedRef = useRef(true);

  // Fetch function stored in ref so it can be called from WS handlers
  const fetchActiveRef = useRef<(() => Promise<void>) | undefined>(undefined);
  fetchActiveRef.current = async () => {
    try {
      const api = getApiClient();
      const data = await api.getActiveMarket();
      if (!mountedRef.current) return;

      if (!data) {
        priceRef.current = { upPrice: 0, downPrice: 0 };
        displayedCentsRef.current = { up: 0, down: 0 };
        marketIdRef.current = null;
        setActiveMarket(null);
        return;
      }

      marketIdRef.current = data.marketId;

      // Update price ref from REST data
      if (data.upPrice > 0 && data.upPrice < 1) {
        priceRef.current.upPrice = data.upPrice;
      }
      if (data.downPrice > 0 && data.downPrice < 1) {
        priceRef.current.downPrice = data.downPrice;
      }

      // Always apply latest ref prices to the state
      const newUp = Math.round(priceRef.current.upPrice * 100);
      const newDown = Math.round(priceRef.current.downPrice * 100);
      displayedCentsRef.current = { up: newUp, down: newDown };

      setActiveMarket({
        ...data,
        upPrice: priceRef.current.upPrice,
        downPrice: priceRef.current.downPrice,
      });
    } catch {
      // Backend might not have an active market
    }
  };

  // REST fetch ONCE on mount — bootstrap initial data only
  useEffect(() => {
    mountedRef.current = true;
    fetchActiveRef.current?.();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // WS — structural updates (new market promoted, bet taken, market ended)
  // Triggers refetch when a NEW market is detected (different marketId)
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();
    const unsubscribe = ws.on("activeMarketUpdate", (msg: WsMessage) => {
      const wsData = msg.data as ActiveMarket | null;

      if (!wsData) {
        priceRef.current = { upPrice: 0, downPrice: 0 };
        displayedCentsRef.current = { up: 0, down: 0 };
        marketIdRef.current = null;
        setActiveMarket(null);
        // Refetch to check if backend has a new market ready
        setTimeout(() => fetchActiveRef.current?.(), 1000);
        return;
      }

      // NEW MARKET detected — refetch from API for complete data
      if (marketIdRef.current !== wsData.marketId) {
        marketIdRef.current = wsData.marketId;
        // Apply WS data immediately for instant UI update
        if (wsData.upPrice > 0) priceRef.current.upPrice = wsData.upPrice;
        if (wsData.downPrice > 0) priceRef.current.downPrice = wsData.downPrice;
        const newUp = Math.round(priceRef.current.upPrice * 100);
        const newDown = Math.round(priceRef.current.downPrice * 100);
        displayedCentsRef.current = { up: newUp, down: newDown };
        setActiveMarket({
          ...wsData,
          upPrice: priceRef.current.upPrice,
          downPrice: priceRef.current.downPrice,
        });
        // Also refetch to ensure we have complete data (e.g., activeBet info)
        fetchActiveRef.current?.();
        return;
      }

      // Same market — merge structural changes (e.g., activeBet updated), KEEP ref prices
      setActiveMarket((prev) => ({
        ...wsData,
        upPrice: priceRef.current.upPrice || wsData.upPrice,
        downPrice: priceRef.current.downPrice || wsData.downPrice,
      }));
    });
    return unsubscribe;
  }, []);

  // WS — live price ticks (from Polymarket WS best_bid/best_ask + last_trade_price)
  // Only triggers re-render when displayed cent value changes
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();
    const unsubscribe = ws.on("priceTickUpdate", (msg: WsMessage) => {
      const tick = msg.data as PriceTickUpdate | null;
      if (!tick) return;

      // Validate this tick is for our current market
      if (tick.marketId !== marketIdRef.current) return;

      // Update ref with new prices (no re-render)
      if (tick.upPrice > 0 && tick.upPrice < 1) {
        priceRef.current.upPrice = tick.upPrice;
      }
      if (tick.downPrice > 0 && tick.downPrice < 1) {
        priceRef.current.downPrice = tick.downPrice;
      }

      // Check if display value actually changed (cent-level)
      const newUpCents = Math.round(priceRef.current.upPrice * 100);
      const newDownCents = Math.round(priceRef.current.downPrice * 100);

      if (
        newUpCents !== displayedCentsRef.current.up ||
        newDownCents !== displayedCentsRef.current.down
      ) {
        displayedCentsRef.current = { up: newUpCents, down: newDownCents };

        // Only NOW trigger a re-render
        setActiveMarket((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            upPrice: priceRef.current.upPrice,
            downPrice: priceRef.current.downPrice,
          };
        });
      }
    });
    return unsubscribe;
  }, []);

  return activeMarket;
}

/**
 * Hook to track system status and connectivity.
 * Fetches once on mount and sets backend as active.
 */
export function useSystemStatus() {
  const [backendActive, setBackendActive] = useState(true);
  const wsConnected = useWsConnection();

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const api = getApiClient();
        await api.ping();
        setBackendActive(true);
      } catch {
        setBackendActive(false);
      }
    };

    // Fetch once on mount
    checkBackend();
  }, []);

  return { backendActive, wsConnected };
}
