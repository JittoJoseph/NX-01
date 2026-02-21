import Decimal from "decimal.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { sql, and } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("performance-calculator");

export type TimePeriod = "1D" | "1W" | "1M" | "ALL";

export interface PerformanceMetrics {
  period: TimePeriod;
  timeframe: {
    start: string | null;
    end: string;
  };
  summary: {
    totalPnl: string;
    realizedPnl: string;
    unrealizedPnl: string;
    netPnl: string;
    totalFees: string;
    totalInvested: string;
    roi: string;
  };
  trades: {
    total: number;
    open: number;
    closed: number;
    wins: number;
    losses: number;
    winRate: string;
  };
  performance: {
    largestWin: string;
    largestLoss: string;
    avgWin: string;
    avgLoss: string;
  };
}

interface TradeData {
  id: number | string;
  status: string;
  entryTs: string | Date;
  simulatedUsdAmount: string | null;
  entryPrice: string;
  entryShares: string;
  realizedPnl: string | null;
  entryFees: string | null;
  claimOutcome: string | null;
  tokenId: string | null;
  marketId: string | null;
  outcomeLabel: string | null;
}

function getTimeThreshold(period: TimePeriod): Date | null {
  const now = new Date();
  switch (period) {
    case "1D":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "1W":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1M":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "ALL":
      return null;
    default:
      throw new Error(`Invalid period: ${period}`);
  }
}

async function fetchCurrentPricesForOpenTrades(
  trades: TradeData[],
): Promise<Map<string, number>> {
  // Use orchestrator's cached live prices instead of expensive per-token REST calls.
  // The orchestrator already maintains real-time prices from WS price_change events.
  // This eliminates the main bottleneck that made /api/performance slow.
  try {
    const { getMarketOrchestrator } = await import("./market-orchestrator.js");
    const orchestrator = getMarketOrchestrator();
    return orchestrator.getLivePriceMap();
  } catch {
    return new Map();
  }
}

async function fetchTrades(timeThreshold: Date | null): Promise<TradeData[]> {
  const db = getDb();

  const baseQuery = db
    .select({
      id: schema.simulatedTrades.id,
      status: schema.simulatedTrades.status,
      entryTs: schema.simulatedTrades.entryTs,
      simulatedUsdAmount: schema.simulatedTrades.simulatedUsdAmount,
      entryPrice: schema.simulatedTrades.entryPrice,
      entryShares: schema.simulatedTrades.entryShares,
      realizedPnl: schema.simulatedTrades.realizedPnl,
      entryFees: schema.simulatedTrades.entryFees,
      claimOutcome: schema.simulatedTrades.claimOutcome,
      tokenId: schema.simulatedTrades.tokenId,
      marketId: schema.simulatedTrades.marketId,
      outcomeLabel: schema.simulatedTrades.outcomeLabel,
    })
    .from(schema.simulatedTrades);

  const conditions = [];
  if (timeThreshold) {
    conditions.push(
      sql`${schema.simulatedTrades.entryTs} >= ${timeThreshold.toISOString()}`,
    );
  }

  return conditions.length > 0
    ? await baseQuery.where(and(...conditions))
    : await baseQuery;
}

function calculateMetrics(
  trades: TradeData[],
  currentPrices: Map<string, number>,
) {
  let totalRealizedPnl = new Decimal(0);
  let totalUnrealizedPnl = new Decimal(0);
  let totalInvested = new Decimal(0);
  let totalFees = new Decimal(0);
  let winCount = 0;
  let lossCount = 0;
  let openCount = 0;
  let closedCount = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalWinPnl = 0;
  let totalLossPnl = 0;

  for (const trade of trades) {
    const invested = new Decimal(trade.simulatedUsdAmount?.toString() || "1");
    const entryFees = new Decimal(trade.entryFees?.toString() || "0");
    totalInvested = totalInvested.plus(invested);
    totalFees = totalFees.plus(entryFees);

    if (trade.status === "OPEN") {
      openCount++;
      // Calculate unrealized P&L for open positions
      if (trade.tokenId && currentPrices.has(trade.tokenId)) {
        const currentPrice = currentPrices.get(trade.tokenId)!;
        const entryPrice = new Decimal(trade.entryPrice);
        const shares = new Decimal(trade.entryShares);
        const unrealizedPnl =
          currentPrice > 0
            ? new Decimal(currentPrice).minus(entryPrice).mul(shares)
            : new Decimal(0);
        totalUnrealizedPnl = totalUnrealizedPnl.plus(unrealizedPnl);
      }
    } else if (trade.status === "CLOSED") {
      closedCount++;
      const realizedPnl = new Decimal(trade.realizedPnl?.toString() || "0");
      totalRealizedPnl = totalRealizedPnl.plus(realizedPnl);

      const pnlValue = realizedPnl.toNumber();
      if (trade.claimOutcome === "WIN") {
        winCount++;
        totalWinPnl += pnlValue;
        if (pnlValue > largestWin) largestWin = pnlValue;
      } else if (trade.claimOutcome === "LOSS") {
        lossCount++;
        totalLossPnl += pnlValue;
        if (pnlValue < largestLoss) largestLoss = pnlValue;
      }
    }
  }

  const totalPnl = totalRealizedPnl.plus(totalUnrealizedPnl);
  const netPnl = totalPnl; // fees are already baked into realizedPnl
  const roi = totalInvested.gt(0)
    ? netPnl.div(totalInvested).mul(100)
    : new Decimal(0);
  const winRate =
    winCount + lossCount > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;
  const avgWin = winCount > 0 ? totalWinPnl / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLossPnl / lossCount : 0;

  return {
    totalPnl,
    totalRealizedPnl,
    totalUnrealizedPnl,
    netPnl,
    totalFees,
    totalInvested,
    roi,
    winCount,
    lossCount,
    openCount,
    closedCount,
    largestWin,
    largestLoss,
    avgWin,
    avgLoss,
    winRate,
    totalTrades: trades.length,
  };
}

export async function calculatePortfolioPerformance(
  period: TimePeriod = "1D",
): Promise<PerformanceMetrics> {
  try {
    const timeThreshold = getTimeThreshold(period);
    const trades = await fetchTrades(timeThreshold);
    const currentPrices = await fetchCurrentPricesForOpenTrades(trades);
    const m = calculateMetrics(trades, currentPrices);
    const now = new Date();

    return {
      period,
      timeframe: {
        start: timeThreshold?.toISOString() || null,
        end: now.toISOString(),
      },
      summary: {
        totalPnl: m.totalPnl.toFixed(4),
        realizedPnl: m.totalRealizedPnl.toFixed(4),
        unrealizedPnl: m.totalUnrealizedPnl.toFixed(4),
        netPnl: m.netPnl.toFixed(4),
        totalFees: m.totalFees.toFixed(4),
        totalInvested: m.totalInvested.toFixed(2),
        roi: m.roi.toFixed(2),
      },
      trades: {
        total: m.totalTrades,
        open: m.openCount,
        closed: m.closedCount,
        wins: m.winCount,
        losses: m.lossCount,
        winRate: m.winRate.toFixed(2),
      },
      performance: {
        largestWin: m.largestWin.toFixed(4),
        largestLoss: m.largestLoss.toFixed(4),
        avgWin: m.avgWin.toFixed(4),
        avgLoss: m.avgLoss.toFixed(4),
      },
    };
  } catch (error) {
    logger.error(
      { error, period },
      "Failed to calculate portfolio performance",
    );
    throw error;
  }
}
