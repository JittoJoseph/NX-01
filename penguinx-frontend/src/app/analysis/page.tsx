"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Header } from "@/components/header";
import Link from "next/link";
import type { MonteCarloResult } from "@/lib/types";
import { ApiClient } from "@/lib/api-client";

const api = new ApiClient();

export default function AnalysisPage() {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<"histogram" | "equity">(
    "histogram",
  );

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnalysis({
        simulations: 10_000,
        tradesPerSim: 100,
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch analysis");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
        {/* Back link + Title */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              &larr; DASHBOARD
            </Link>
            <h2 className="text-lg font-bold font-mono tracking-widest">
              MONTE CARLO ANALYSIS
            </h2>
          </div>
          <button
            onClick={fetchAnalysis}
            disabled={loading}
            className="text-xs font-mono px-3 py-1.5 rounded border border-border/30 bg-card/30 hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            {loading ? "RUNNING…" : "RE-RUN"}
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-4 text-sm font-mono text-red-400">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && !result && (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
              Running {(10_000).toLocaleString()} simulations…
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Historical Stats Row */}
            <HistoricalStats data={result} />

            {/* Chart selector + chart */}
            <div className="border border-border/30 rounded-lg bg-card/30 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5">
                <div className="flex gap-1">
                  <button
                    onClick={() => setActiveChart("histogram")}
                    className={`text-[10px] font-mono tracking-wider px-3 py-1 rounded transition-colors ${
                      activeChart === "histogram"
                        ? "bg-muted/40 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    DISTRIBUTION
                  </button>
                  <button
                    onClick={() => setActiveChart("equity")}
                    className={`text-[10px] font-mono tracking-wider px-3 py-1 rounded transition-colors ${
                      activeChart === "equity"
                        ? "bg-muted/40 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    EQUITY CURVES
                  </button>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/60">
                  {result.config.simulations.toLocaleString()} sims &times;{" "}
                  {result.config.tradesPerSim} trades
                </span>
              </div>

              {activeChart === "histogram" ? (
                <HistogramChart data={result} />
              ) : (
                <EquityCurvesChart data={result} />
              )}
            </div>

            {/* Distribution percentiles + Drawdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PercentileCard data={result} />
              <DrawdownCard data={result} />
            </div>

            {/* Robustness Verdict */}
            <VerdictCard data={result} />
          </>
        )}
      </main>
    </div>
  );
}

/* ─── Historical Stats ─────────────────────────────────────── */

function HistoricalStats({ data }: { data: MonteCarloResult }) {
  const h = data.historical;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      <StatCell label="SETTLED" value={h.totalSettled.toString()} />
      <StatCell
        label="WIN RATE"
        value={`${h.winRate.toFixed(1)}%`}
        color={h.winRate >= 50 ? "emerald" : "red"}
      />
      <StatCell
        label="AVG WIN"
        value={`+$${h.avgWinPnl.toFixed(4)}`}
        color="emerald"
      />
      <StatCell
        label="AVG LOSS"
        value={`$${h.avgLossPnl.toFixed(4)}`}
        color="red"
      />
      <StatCell
        label="PROFIT FACTOR"
        value={h.profitFactor.toFixed(2)}
        color={h.profitFactor >= 1 ? "emerald" : "red"}
      />
      <StatCell
        label="EXPECTANCY"
        value={`$${h.expectancy.toFixed(4)}`}
        color={h.expectancy > 0 ? "emerald" : "red"}
      />
    </div>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "emerald" | "red";
}) {
  const valueColor =
    color === "emerald"
      ? "text-emerald-500"
      : color === "red"
        ? "text-red-500"
        : "text-foreground";
  return (
    <div className="border border-border/30 rounded-lg bg-card/30 p-3 flex flex-col items-center justify-center text-center gap-0.5">
      <span className="text-[9px] font-mono text-muted-foreground/70 tracking-widest">
        {label}
      </span>
      <span
        className={`text-sm font-mono font-bold tabular-nums ${valueColor}`}
      >
        {value}
      </span>
    </div>
  );
}

/* ─── Histogram Chart ──────────────────────────────────────── */

function HistogramChart({ data }: { data: MonteCarloResult }) {
  const { histogram, percentiles } = data.distribution;
  const maxCount = Math.max(...histogram.map((b) => b.count));
  const startCap = data.startingCapital;

  return (
    <div className="px-4 py-5">
      {/* Chart */}
      <div className="flex items-end gap-[2px] h-52">
        {histogram.map((bucket, i) => {
          const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
          const midpoint = (bucket.min + bucket.max) / 2;
          const isProfit = midpoint >= startCap;
          const isMedianBucket =
            percentiles.p50 >= bucket.min && percentiles.p50 < bucket.max;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              {/* Tooltip */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-background border border-border/40 rounded px-2 py-1 text-[9px] font-mono text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                ${bucket.min.toFixed(2)} – ${bucket.max.toFixed(2)}
                <br />
                {bucket.count.toLocaleString()} sims
              </div>
              {/* Bar */}
              <div
                className={`w-full rounded-t transition-all duration-200 ${
                  isMedianBucket
                    ? "bg-blue-500"
                    : isProfit
                      ? "bg-emerald-500/70 group-hover:bg-emerald-500"
                      : "bg-red-500/70 group-hover:bg-red-500"
                }`}
                style={{ height: `${Math.max(heightPct, 1)}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Axis labels */}
      <div className="flex justify-between mt-2 text-[9px] font-mono text-muted-foreground/60">
        <span>${histogram[0]?.min.toFixed(0)}</span>
        <span className="text-blue-400">
          Median: ${data.distribution.percentiles.p50.toFixed(2)}
        </span>
        <span>${histogram[histogram.length - 1]?.max.toFixed(0)}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3 text-[9px] font-mono text-muted-foreground/60">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> Profit
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-500/70" /> Loss
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-blue-500" /> Median
        </span>
        <span>Start: ${startCap.toFixed(0)}</span>
      </div>
    </div>
  );
}

/* ─── Equity Curves Chart ──────────────────────────────────── */

function EquityCurvesChart({ data }: { data: MonteCarloResult }) {
  const curves = data.equityCurves;
  const startCap = data.startingCapital;

  // Compute global min/max across all curves
  const { minVal, maxVal, tradeCount } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    for (const c of curves) {
      for (const pt of c.curve) {
        if (pt.balance < min) min = pt.balance;
        if (pt.balance > max) max = pt.balance;
        if (pt.tradeIndex > count) count = pt.tradeIndex;
      }
    }
    return { minVal: min, maxVal: max, tradeCount: count };
  }, [curves]);

  const range = maxVal - minVal || 1;
  const chartHeight = 220;
  const chartWidth = 800; // will be responsive via viewBox

  const curveColors: Record<number, string> = {
    5: "#ef4444", // red
    25: "#f97316", // orange
    50: "#3b82f6", // blue (median)
    75: "#22c55e", // green
    95: "#10b981", // emerald
  };

  const curveLabels: Record<number, string> = {
    5: "P5 (worst)",
    25: "P25",
    50: "P50 (median)",
    75: "P75",
    95: "P95 (best)",
  };

  return (
    <div className="px-4 py-5">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full h-56"
        preserveAspectRatio="none"
      >
        {/* Starting capital reference line */}
        <line
          x1={0}
          y1={chartHeight - ((startCap - minVal) / range) * chartHeight}
          x2={chartWidth}
          y2={chartHeight - ((startCap - minVal) / range) * chartHeight}
          stroke="white"
          strokeOpacity={0.15}
          strokeDasharray="4 4"
        />

        {/* Equity curves */}
        {curves.map((c) => {
          const points = c.curve
            .map((pt) => {
              const x = (pt.tradeIndex / tradeCount) * chartWidth;
              const y =
                chartHeight - ((pt.balance - minVal) / range) * chartHeight;
              return `${x},${y}`;
            })
            .join(" ");

          return (
            <polyline
              key={c.percentile}
              points={points}
              fill="none"
              stroke={curveColors[c.percentile] || "#888"}
              strokeWidth={c.percentile === 50 ? 2.5 : 1.5}
              strokeOpacity={c.percentile === 50 ? 1 : 0.7}
            />
          );
        })}
      </svg>

      {/* Axis labels */}
      <div className="flex justify-between mt-1 text-[9px] font-mono text-muted-foreground/60">
        <span>Trade 0</span>
        <span className="text-white/20">— start: ${startCap.toFixed(0)} —</span>
        <span>Trade {tradeCount}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
        {curves.map((c) => (
          <span
            key={c.percentile}
            className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/70"
          >
            <span
              className="w-3 h-[2px] rounded"
              style={{ backgroundColor: curveColors[c.percentile] || "#888" }}
            />
            {curveLabels[c.percentile] || `P${c.percentile}`}:{" "}
            <span className="text-foreground/80">
              ${c.curve[c.curve.length - 1]?.balance.toFixed(2)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Percentile Card ──────────────────────────────────────── */

function PercentileCard({ data }: { data: MonteCarloResult }) {
  const d = data.distribution;
  const startCap = data.startingCapital;

  const rows = [
    { label: "P5 (worst case)", value: d.percentiles.p5 },
    { label: "P25", value: d.percentiles.p25 },
    { label: "P50 (median)", value: d.percentiles.p50 },
    { label: "P75", value: d.percentiles.p75 },
    { label: "P95 (best case)", value: d.percentiles.p95 },
    { label: "Mean", value: d.mean },
    { label: "Std Dev", value: d.stdDev },
  ];

  return (
    <div className="border border-border/30 rounded-lg bg-card/30 p-4">
      <div className="text-[10px] font-mono text-muted-foreground/70 tracking-widest mb-3 border-b border-border/20 pb-2">
        FINAL BALANCE DISTRIBUTION
      </div>
      <div className="space-y-2">
        {rows.map((row) => {
          const isProfit = row.value >= startCap;
          const pnl = row.value - startCap;
          return (
            <div
              key={row.label}
              className="flex items-center justify-between text-xs font-mono"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-foreground tabular-nums">
                  ${row.value.toFixed(2)}
                </span>
                <span
                  className={`text-[10px] tabular-nums ${
                    isProfit ? "text-emerald-500/70" : "text-red-500/70"
                  }`}
                >
                  ({pnl >= 0 ? "+" : ""}
                  {pnl.toFixed(2)})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Drawdown Card ────────────────────────────────────────── */

function DrawdownCard({ data }: { data: MonteCarloResult }) {
  const dd = data.drawdown;
  const d = data.distribution;

  return (
    <div className="border border-border/30 rounded-lg bg-card/30 p-4">
      <div className="text-[10px] font-mono text-muted-foreground/70 tracking-widest mb-3 border-b border-border/20 pb-2">
        RISK METRICS
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted-foreground">Profit Probability</span>
          <span
            className={`font-bold tabular-nums ${
              d.profitProbability >= 50 ? "text-emerald-500" : "text-red-500"
            }`}
          >
            {d.profitProbability.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted-foreground">
            Ruin Probability (&gt;50% DD)
          </span>
          <span
            className={`font-bold tabular-nums ${
              d.ruinProbability <= 5
                ? "text-emerald-500"
                : d.ruinProbability <= 20
                  ? "text-amber-500"
                  : "text-red-500"
            }`}
          >
            {d.ruinProbability.toFixed(1)}%
          </span>
        </div>
        <div className="border-t border-border/20 pt-2 space-y-2">
          <div className="text-[9px] font-mono text-muted-foreground/60 tracking-widest">
            MAX DRAWDOWN
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">Median</span>
            <span className="text-amber-500 tabular-nums font-bold">
              {dd.median.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">P95</span>
            <span className="text-red-400 tabular-nums font-bold">
              {dd.p95.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">Worst</span>
            <span className="text-red-500 tabular-nums font-bold">
              {dd.worst.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Verdict Card ─────────────────────────────────────────── */

function VerdictCard({ data }: { data: MonteCarloResult }) {
  const h = data.historical;
  const d = data.distribution;
  const dd = data.drawdown;

  // Score: 0–100 based on multiple factors
  const scores = [
    // Win rate score (0–20)
    Math.min(20, (h.winRate / 60) * 20),
    // Profit factor score (0–20)
    Math.min(20, h.profitFactor >= 1 ? ((h.profitFactor - 1) / 2) * 20 : 0),
    // Profit probability score (0–20)
    (d.profitProbability / 100) * 20,
    // Low ruin risk score (0–20)
    Math.max(0, 20 - d.ruinProbability),
    // Median drawdown score (0–20) — lower is better
    Math.max(0, 20 - dd.median),
  ];
  const totalScore = Math.round(scores.reduce((s, v) => s + v, 0));

  const verdict =
    totalScore >= 75
      ? {
          label: "ROBUST",
          color: "emerald",
          desc: "Strategy shows strong edge across simulated paths",
        }
      : totalScore >= 50
        ? {
            label: "VIABLE",
            color: "amber",
            desc: "Strategy has potential but carries meaningful risk",
          }
        : {
            label: "FRAGILE",
            color: "red",
            desc: "Strategy shows insufficient edge — high risk of drawdown",
          };

  const verdictColor =
    verdict.color === "emerald"
      ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
      : verdict.color === "amber"
        ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
        : "text-red-500 border-red-500/30 bg-red-500/10";

  return (
    <div className={`border rounded-lg p-4 ${verdictColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold font-mono">{totalScore}</span>
          <div>
            <div className="text-sm font-mono font-bold tracking-widest">
              {verdict.label}
            </div>
            <div className="text-[10px] font-mono opacity-70">
              {verdict.desc}
            </div>
          </div>
        </div>
        <div className="text-right text-[9px] font-mono opacity-60 space-y-0.5">
          <div>
            {h.totalSettled} trades &bull; {h.winRate.toFixed(1)}% win rate
          </div>
          <div>
            {d.profitProbability.toFixed(1)}% profit prob &bull;{" "}
            {dd.median.toFixed(1)}% median DD
          </div>
        </div>
      </div>

      {/* Score breakdown bar */}
      <div className="mt-3 h-1.5 w-full bg-black/20 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${totalScore}%`,
            backgroundColor:
              verdict.color === "emerald"
                ? "#10b981"
                : verdict.color === "amber"
                  ? "#f59e0b"
                  : "#ef4444",
          }}
        />
      </div>
    </div>
  );
}
