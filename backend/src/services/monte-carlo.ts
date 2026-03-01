import { createModuleLogger } from "../utils/logger.js";
import { getDb, getPortfolio } from "../db/client.js";
import * as schema from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import Decimal from "decimal.js";

const logger = createModuleLogger("monte-carlo");

// ── Types ──────────────────────────────────────────────────

export interface TradeOutcome {
  pnl: number;
  pnlPct: number;
  isWin: boolean;
}

export interface MonteCarloConfig {
  /** Number of simulated equity curves to generate */
  simulations: number;
  /** Number of trades per simulated curve */
  tradesPerSim: number;
}

export interface EquityCurvePoint {
  tradeIndex: number;
  balance: number;
}

export interface PercentileEquityCurve {
  percentile: number;
  curve: EquityCurvePoint[];
}

export interface MonteCarloResult {
  /** Input parameters used */
  config: MonteCarloConfig;

  /** Historical trade statistics used as basis */
  historical: {
    totalSettled: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinPnl: number;
    avgLossPnl: number;
    avgWinPct: number;
    avgLossPct: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;
    expectancy: number;
    /** Per-trade P&L distribution */
    pnlDistribution: number[];
  };

  /** Final balance distribution across all simulations */
  distribution: {
    /** Histogram buckets: { min, max, count } */
    histogram: { min: number; max: number; count: number }[];
    /** Key percentiles of the final balance */
    percentiles: {
      p5: number;
      p25: number;
      p50: number;
      p75: number;
      p95: number;
    };
    /** Mean final balance */
    mean: number;
    /** Standard deviation */
    stdDev: number;
    /** % of simulations that ended in profit */
    profitProbability: number;
    /** % of simulations that suffered a drawdown > 50% */
    ruinProbability: number;
  };

  /** Equity curves at key percentiles for charting */
  equityCurves: PercentileEquityCurve[];

  /** Maximum drawdown statistics */
  drawdown: {
    median: number;
    p95: number;
    worst: number;
  };

  /** Starting capital used */
  startingCapital: number;
}

// ── Core ───────────────────────────────────────────────────

const DEFAULT_CONFIG: MonteCarloConfig = {
  simulations: 10_000,
  tradesPerSim: 100,
};

/**
 * Run a Monte Carlo analysis on all settled trades.
 *
 * We use the *realised PnL* (not exitOutcome) to determine if a trade
 * was a win or loss — this correctly handles stop-loss exits that may
 * sell above entry and therefore aren't actually losses.
 */
export async function runMonteCarloAnalysis(
  overrides?: Partial<MonteCarloConfig>,
): Promise<MonteCarloResult> {
  const config: MonteCarloConfig = { ...DEFAULT_CONFIG, ...overrides };
  const db = getDb();

  // 1. Load all settled trades
  const settledTrades = await db
    .select()
    .from(schema.simulatedTrades)
    .where(eq(schema.simulatedTrades.status, "SETTLED"))
    .orderBy(desc(schema.simulatedTrades.exitTs));

  if (settledTrades.length === 0) {
    throw new Error("No settled trades to analyse — need historical data");
  }

  // 2. Extract P&L data using realizedPnl (not exitOutcome)
  const outcomes: TradeOutcome[] = [];
  for (const trade of settledTrades) {
    const pnl = parseFloat(trade.realizedPnl ?? "0");
    const cost = parseFloat(trade.actualCost);
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    outcomes.push({ pnl, pnlPct, isWin: pnl > 0 });
  }

  // 3. Historical statistics
  const wins = outcomes.filter((o) => o.isWin);
  const losses = outcomes.filter((o) => !o.isWin);
  const winRate = wins.length / outcomes.length;
  const avgWinPnl =
    wins.length > 0 ? wins.reduce((s, o) => s + o.pnl, 0) / wins.length : 0;
  const avgLossPnl =
    losses.length > 0
      ? losses.reduce((s, o) => s + o.pnl, 0) / losses.length
      : 0;
  const avgWinPct =
    wins.length > 0 ? wins.reduce((s, o) => s + o.pnlPct, 0) / wins.length : 0;
  const avgLossPct =
    losses.length > 0
      ? losses.reduce((s, o) => s + o.pnlPct, 0) / losses.length
      : 0;
  const largestWin = wins.length > 0 ? Math.max(...wins.map((o) => o.pnl)) : 0;
  const largestLoss =
    losses.length > 0 ? Math.min(...losses.map((o) => o.pnl)) : 0;
  const totalWinPnl = wins.reduce((s, o) => s + o.pnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((s, o) => s + o.pnl, 0));
  const profitFactor =
    totalLossPnl > 0
      ? totalWinPnl / totalLossPnl
      : totalWinPnl > 0
        ? Infinity
        : 0;
  const expectancy = outcomes.reduce((s, o) => s + o.pnl, 0) / outcomes.length;

  // 4. Get starting capital
  const portfolio = await getPortfolio();
  const startingCapital = portfolio
    ? parseFloat(portfolio.initialCapital)
    : 100;

  // 5. Run Monte Carlo simulations
  //    For each sim we randomly sample (with replacement) from the historical
  //    P&L distribution and build an equity curve.
  const pnlPool = outcomes.map((o) => o.pnl);
  const finalBalances: number[] = [];
  const maxDrawdowns: number[] = [];
  // Store all equity curves, then sample percentile ones
  const allCurves: number[][] = [];

  for (let sim = 0; sim < config.simulations; sim++) {
    let balance = startingCapital;
    let peak = balance;
    let maxDD = 0;
    const curve: number[] = [balance];

    for (let t = 0; t < config.tradesPerSim; t++) {
      // Random sample from historical distribution
      const randomIdx = Math.floor(Math.random() * pnlPool.length);
      const pnl = pnlPool[randomIdx]!;
      balance += pnl;

      // Track equity curve
      curve.push(balance);

      // Track max drawdown
      if (balance > peak) peak = balance;
      const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }

    finalBalances.push(balance);
    maxDrawdowns.push(maxDD);
    allCurves.push(curve);
  }

  // 6. Compute distribution statistics
  finalBalances.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) => {
    const idx = Math.floor((p / 100) * (arr.length - 1));
    return arr[idx]!;
  };

  const mean = finalBalances.reduce((s, v) => s + v, 0) / finalBalances.length;
  const variance =
    finalBalances.reduce((s, v) => s + (v - mean) ** 2, 0) /
    finalBalances.length;
  const stdDev = Math.sqrt(variance);

  const profitCount = finalBalances.filter((b) => b > startingCapital).length;
  const profitProbability = (profitCount / finalBalances.length) * 100;

  const ruinCount = maxDrawdowns.filter((dd) => dd > 50).length;
  const ruinProbability = (ruinCount / maxDrawdowns.length) * 100;

  // 7. Build histogram (20 buckets)
  const bucketCount = 20;
  const minBal = finalBalances[0]!;
  const maxBal = finalBalances[finalBalances.length - 1]!;
  const bucketWidth = (maxBal - minBal) / bucketCount || 1;
  const histogram: { min: number; max: number; count: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bMin = minBal + i * bucketWidth;
    const bMax =
      i === bucketCount - 1 ? maxBal + 0.01 : minBal + (i + 1) * bucketWidth;
    const count = finalBalances.filter((b) => b >= bMin && b < bMax).length;
    histogram.push({
      min: parseFloat(bMin.toFixed(2)),
      max: parseFloat(bMax.toFixed(2)),
      count,
    });
  }

  // 8. Extract equity curves at key percentiles
  const curvePercentiles = [5, 25, 50, 75, 95];
  // Sort allCurves by final balance
  const sortedCurveIndices = finalBalances
    .map((_, i) => i)
    .sort((a, b) => {
      const aCurve = allCurves[a]!;
      const bCurve = allCurves[b]!;
      return aCurve[aCurve.length - 1]! - bCurve[bCurve.length - 1]!;
    });

  const equityCurves: PercentileEquityCurve[] = curvePercentiles.map((p) => {
    const idx = Math.floor((p / 100) * (sortedCurveIndices.length - 1));
    const curveIdx = sortedCurveIndices[idx]!;
    const curve = allCurves[curveIdx]!;
    return {
      percentile: p,
      curve: curve.map((balance, tradeIndex) => ({
        tradeIndex,
        balance: parseFloat(balance.toFixed(2)),
      })),
    };
  });

  logger.info(
    {
      settledTrades: outcomes.length,
      simulations: config.simulations,
      winRate: (winRate * 100).toFixed(1),
      profitProbability: profitProbability.toFixed(1),
      medianFinal: percentile(finalBalances, 50).toFixed(2),
    },
    "Monte Carlo analysis complete",
  );

  return {
    config,
    historical: {
      totalSettled: outcomes.length,
      wins: wins.length,
      losses: losses.length,
      winRate: parseFloat((winRate * 100).toFixed(2)),
      avgWinPnl: parseFloat(avgWinPnl.toFixed(6)),
      avgLossPnl: parseFloat(avgLossPnl.toFixed(6)),
      avgWinPct: parseFloat(avgWinPct.toFixed(2)),
      avgLossPct: parseFloat(avgLossPct.toFixed(2)),
      largestWin: parseFloat(largestWin.toFixed(6)),
      largestLoss: parseFloat(largestLoss.toFixed(6)),
      profitFactor: parseFloat(
        profitFactor === Infinity ? "999" : profitFactor.toFixed(2),
      ),
      expectancy: parseFloat(expectancy.toFixed(6)),
      pnlDistribution: outcomes.map((o) => parseFloat(o.pnl.toFixed(6))),
    },
    distribution: {
      histogram,
      percentiles: {
        p5: parseFloat(percentile(finalBalances, 5).toFixed(2)),
        p25: parseFloat(percentile(finalBalances, 25).toFixed(2)),
        p50: parseFloat(percentile(finalBalances, 50).toFixed(2)),
        p75: parseFloat(percentile(finalBalances, 75).toFixed(2)),
        p95: parseFloat(percentile(finalBalances, 95).toFixed(2)),
      },
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      profitProbability: parseFloat(profitProbability.toFixed(2)),
      ruinProbability: parseFloat(ruinProbability.toFixed(2)),
    },
    equityCurves,
    drawdown: {
      median: parseFloat(percentile(maxDrawdowns, 50).toFixed(2)),
      p95: parseFloat(percentile(maxDrawdowns, 95).toFixed(2)),
      worst: parseFloat(maxDrawdowns[maxDrawdowns.length - 1]!.toFixed(2)),
    },
    startingCapital,
  };
}
