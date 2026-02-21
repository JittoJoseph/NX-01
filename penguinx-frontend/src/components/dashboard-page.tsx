"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Header } from "./header";
import { SystemStatusIndicator } from "./system-status-indicator";
import { OverviewPanels } from "./overview-panels";
import { TradesTable } from "./trades-table";
import { TradeDetailPopup } from "./trade-detail-popup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePositions,
  useSystemStats,
  useMarkets,
  useTriggers,
  useWsConnection,
  useWsEvent,
  useActiveMarket,
} from "@/lib/hooks";
import type {
  SimulatedTrade,
  DiscoveredMarket,
  StrategyTrigger,
  ActiveMarket,
  OpenPosition,
} from "@/lib/types";

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedTrade, setSelectedTrade] = useState<SimulatedTrade | null>(
    null,
  );
  const [timeRemaining, setTimeRemaining] = useState("");
  const [tradeFlash, setTradeFlash] = useState<{
    outcome: string;
    price: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  // Active market (REST-polled prices + WS structural updates)
  const activeMarket = useActiveMarket();

  // Mark as mounted to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Countdown timer for active market
  useEffect(() => {
    if (!mounted || !activeMarket?.endDate) {
      setTimeRemaining("");
      return;
    }
    const update = () => {
      const end = new Date(activeMarket.endDate).getTime();
      const now = Date.now();
      const diff = end - now;
      if (diff <= 0) {
        setTimeRemaining("ENDED");
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeMarket?.endDate, mounted]);

  // Data hooks — completed positions from DB, active positions from activeMarket
  const {
    positions: completedPositions,
    loading: positionsLoading,
    refetch: refetchPositions,
  } = usePositions(100);
  const { stats, loading: statsLoading } = useSystemStats();
  const {
    markets: marketsList,
    loading: marketsLoading,
    refetch: refetchMarkets,
  } = useMarkets(true);
  const { triggers: triggersList, loading: triggersLoading } = useTriggers(20);

  // Derive active positions from activeMarket's openPositions (real-time synced via WS)
  const activeOpenPositions = activeMarket?.openPositions;

  const allPositions = useMemo(() => {
    // Convert open positions from activeMarket into SimulatedTrade format for the table
    const active: SimulatedTrade[] = (activeOpenPositions ?? []).map((pos) => ({
      id: pos.tradeId,
      experimentId: null,
      marketId: pos.marketId,
      tokenId: pos.tokenId,
      marketCategory: "btc-15m",
      outcomeLabel: pos.outcomeLabel,
      side: "BUY",
      entryTs: pos.entryTs,
      entryPrice: pos.entryPrice.toString(),
      entryShares: pos.shares.toString(),
      simulatedUsdAmount: "1",
      entryFees: pos.entryFees.toString(),
      entrySlippage: "0",
      entryLatencyMs: null,
      fillStatus: "FULL",
      claimAt: null,
      claimOutcome: null,
      claimPrice: null,
      claimTs: null,
      realizedPnl: null,
      status: "ACTIVE",
      strategyTrigger: null,
      createdAt: pos.entryTs,
      market: pos.market
        ? {
            question: pos.market.question,
            slug: pos.market.slug,
            outcomes: null,
            outcome: pos.outcomeLabel,
            endDate: pos.market.endDate,
          }
        : {
            question: activeMarket?.question ?? null,
            slug: activeMarket?.slug ?? null,
            outcomes: null,
            outcome: pos.outcomeLabel,
            endDate: activeMarket?.endDate ?? null,
          },
    }));
    const completed = completedPositions ?? [];

    // Filter out active positions that are already in completed positions to avoid duplicates
    const filteredActive = active.filter(
      (activePos) =>
        !completed.some((completedPos) => completedPos.id === activePos.id),
    );

    return [...filteredActive, ...completed];
  }, [
    activeOpenPositions,
    completedPositions,
    activeMarket?.question,
    activeMarket?.slug,
    activeMarket?.endDate,
  ]);

  // WebSocket live events
  useWsConnection();

  useWsEvent(
    "tradeExecuted",
    useCallback((msg: any) => {
      // Active positions update comes automatically via activeMarketUpdate WS event
      // Extract trade data from WS message for flash animation
      const tradeInfo = msg?.data?.trade;
      if (tradeInfo?.outcomeLabel && tradeInfo?.entryPrice) {
        setTradeFlash({
          outcome: tradeInfo.outcomeLabel,
          price: parseFloat(tradeInfo.entryPrice),
        });
        // Auto-clear after animation
        setTimeout(() => setTradeFlash(null), 2000);
      }
    }, []),
  );

  useWsEvent(
    "tradeClosed",
    useCallback(() => {
      // Refetch completed positions when a trade is closed/stopped
      refetchPositions();
    }, [refetchPositions]),
  );

  const positionsCount = allPositions.length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />

      <main className="flex-1 px-4 py-4 pb-16 max-w-7xl mx-auto w-full space-y-4">
        {/* ── Active Market — Bento Panel ────────────── */}
        <ActiveMarketPanel
          activeMarket={activeMarket}
          timeRemaining={timeRemaining}
          tradeFlash={tradeFlash}
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
                    value="positions"
                    className="data-[state=active]:bg-muted/40 rounded px-3 py-1 text-xs font-mono"
                  >
                    POSITIONS ({positionsCount})
                  </TabsTrigger>
                  <TabsTrigger
                    value="markets"
                    className="data-[state=active]:bg-muted/40 rounded px-3 py-1 text-xs font-mono"
                  >
                    MARKETS ({marketsList?.length ?? 0})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="positions" className="mt-0">
                <TradesTable
                  trades={allPositions}
                  loading={positionsLoading}
                  type="positions"
                  onTradeClick={setSelectedTrade}
                  activeMarket={activeMarket}
                />
              </TabsContent>

              <TabsContent value="markets" className="mt-0">
                <MarketsPanel
                  markets={marketsList}
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
                  <StatRow
                    label="Open Trades"
                    value={stats.database.openTrades.toString()}
                  />
                  <StatRow
                    label="Closed Trades"
                    value={stats.database.closed.toString()}
                  />
                  <StatRow
                    label="Markets Watched"
                    value={stats.database.activeMarkets.toString()}
                  />
                  <StatRow
                    label="Uptime"
                    value={formatUptime(stats.uptimeSeconds)}
                  />
                  <StatRow
                    label="Scanner"
                    value={
                      stats.scanner?.discoveredMarkets != null
                        ? "ACTIVE"
                        : "IDLE"
                    }
                    accent
                  />
                  <StatRow
                    label="Strategy"
                    value={stats.strategy ? "ACTIVE" : "IDLE"}
                    accent
                  />
                  <StatRow
                    label="WS Clients"
                    value={stats.wsClients?.toString() ?? "0"}
                  />
                </div>
              ) : null}
            </SidebarCard>

            {/* Recent triggers */}
            <SidebarCard title="RECENT TRIGGERS">
              {triggersLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse font-mono py-4 text-center">
                  Loading...
                </div>
              ) : (triggersList?.length ?? 0) === 0 ? (
                <div className="text-xs text-muted-foreground font-mono py-4 text-center">
                  No triggers yet
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {triggersList?.slice(0, 8).map((t) => (
                    <TriggerRow key={t.id} trigger={t} />
                  ))}
                </div>
              )}
            </SidebarCard>

            {/* Open positions summary */}
            <SidebarCard title="ACTIVE POSITIONS">
              {!activeMarket?.openPositions ||
              activeMarket.openPositions.length === 0 ? (
                <div className="text-xs text-muted-foreground font-mono py-4 text-center">
                  No active positions
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activeMarket.openPositions.map((p) => {
                    const curPrice =
                      p.outcomeLabel === "Up"
                        ? activeMarket.upPrice
                        : activeMarket.downPrice;
                    const pnl =
                      curPrice > 0 ? (curPrice - p.entryPrice) * p.shares : 0;
                    const isWin = pnl >= 0;
                    return (
                      <div
                        key={p.tradeId}
                        className="flex justify-between items-center text-xs font-mono"
                      >
                        <span className="text-muted-foreground">
                          <span
                            className={
                              p.outcomeLabel === "Up"
                                ? "text-emerald-500"
                                : "text-red-500"
                            }
                          >
                            {p.outcomeLabel === "Up" ? "▲" : "▼"}
                          </span>{" "}
                          {Math.round(p.entryPrice * 100)}¢ →{" "}
                          {Math.round(curPrice * 100)}¢
                        </span>
                        <span
                          className={`text-[10px] font-bold ${isWin ? "text-emerald-500" : "text-red-500"}`}
                        >
                          {isWin ? "+" : ""}
                          {pnl.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
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

function ActiveMarketPanel({
  activeMarket,
  timeRemaining,
  tradeFlash,
}: {
  activeMarket: ActiveMarket | null;
  timeRemaining: string;
  tradeFlash: { outcome: string; price: number } | null;
}) {
  const glowKey = useRef(0);

  // Bump key on each flash to re-trigger animation
  useEffect(() => {
    if (tradeFlash) glowKey.current += 1;
  }, [tradeFlash]);

  /* ── Empty state ── */
  if (!activeMarket) {
    return (
      <div className="border border-border/30 rounded-lg bg-card/30 p-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
          <span className="text-xs font-mono tracking-widest text-muted-foreground">
            ACTIVE MARKET
          </span>
        </div>
        <div className="text-sm font-mono text-muted-foreground text-center py-2">
          Waiting for next BTC 15-minute window…
        </div>
      </div>
    );
  }

  const isEnded = timeRemaining === "ENDED";
  const upCents = Math.round(activeMarket.upPrice * 100);
  const downCents = Math.round(activeMarket.downPrice * 100);
  const hasPrices = activeMarket.upPrice > 0 && activeMarket.downPrice > 0;

  // Calculate additional metrics
  const spread = hasPrices ? Math.abs(100 - upCents - downCents) : 0;

  const glowClass = tradeFlash
    ? tradeFlash.outcome === "Up"
      ? "animate-glow-up"
      : "animate-glow-down"
    : "";

  // Build proper polymarket link
  const polymarketUrl = activeMarket.slug
    ? `https://polymarket.com/event/${activeMarket.slug}`
    : activeMarket.polymarketUrl || "https://polymarket.com";
  const polymarketSlug = activeMarket.slug || "polymarket.com";

  // Active positions for this market from orchestrator's live data
  const marketPositions =
    activeMarket.openPositions?.filter(
      (p) => p.marketId === activeMarket.marketId,
    ) ?? [];

  return (
    <div
      key={tradeFlash ? glowKey.current : "stable"}
      className={`border border-border/30 rounded-lg bg-card/30 overflow-hidden ${glowClass}`}
    >
      {/* ── Responsive Grid Layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 p-4 min-h-[180px]">
        {/* TIMER - Compact Section (Full width on mobile, spans 6 columns on desktop) */}
        <div className="col-span-1 lg:col-span-6 bg-gradient-to-br from-card/40 to-card/20 rounded-xl border border-border/20 p-3 lg:p-4 flex flex-col justify-center items-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-transparent to-blue-500/5" />
          <div className="relative z-10 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div
                className={`w-2 h-2 rounded-full ${isEnded ? "bg-muted-foreground/40" : "bg-emerald-500 animate-pulse shadow-emerald-500/50 shadow-lg"}`}
              />
              <span className="text-xs font-mono tracking-widest text-muted-foreground font-medium">
                {isEnded ? "ENDED" : "LIVE"}
              </span>
            </div>
            <div
              className={`text-3xl lg:text-4xl font-bold font-mono tabular-nums mb-1 ${isEnded ? "text-muted-foreground" : "text-foreground bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text"}`}
            >
              {timeRemaining || "--:--"}
            </div>
            <div className="text-xs font-mono text-muted-foreground tracking-wider">
              BTC 15M WINDOW
            </div>
          </div>
        </div>

        {/* MARKET STATS + POSITION - Middle Column (2 columns on desktop) */}
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-2">
          <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
            <div className="text-xs font-mono text-muted-foreground">ENDS</div>
            <div className="text-sm font-bold font-mono text-foreground">
              {activeMarket.endDate
                ? new Date(activeMarket.endDate).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                : "--:--"}
            </div>
          </div>
          <div className="bg-card/20 rounded-lg p-2 flex items-center justify-between">
            <div className="text-xs font-mono text-muted-foreground">
              SPREAD
            </div>
            <div className="text-sm font-bold font-mono text-foreground">
              {spread}¢
            </div>
          </div>

          {/* Reserved POSITION area — always visible */}
          <div className="flex-1 bg-gradient-to-b from-card/30 to-card/10 rounded-lg border border-border/10 p-2 flex flex-col">
            {marketPositions.length > 0 ? (
              (() => {
                const pos = marketPositions[0];
                const curPrice =
                  pos.outcomeLabel === "Up"
                    ? activeMarket.upPrice
                    : activeMarket.downPrice;
                const entryPriceNum = pos.entryPrice;
                const pctChg =
                  entryPriceNum > 0
                    ? ((curPrice - entryPriceNum) / entryPriceNum) * 100
                    : 0;
                const pnl =
                  hasPrices && pos.shares > 0
                    ? (curPrice - entryPriceNum) * pos.shares
                    : null;
                const isWin = pnl !== null && pnl >= 0;
                return (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground tracking-widest">
                        POSITION
                      </span>
                      <span
                        className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded ${
                          pos.outcomeLabel === "Up"
                            ? "bg-emerald-500/20 text-emerald-500"
                            : "bg-red-500/20 text-red-500"
                        }`}
                      >
                        {pos.outcomeLabel === "Up" ? "▲" : "▼"}{" "}
                        {pos.outcomeLabel}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        {Math.round(entryPriceNum * 100)}¢ →{" "}
                        {hasPrices ? `${Math.round(curPrice * 100)}¢` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-xs font-mono text-muted-foreground">
                        {pos.shares.toFixed(1)} sh
                      </span>
                      <div
                        className={`text-sm font-bold font-mono tabular-nums ${
                          isWin ? "text-emerald-500" : "text-red-500"
                        }`}
                      >
                        {pctChg >= 0 ? "+" : ""}
                        {pctChg.toFixed(1)}%
                        {pnl !== null && (
                          <span className="ml-1 text-xs">
                            ({isWin ? "+" : ""}${Math.abs(pnl).toFixed(2)})
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="text-xs font-mono text-muted-foreground tracking-widest mb-1">
                  POSITION
                </div>
                <div className="text-xs font-mono text-muted-foreground/60">
                  No active bet
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN - Trading & Position Info */}
        <div className="col-span-1 lg:col-span-4 space-y-3">
          {/* UP/DOWN Trading Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button className="aspect-square flex flex-col items-center justify-center gap-2 rounded-xl border border-border/40 bg-card/60 hover:border-emerald-500/60 hover:bg-emerald-500/10 text-emerald-500 transition-all duration-300 group hover:scale-[1.02]">
              <div className="text-2xl lg:text-3xl group-hover:scale-110 transition-transform duration-200">
                ▲
              </div>
              <div className="text-sm lg:text-base font-bold font-mono tabular-nums text-emerald-500">
                {hasPrices ? `${upCents}¢` : "—"}
              </div>
              <div className="text-xs font-mono tracking-widest text-emerald-500/80">
                UP
              </div>
            </button>

            <button className="aspect-square flex flex-col items-center justify-center gap-2 rounded-xl border border-border/40 bg-card/60 hover:border-red-500/60 hover:bg-red-500/10 text-red-500 transition-all duration-300 group hover:scale-[1.02]">
              <div className="text-2xl lg:text-3xl group-hover:scale-110 transition-transform duration-200">
                ▼
              </div>
              <div className="text-sm lg:text-base font-bold font-mono tabular-nums text-red-500">
                {hasPrices ? `${downCents}¢` : "—"}
              </div>
              <div className="text-xs font-mono tracking-widest text-red-500/80">
                DOWN
              </div>
            </button>
          </div>

          {/* Market Info - Compact */}
          <div className="bg-card/20 rounded-lg p-2 space-y-1">
            <div className="text-sm font-mono text-muted-foreground leading-tight">
              {activeMarket.question || "BTC 15-Minute Window"}
            </div>
            <div className="flex items-center justify-between">
              <a
                href={polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-mono text-blue-400 hover:text-blue-300 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span className="truncate text-sm">{polymarketSlug}</span>
              </a>
            </div>
          </div>
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

function TriggerRow({ trigger }: { trigger: StrategyTrigger }) {
  return (
    <div className="text-xs font-mono border-b border-border/10 pb-1.5 last:border-0">
      <div className="flex justify-between">
        <span className="text-foreground truncate max-w-[180px]">
          {trigger.triggerType}
        </span>
        <span
          className={`text-[10px] ${
            trigger.executed ? "text-emerald-500" : "text-amber-500"
          }`}
        >
          {trigger.executed ? "EXEC" : "SKIP"}
        </span>
      </div>
      <div className="flex justify-between text-muted-foreground text-[10px] mt-0.5">
        <span>
          {trigger.triggerPrice
            ? `price: $${parseFloat(trigger.triggerPrice).toFixed(4)}`
            : "—"}
        </span>
        <span>{formatRelativeTime(trigger.createdAt)}</span>
      </div>
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

    // Find the currently active market
    const activeMarket = markets.find((m) => m.isActive);
    if (!activeMarket?.endDate) return;

    const endTime = new Date(activeMarket.endDate).getTime();
    const now = Date.now();
    const timeUntilEnd = endTime - now;

    // If market ends within 20 minutes, set a timer to refresh when it ends
    if (timeUntilEnd > 0 && timeUntilEnd < 20 * 60 * 1000) {
      const timer = setTimeout(() => {
        refetch();
      }, timeUntilEnd + 1000); // Add 1 second buffer
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
          No active or upcoming BTC 15-min markets.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30 text-muted-foreground">
            <th className="text-left py-2 px-2 font-medium">MARKET WINDOW</th>
            <th className="text-left py-2 px-2 font-medium">STATUS</th>
            <th className="text-right py-2 px-2 font-medium">ENDS</th>
            <th className="text-center py-2 px-2 font-medium">ACTION</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            // Calculate market window start from endDate (15-minute window)
            let windowDisplay = "—";
            if (market.endDate) {
              const endTime = new Date(market.endDate);
              const startTime = new Date(endTime.getTime() - 15 * 60 * 1000);
              const formatTime = (d: Date) =>
                d.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
              windowDisplay = `${formatTime(startTime)} – ${formatTime(endTime)}`;
            }

            // Build Polymarket URL
            const polymarketUrl = market.slug
              ? `https://polymarket.com/event/${market.slug}`
              : null;

            return (
              <tr
                key={market.id}
                className={`border-b border-border/10 hover:bg-muted/20 transition-colors ${
                  market.isActive ? "bg-emerald-500/5" : ""
                }`}
              >
                <td className="py-2.5 px-2 max-w-[250px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground font-medium">
                      {windowDisplay}
                    </span>
                    <span className="truncate text-muted-foreground/70 text-[10px]">
                      {market.question?.slice(0, 50) ||
                        market.conditionId?.slice(0, 16)}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-2">
                  {market.isActive ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      ACTIVE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-500">
                      UPCOMING
                    </span>
                  )}
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
                <td className="py-2.5 px-2 text-center">
                  {polymarketUrl ? (
                    <a
                      href={polymarketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-colors border border-blue-500/20"
                    >
                      <svg
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      VIEW
                    </a>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────── */

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
