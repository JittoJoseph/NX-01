"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { usePerformance } from "@/lib/hooks";
import type { Direction } from "@/lib/types";

export function OverviewPanels() {
  const [period, setPeriod] = useState<"1D" | "1W" | "1M" | "ALL">("ALL");
  const { performance, refreshing, refetch } = usePerformance(period);

  const periods: Array<"1D" | "1W" | "1M" | "ALL"> = ["1D", "1W", "1M", "ALL"];

  const netPnl = parseFloat(performance?.summary.netPnl || "0");
  const roi = parseFloat(performance?.summary.roi || "0");
  const winRate = parseFloat(performance?.trades.winRate || "0");
  const totalFees = parseFloat(performance?.summary.totalFees || "0");
  const direction: Direction =
    netPnl > 0.0001 ? "up" : netPnl < -0.0001 ? "down" : "flat";

  return (
    <div className="border border-border/30 rounded-lg bg-card/30 overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-mono tracking-widest text-muted-foreground">
            PORTFOLIO PERFORMANCE
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {periods.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    period === p
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => refetch()}
              disabled={refreshing}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh performance data"
            >
              <RefreshCw
                size={14}
                className={`transition-transform ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard
            label="NET P&L"
            value={`${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(4)}`}
            className={
              direction === "up"
                ? "text-emerald-500"
                : direction === "down"
                  ? "text-red-500"
                  : "text-foreground"
            }
          />
          <MetricCard
            label="ROI"
            value={`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`}
            className={
              roi > 0
                ? "text-emerald-500"
                : roi < 0
                  ? "text-red-500"
                  : "text-foreground"
            }
          />
          <MetricCard
            label="WIN RATE"
            value={`${winRate.toFixed(1)}%`}
            className="text-foreground"
          />
          <MetricCard
            label="TRADES"
            value={
              performance
                ? `${performance.trades.wins}W / ${performance.trades.losses}L`
                : "—"
            }
            className="text-foreground"
          />
          <MetricCard
            label="TOTAL FEES"
            value={`$${totalFees.toFixed(4)}`}
            className="text-muted-foreground"
          />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className="py-2 px-3 rounded-lg bg-muted/15 border border-border/20">
      <div className="text-[10px] text-muted-foreground font-mono mb-1">
        {label}
      </div>
      <div className={`text-sm font-bold font-mono tabular-nums ${className}`}>
        {value}
      </div>
    </div>
  );
}
