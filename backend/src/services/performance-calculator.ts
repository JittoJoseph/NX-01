import { createModuleLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

const logger = createModuleLogger("performance-calculator");

export type TimePeriod = "1D" | "1W" | "1M" | "ALL";

export interface PerformanceMetrics {
  period: TimePeriod;
  totalPnl: string;
  totalInvested: string;
  roi: string;
  totalTrades: number;
  wins: number;
  losses: number;
  stopLosses: number;
  winRate: string;
  avgWin: string;
  avgLoss: string;
  largestWin: string;
  largestLoss: string;
  totalFees: string;
  avgBtcDistance: string;
  openPositions: number;
  unrealizedPnl: string;
}

function getPeriodStart(period: TimePeriod): Date | null {
  if (period === "ALL") return null;
  const now = new Date();
  switch (period) {
    case "1D":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "1W":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1M":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

export async function calculatePortfolioPerformance(
  period: TimePeriod,
  livePriceMap?: Map<string, number>,
): Promise<PerformanceMetrics> {
  const db = getDb();
  const periodStart = getPeriodStart(period);

  // Build conditions
  const conditions = [];
  if (periodStart) {
    conditions.push(gte(schema.simulatedTrades.entryTs, periodStart));
  }

  const baseQuery = db
    .select()
    .from(schema.simulatedTrades)
    .orderBy(desc(schema.simulatedTrades.entryTs));

  const trades =
    conditions.length > 0
      ? await baseQuery.where(and(...conditions))
      : await baseQuery;

  let totalPnl = new Decimal(0);
  let totalInvested = new Decimal(0);
  let totalFees = new Decimal(0);
  let wins = 0;
  let losses = 0;
  let stopLosses = 0;
  let winPnlSum = new Decimal(0);
  let lossPnlSum = new Decimal(0);
  let largestWin = new Decimal(0);
  let largestLoss = new Decimal(0);
  let btcDistanceSum = new Decimal(0);
  let btcDistanceCount = 0;
  let openPositions = 0;
  let unrealizedPnl = new Decimal(0);

  for (const trade of trades) {
    const invested = new Decimal(trade.simulatedUsdAmount);
    totalInvested = totalInvested.plus(invested);
    totalFees = totalFees.plus(new Decimal(trade.entryFees ?? "0"));

    if (trade.status === "CLOSED" && trade.realizedPnl !== null) {
      const pnl = new Decimal(trade.realizedPnl);
      totalPnl = totalPnl.plus(pnl);

      if (trade.exitOutcome === "WIN") {
        wins++;
        winPnlSum = winPnlSum.plus(pnl);
        if (pnl.gt(largestWin)) largestWin = pnl;
      } else if (trade.exitOutcome === "STOP_LOSS") {
        stopLosses++;
        lossPnlSum = lossPnlSum.plus(pnl);
        if (pnl.lt(largestLoss)) largestLoss = pnl;
      } else {
        losses++;
        lossPnlSum = lossPnlSum.plus(pnl);
        if (pnl.lt(largestLoss)) largestLoss = pnl;
      }
    } else if (trade.status === "OPEN") {
      openPositions++;
      // Calculate unrealized P&L using live prices
      if (livePriceMap && trade.tokenId) {
        const currentPrice = livePriceMap.get(trade.tokenId);
        if (currentPrice !== undefined) {
          const entryPrice = parseFloat(trade.entryPrice);
          const shares = parseFloat(trade.entryShares);
          const fees = parseFloat(trade.entryFees ?? "0");
          const uPnl = (currentPrice - entryPrice) * shares - fees;
          unrealizedPnl = unrealizedPnl.plus(uPnl);
        }
      }
    }

    if (trade.btcDistanceUsd) {
      btcDistanceSum = btcDistanceSum.plus(new Decimal(trade.btcDistanceUsd));
      btcDistanceCount++;
    }
  }

  const closedTrades = wins + losses + stopLosses;
  const totalTrades = trades.length;
  const winRate =
    closedTrades > 0 ? ((wins / closedTrades) * 100).toFixed(2) : "0.00";
  const roi = totalInvested.gt(0)
    ? totalPnl.div(totalInvested).mul(100).toFixed(2)
    : "0.00";
  const avgWin = wins > 0 ? winPnlSum.div(wins).toFixed(6) : "0";
  const avgLoss =
    losses + stopLosses > 0
      ? lossPnlSum.div(losses + stopLosses).toFixed(6)
      : "0";
  const avgBtcDistance =
    btcDistanceCount > 0
      ? btcDistanceSum.div(btcDistanceCount).toFixed(4)
      : "0";

  return {
    period,
    totalPnl: totalPnl.toFixed(6),
    totalInvested: totalInvested.toFixed(2),
    roi,
    totalTrades,
    wins,
    losses,
    stopLosses,
    winRate,
    avgWin,
    avgLoss,
    largestWin: largestWin.toFixed(6),
    largestLoss: largestLoss.toFixed(6),
    totalFees: totalFees.toFixed(6),
    avgBtcDistance,
    openPositions,
    unrealizedPnl: unrealizedPnl.toFixed(6),
  };
}
