"use client";

import type { SimulatedTrade } from "@/lib/types";
import { MARKET_WINDOW_LABELS, type MarketWindow } from "@/lib/types";

interface TradesTableProps {
  trades: SimulatedTrade[];
  loading: boolean;
  onTradeClick?: (trade: SimulatedTrade) => void;
}

export function TradesTable({ trades, loading, onTradeClick }: TradesTableProps) {
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
        <div className="text-sm text-muted-foreground font-mono">No trades yet</div>
        <div className="text-xs text-muted-foreground/50 font-mono">
          Waiting for end-of-window opportunities…
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
              EXIT
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              SHARES
            </th>
            <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
              BTC DIST
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
            const isClosed = trade.status === "CLOSED";

            // Exit price for closed trades
            const exitPrice = trade.exitPrice ? parseFloat(trade.exitPrice) : null;
            const exitCents = exitPrice !== null ? Math.round(exitPrice * 100) : null;

            // P&L
            const realizedPnl = parseFloat(trade.realizedPnl || "0");
            const hasPnl = isClosed && !!trade.realizedPnl;
            const pnlPositive = realizedPnl >= 0;

            // BTC distance
            const btcDist = trade.btcDistancePercent ? parseFloat(trade.btcDistancePercent) : null;

            // Window label
            const windowInfo = extractTimeWindow(trade);

            return (
              <tr
                key={trade.id}
                onClick={() => onTradeClick?.(trade)}
                className={`border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
                  idx % 2 === 0 ? "bg-transparent" : "bg-card/5"
                } ${trade.status === "OPEN" ? "bg-emerald-500/5" : ""}`}
              >
                {/* WINDOW */}
                <td className="py-3 px-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground text-xs">{windowInfo.time}</span>
                    <span className="text-[10px] text-muted-foreground/60">{windowInfo.date}</span>
                  </div>
                </td>

                {/* SIDE */}
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
                  <span className="text-foreground tabular-nums">{entryCents}¢</span>
                </td>

                {/* EXIT */}
                <td className="py-3 px-3 text-right">
                  {exitCents !== null ? (
                    <span
                      className={`tabular-nums font-medium ${
                        exitCents >= entryCents ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {exitCents}¢
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>

                {/* SHARES */}
                <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                  {shares.toFixed(1)}
                </td>

                {/* BTC DISTANCE */}
                <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                  {btcDist !== null ? `${btcDist.toFixed(2)}%` : "—"}
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
                        {pnlPositive ? "+" : ""}${Math.abs(realizedPnl).toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>

                {/* STATUS */}
                <td className="py-3 px-3 text-right">
                  {isClosed ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                        trade.exitOutcome === "WIN"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : trade.exitOutcome === "STOP_LOSS"
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {trade.exitOutcome || "CLOSED"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-500">
                      <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                      OPEN
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

function extractTimeWindow(trade: SimulatedTrade): { time: string; date: string } {
  const entryDate = new Date(trade.entryTs);
  const windowType = trade.windowType as MarketWindow | null;
  const label = windowType ? (MARKET_WINDOW_LABELS[windowType] ?? windowType) : "";

  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return {
    time: `${fmt(entryDate)} ${label ? `(${label})` : ""}`.trim(),
    date: entryDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}
