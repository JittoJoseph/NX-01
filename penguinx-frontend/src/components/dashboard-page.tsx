"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Header } from "./header";
import { SystemStatusIndicator } from "./system-status-indicator";
import { OverviewPanels } from "./overview-panels";
import { TradesTable } from "./trades-table";
import { TradeDetailPopup } from "./trade-detail-popup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useTrades,
  useSystemStats,
  useActiveMarkets,
  useWsConnection,
  useWsEvent,
} from "@/lib/hooks";
import type {
  SimulatedTrade,
  DiscoveredMarket,
  SystemStats,
} from "@/lib/types";
import { MARKET_WINDOW_LABELS, type MarketWindow } from "@/lib/types";

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("trades");
  const [selectedTrade, setSelectedTrade] = useState<SimulatedTrade | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);
  const [btcPrice, setBtcPrice] = useState<{
    price: number;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Data hooks
  const {
    trades,
    loading: tradesLoading,
    refetch: refetchTrades,
  } = useTrades(undefined, 100);
  const { stats, loading: statsLoading } = useSystemStats();
  const {
    markets,
    loading: marketsLoading,
    refetch: refetchMarkets,
  } = useActiveMarkets();

  // WebSocket live events
  useWsConnection();

  // Update BTC price from systemState broadcasts
  useWsEvent(
    "systemState",
    useCallback((msg: any) => {
      const data = msg?.data;
      if (data?.btcPrice) {
        setBtcPrice(data.btcPrice);
      }
    }, []),
  );

  // Refetch trades on trade events
  useWsEvent(
    "tradeOpened",
    useCallback(() => {
      refetchTrades();
    }, [refetchTrades]),
  );

  useWsEvent(
    "tradeResolved",
    useCallback(() => {
      refetchTrades();
    }, [refetchTrades]),
  );

  useWsEvent(
    "stopLossTriggered",
    useCallback(() => {
      refetchTrades();
    }, [refetchTrades]),
  );

  // Derive counts
  const openTrades = useMemo(
    () => trades.filter((t) => t.status === "OPEN"),
    [trades],
  );
  const closedTrades = useMemo(
    () => trades.filter((t) => t.status === "CLOSED"),
    [trades],
  );

  // Determine window label from config
  const windowLabel = stats?.config?.marketWindow
    ? (MARKET_WINDOW_LABELS[stats.config.marketWindow as MarketWindow] ??
      stats.config.marketWindow)
    : "BTC WINDOW";

  // Current BTC price (prefer WS-updated, fallback to stats)
  const currentBtcPrice = btcPrice ?? stats?.btcPrice ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />

      <main className="flex-1 px-4 py-4 pb-16 max-w-7xl mx-auto w-full space-y-4">
        {/* ── BTC Status Panel ────────────── */}
        <BtcStatusPanel
          stats={stats}
          btcPrice={currentBtcPrice}
          activeMarketsCount={markets.length}
          openTradesCount={openTrades.length}
          windowLabel={windowLabel}
          mounted={mounted}
        />

        {/* ── Performance overview ──────── */}
        <OverviewPanels />

        {/* ── Two-column: Trades + Sidebar ─────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Left: Trades panel */}
          <div className="border border-border/30 rounded-lg bg-card/30 overflow-hidden">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
                <TabsList className="bg-transparent gap-2 h-auto p-0">
                  <TabsTrigger
                    value="trades"
                    className="data-[state=active]:bg-muted/40 rounded px-3 py-1 text-xs font-mono"
                  >
                    TRADES ({trades.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="markets"
                    className="data-[state=active]:bg-muted/40 rounded px-3 py-1 text-xs font-mono"
                  >
                    MARKETS ({markets.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="trades" className="mt-0">
                <TradesTable
                  trades={trades}
                  loading={tradesLoading}
                  onTradeClick={setSelectedTrade}
                />
              </TabsContent>

              <TabsContent value="markets" className="mt-0">
                <MarketsPanel
                  markets={markets}
                  loading={marketsLoading}
                  refetch={refetchMarkets}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: Sidebar */}
          <div className="space-y-4">
            {/* System stats */}
            <SidebarCard title="SYSTEM">
              {statsLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse font-mono py-4 text-center">
                  Loading...
                </div>
              ) : stats ? (
                <div className="space-y-2 text-xs font-mono">
                  <StatRow label="Window Type" value={windowLabel} />
                  <StatRow
                    label="Open Positions"
                    value={stats.orchestrator.openPositions.toString()}
                  />
                  <StatRow
                    label="Active Markets"
                    value={stats.orchestrator.activeMarkets.toString()}
                  />
                  <StatRow
                    label="Scan Cycles"
                    value={stats.orchestrator.cycleCount.toString()}
                  />
                  <StatRow
                    label="Discovered"
                    value={stats.orchestrator.scanner.discoveredCount.toString()}
                  />
                  <StatRow
                    label="Scanner"
                    value={stats.orchestrator.running ? "ACTIVE" : "IDLE"}
                    accent={stats.orchestrator.running}
                  />
                  <StatRow
                    label="CLOB WS"
                    value={
                      stats.orchestrator.ws.connected
                        ? "CONNECTED"
                        : "DISCONNECTED"
                    }
                    accent={stats.orchestrator.ws.connected}
                  />
                  <StatRow
                    label="BTC Feed"
                    value={stats.orchestrator.btcConnected ? "LIVE" : "OFFLINE"}
                    accent={stats.orchestrator.btcConnected}
                  />
                </div>
              ) : null}
            </SidebarCard>

            {/* Configuration */}
            <SidebarCard title="CONFIGURATION">
              {stats?.config ? (
                <div className="space-y-2 text-xs font-mono">
                  <StatRow
                    label="Entry Threshold"
                    value={`${(stats.config.entryPriceThreshold * 100).toFixed(0)}¢`}
                  />
                  <StatRow
                    label="Trade Window"
                    value={`${stats.config.tradeFromWindowSeconds}s`}
                  />
                  <StatRow
                    label="Sim Amount"
                    value={`$${stats.config.simulationAmountUsd}`}
                  />
                  <StatRow
                    label="Max Positions"
                    value={stats.config.maxSimultaneousPositions.toString()}
                  />
                  <StatRow
                    label="BTC Min Dist"
                    value={`$${stats.config.minBtcDistanceUsd}`}
                  />
                  <StatRow
                    label="Stop Loss"
                    value={`${(stats.config.stopLossThreshold * 100).toFixed(0)}¢`}
                  />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground font-mono py-4 text-center">
                  Loading...
                </div>
              )}
            </SidebarCard>
          </div>
        </div>
      </main>

      <SystemStatusIndicator stats={stats} />

      <TradeDetailPopup
        trade={selectedTrade}
        open={selectedTrade !== null}
        onClose={() => setSelectedTrade(null)}
      />
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────── */

function BtcStatusPanel({
  stats,
  btcPrice,
  activeMarketsCount,
  openTradesCount,
  windowLabel,
  mounted,
}: {
  stats: SystemStats | null;
  btcPrice: { price: number; timestamp: number } | null;
  activeMarketsCount: number;
  openTradesCount: number;
  windowLabel: string;
  mounted: boolean;
}) {
  const isRunning = stats?.orchestrator.running ?? false;

  return (
    <div className="border border-border/30 rounded-lg bg-card/30 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-4 min-h-[140px]">
        {/* BTC PRICE */}
        <div className="col-span-1 lg:col-span-5 bg-gradient-to-br from-card/40 to-card/20 rounded-xl border border-border/20 p-3 lg:p-4 flex flex-col justify-center items-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-blue-500/5" />
          <div className="relative z-10 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div
                className={`w-2 h-2 rounded-full ${
                  btcPrice
                    ? "bg-emerald-500 animate-pulse shadow-emerald-500/50 shadow-lg"
                    : "bg-muted-foreground/40"
                }`}
              />
              <span className="text-xs font-mono tracking-widest text-muted-foreground font-medium">
                BTC/USDT
              </span>
            </div>
            <div className="text-3xl lg:text-4xl font-bold font-mono tabular-nums mb-1 text-foreground">
              {btcPrice
                ? `$${btcPrice.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </div>
            <div className="text-xs font-mono text-muted-foreground tracking-wider">
              {windowLabel}
            </div>
          </div>
        </div>

        {/* STATUS INDICATORS */}
        <div className="col-span-1 lg:col-span-3 flex flex-col gap-2">
          <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
            <div className="text-xs font-mono text-muted-foreground">
              ENGINE
            </div>
            <div
              className={`text-sm font-bold font-mono ${isRunning ? "text-emerald-500" : "text-red-500"}`}
            >
              {isRunning ? "RUNNING" : "STOPPED"}
            </div>
          </div>
          <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
            <div className="text-xs font-mono text-muted-foreground">
              MARKETS
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {activeMarketsCount}
            </div>
          </div>
          <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
            <div className="text-xs font-mono text-muted-foreground">
              OPEN POSITIONS
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {openTradesCount}
            </div>
          </div>
        </div>

        {/* STRATEGY INFO */}
        <div className="col-span-1 lg:col-span-4 space-y-2">
          {stats?.config ? (
            <>
              <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
                <div className="text-xs font-mono text-muted-foreground">
                  ENTRY ≥
                </div>
                <div className="text-sm font-bold font-mono text-foreground">
                  {(stats.config.entryPriceThreshold * 100).toFixed(0)}¢
                </div>
              </div>
              <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
                <div className="text-xs font-mono text-muted-foreground">
                  TRADE WINDOW
                </div>
                <div className="text-sm font-bold font-mono text-foreground">
                  Last {stats.config.tradeFromWindowSeconds}s
                </div>
              </div>
              <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
                <div className="text-xs font-mono text-muted-foreground">
                  SIM AMOUNT
                </div>
                <div className="text-sm font-bold font-mono text-foreground">
                  ${stats.config.simulationAmountUsd}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs font-mono text-muted-foreground py-8">
              {mounted ? "Connecting…" : "Loading…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border/30 rounded-lg bg-card/30 p-3">
      <div className="text-[10px] text-muted-foreground tracking-widest mb-2 border-b border-border/20 pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function StatRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? "text-emerald-500" : "text-foreground"}>
        {value}
      </span>
    </div>
  );
}

function MarketsPanel({
  markets,
  loading,
  refetch,
}: {
  markets: DiscoveredMarket[];
  loading: boolean;
  refetch?: () => void;
}) {
  // Auto-refresh when the active market ends
  useEffect(() => {
    if (!refetch || markets.length === 0) return;

    const activeMarket = markets.find((m) => m.active);
    if (!activeMarket?.endDate) return;

    const endTime = new Date(activeMarket.endDate).getTime();
    const now = Date.now();
    const timeUntilEnd = endTime - now;

    if (timeUntilEnd > 0 && timeUntilEnd < 20 * 60 * 1000) {
      const timer = setTimeout(() => {
        refetch();
      }, timeUntilEnd + 1000);
      return () => clearTimeout(timer);
    }
  }, [markets, refetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-muted-foreground font-mono animate-pulse">
          Loading markets...
        </div>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-muted-foreground font-mono">
          No active markets discovered.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30 text-muted-foreground">
            <th className="text-left py-2 px-2 font-medium">MARKET</th>
            <th className="text-left py-2 px-2 font-medium">WINDOW</th>
            <th className="text-left py-2 px-2 font-medium">STATUS</th>
            <th className="text-right py-2 px-2 font-medium">TARGET</th>
            <th className="text-right py-2 px-2 font-medium">ENDS</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            const windowLabel =
              MARKET_WINDOW_LABELS[market.windowType as MarketWindow] ??
              market.windowType;

            return (
              <tr
                key={market.id}
                className={`border-b border-border/10 hover:bg-muted/20 transition-colors ${
                  market.active ? "bg-emerald-500/5" : ""
                }`}
              >
                <td className="py-2.5 px-2 max-w-[200px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="truncate text-foreground font-medium">
                      {market.question?.slice(0, 50) || market.id.slice(0, 16)}
                    </span>
                    <span className="truncate text-muted-foreground/70 text-[10px]">
                      {market.id.slice(0, 20)}…
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-2">
                  <span className="text-muted-foreground">{windowLabel}</span>
                </td>
                <td className="py-2.5 px-2">
                  {market.active ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      ACTIVE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 text-muted-foreground">
                      INACTIVE
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-2 text-right tabular-nums text-foreground">
                  {market.targetPrice
                    ? `$${parseFloat(market.targetPrice).toLocaleString()}`
                    : "—"}
                </td>
                <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                  {market.endDate
                    ? new Date(market.endDate).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
