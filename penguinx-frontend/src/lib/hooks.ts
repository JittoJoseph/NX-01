"use client";

import { useState, useEffect, useCallback } from "react";
import { getApiClient, getWsClient } from "./api-client";
import type {
  SimulatedTrade,
  SystemStats,
  DiscoveredMarket,
  ExperimentRun,
  PerformanceMetrics,
  AuditLog,
  WsMessage,
} from "./types";

/**
 * Hook to fetch simulated trades.
 */
export function useTrades(status?: string, limit?: number) {
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getTrades({ status, limit });
      setTrades(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [status, limit]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  return { trades, loading, error, refetch: fetchTrades };
}

/**
 * Hook to fetch system stats.
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
 * Hook to fetch active markets.
 */
export function useActiveMarkets() {
  const [markets, setMarkets] = useState<DiscoveredMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getActiveMarkets();
      setMarkets(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  return { markets, loading, error, refetch: fetchMarkets };
}

/**
 * Hook to fetch experiment runs.
 */
export function useExperiments() {
  const [experiments, setExperiments] = useState<ExperimentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchExperiments = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getExperiments();
      setExperiments(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  return { experiments, loading, error, refetch: fetchExperiments };
}

/**
 * Hook to fetch portfolio performance with time period selection.
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
export function useAuditLogs(limit?: number) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getAuditLogs({ limit });
      setLogs(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

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

    const interval = setInterval(checkConnection, 10000);

    return () => {
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
 * Hook to track system status and connectivity.
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

    checkBackend();
  }, []);

  return { backendActive, wsConnected };
}
