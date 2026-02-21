"use client";

import type { SimulatedTrade, ActiveMarket } from "@/lib/types";

interface TradesTableProps {
  trades: SimulatedTrade[];
  loading: boolean;
  type: "positions" | "markets";
  onTradeClick?: (trade: SimulatedTrade) => void;
  /** Live market data — used to show current prices for open trades */
  activeMarket?: ActiveMarket | null;
}

export function TradesTable({
  trades,
  loading,
  type,
  onTradeClick,
  activeMarket,
}: TradesTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
          Loading trades…
        </div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <div className="w-8 h-8 rounded-full border border-border/30 flex items-center justify-center text-muted-foreground/40 text-sm">
          ○
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          No positions yet
        </div>
        <div className="text-xs text-muted-foreground/50 font-mono">
          Waiting for strategy triggers…
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30">
            <th className="text-left py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              WINDOW
            </th>
            <th className="text-left py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              SIDE
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              ENTRY
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              EXIT/CURRENT
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              SHARES
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              P&L
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              STATUS
            </th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, idx) => {
            const entryPrice = parseFloat(trade.entryPrice);
            const entryCents = Math.round(entryPrice * 100);
            const shares = parseFloat(trade.entryShares || "0");
            const isUp = trade.outcomeLabel === "Up";

            // Current/exit price logic:
            // - Closed trades: use claimPrice (1.00 for WIN, 0.00 for LOSS)
            // - Open trades: use live price from activeMarket based on outcomeLabel
            const isClosed = trade.status === "CLOSED";
            let currentPrice: number | null = null;
            if (isClosed && trade.claimPrice) {
              currentPrice = parseFloat(trade.claimPrice);
            } else if (
              activeMarket &&
              trade.marketId === activeMarket.marketId
            ) {
              // Match by outcomeLabel to get the right price
              if (isUp && activeMarket.upPrice > 0) {
                currentPrice = activeMarket.upPrice;
              } else if (!isUp && activeMarket.downPrice > 0) {
                currentPrice = activeMarket.downPrice;
              }
            } else if (activeMarket && trade.tokenId) {
              // Fallback: match by tokenId
              if (
                trade.tokenId === activeMarket.upTokenId &&
                activeMarket.upPrice > 0
              ) {
                currentPrice = activeMarket.upPrice;
              } else if (
                trade.tokenId === activeMarket.downTokenId &&
                activeMarket.downPrice > 0
              ) {
                currentPrice = activeMarket.downPrice;
              }
            }
            const currentCents =
              currentPrice !== null ? Math.round(currentPrice * 100) : null;

            // P&L display — realized for closed, unrealized for open
            const realizedPnl = parseFloat(trade.realizedPnl || "0");
            const unrealizedPnl =
              currentPrice !== null && shares > 0
                ? (currentPrice - entryPrice) * shares
                : null;
            const hasPnl = isClosed
              ? !!trade.realizedPnl
              : unrealizedPnl !== null;
            const displayPnl = isClosed ? realizedPnl : (unrealizedPnl ?? 0);
            const pnlPositive = displayPnl >= 0;

            // Time window from market question or entryTs
            const windowLabel = extractTimeWindow(trade);

            return (
              <tr
                key={trade.id}
                onClick={() => onTradeClick?.(trade)}
                className={`border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
                  idx % 2 === 0 ? "bg-transparent" : "bg-card/5"
                } ${trade.status === "ACTIVE" || (trade.status === "OPEN" && trade.marketId === activeMarket?.marketId) ? "bg-emerald-500/5" : ""}`}
              >
                {/* WINDOW */}
                <td className="py-3 px-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground text-xs">
                      {windowLabel.time}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {windowLabel.date}
                    </span>
                  </div>
                </td>

                {/* SIDE (Up/Down) */}
                <td className="py-3 px-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
                      isUp
                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                        : "bg-red-500/10 text-red-500 border border-red-500/20"
                    }`}
                  >
                    <span className="text-[9px]">{isUp ? "▲" : "▼"}</span>
                    {isUp ? "UP" : "DOWN"}
                  </span>
                </td>

                {/* ENTRY */}
                <td className="py-3 px-3 text-right">
                  <span className="text-foreground tabular-nums">
                    {entryCents}¢
                  </span>
                </td>

                {/* EXIT / CURRENT */}
                <td className="py-3 px-3 text-right">
                  {currentCents !== null ? (
                    <span
                      className={`tabular-nums font-medium ${
                        isClosed
                          ? currentCents >= entryCents
                            ? "text-emerald-500"
                            : "text-red-500"
                          : currentCents > entryCents
                            ? "text-emerald-500"
                            : currentCents < entryCents
                              ? "text-red-500"
                              : "text-foreground"
                      }`}
                    >
                      {currentCents}¢
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>

                {/* SHARES */}
                <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                  {shares.toFixed(1)}
                </td>

                {/* P&L */}
                <td className="py-3 px-3 text-right">
                  {hasPnl ? (
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className={`tabular-nums font-semibold ${
                          pnlPositive ? "text-emerald-500" : "text-red-500"
                        }`}
                      >
                        {pnlPositive ? "+" : ""}$
                        {Math.abs(displayPnl).toFixed(2)}
                      </span>
                      {entryPrice > 0 && shares > 0 && (
                        <span
                          className={`text-[10px] tabular-nums ${
                            pnlPositive
                              ? "text-emerald-500/60"
                              : "text-red-500/60"
                          }`}
                        >
                          {pnlPositive ? "+" : ""}
                          {((displayPnl / (entryPrice * shares)) * 100).toFixed(
                            1,
                          )}
                          %
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>

                {/* STATUS */}
                <td className="py-3 px-3 text-right">
                  {isClosed ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 text-muted-foreground">
                      CLOSED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-500">
                      <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                      ACTIVE
                    </span>
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

/** Extract the market window (start–end) from the trade's market endDate */
function extractTimeWindow(trade: SimulatedTrade): {
  time: string;
  date: string;
} {
  // Priority 1: Use market endDate to calculate proper 15-minute window
  if (trade.market?.endDate) {
    const endTime = new Date(trade.market.endDate);
    const startTime = new Date(endTime.getTime() - 15 * 60 * 1000);

    const fmt = (d: Date) =>
      d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

    return {
      time: `${fmt(startTime)} – ${fmt(endTime)}`,
      date: endTime.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    };
  }

  // Priority 2: Try to parse the market question for a time range (e.g., "… between 14:00 and 14:15 …")
  const question = trade.market?.question ?? "";
  const rangeMatch = question.match(
    /(\d{1,2}:\d{2})\s*(?:and|to|-|–)\s*(\d{1,2}:\d{2})/i,
  );
  if (rangeMatch) {
    const entryDate = new Date(trade.entryTs);
    return {
      time: `${rangeMatch[1]} – ${rangeMatch[2]}`,
      date: entryDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    };
  }

  // Fallback: use entryTs + 15min (not ideal, but better than nothing)
  const entryDate = new Date(trade.entryTs);
  const endDate = new Date(entryDate.getTime() + 15 * 60 * 1000);

  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  return {
    time: `${fmt(entryDate)} – ${fmt(endDate)}`,
    date: entryDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  };
}
