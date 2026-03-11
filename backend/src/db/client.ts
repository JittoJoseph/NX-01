import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import * as schema from "./schema.js";
import { eq, sql, and, inArray } from "drizzle-orm";

const logger = createModuleLogger("database");

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    const config = getConfig();
    client = postgres(config.db.url, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    db = drizzle(client, { schema, logger: false });
    logger.info("Drizzle database client initialized");
  }
  return db;
}

export async function connectDatabase(): Promise<void> {
  const database = getDb();
  await database.execute(sql`SELECT 1`);
  logger.info("Database connection established");
}

export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
    logger.info("Database connection closed");
  }
}

// ============================================
// Market helpers
// ============================================

export async function insertMarketIfNew(
  id: string,
  data: {
    conditionId?: string;
    slug?: string;
    question?: string;
    clobTokenIds?: string[];
    outcomes?: string[];
    windowType: string;
    category: string;
    endDate?: string | null;
    targetPrice?: number | null;
    negRisk?: boolean;
    tickSize?: string;
    feesEnabled?: boolean;
    active?: boolean;
    metadata?: unknown;
  },
): Promise<boolean> {
  const database = getDb();

  const record = {
    id,
    conditionId: data.conditionId || null,
    slug: data.slug || null,
    question: data.question || null,
    clobTokenIds: data.clobTokenIds as any,
    outcomes: data.outcomes as any,
    windowType: data.windowType,
    category: data.category,
    endDate: data.endDate || null,
    targetPrice: data.targetPrice?.toString() ?? null,
    negRisk: data.negRisk ?? false,
    tickSize: data.tickSize ?? "0.01",
    feesEnabled: data.feesEnabled ?? true,
    active: data.active ?? true,
    metadata: data.metadata as any,
  };

  const result = await database
    .insert(schema.markets)
    .values(record)
    .onConflictDoNothing({ target: schema.markets.id })
    .returning({ id: schema.markets.id });

  return result.length > 0;
}

// ============================================
// Trade helpers
// ============================================

/** Load active trades (PENDING, MATCHED, CONFIRMED) with market data. */
export async function loadActiveTradesWithMarkets() {
  const database = getDb();
  const rows = await database
    .select({
      trade: schema.trades,
      marketEndDate: schema.markets.endDate,
    })
    .from(schema.trades)
    .leftJoin(schema.markets, eq(schema.trades.marketId, schema.markets.id))
    .where(inArray(schema.trades.status, ["PENDING", "MATCHED", "CONFIRMED"]));
  return rows;
}

/** Create a new trade record when an order is placed. */
export async function createTrade(data: {
  polymarketOrderId?: string;
  marketId?: string;
  conditionId?: string;
  tokenId: string;
  marketCategory?: string;
  windowType?: string;
  outcomeLabel?: string;
  side?: string;
  orderType?: string;
  status?: string;
  entryTs: Date;
  entryPrice: string;
  entryShares: string;
  positionBudget: string;
  actualCost: string;
  entryFees?: string;
  fillStatus?: string;
  btcPriceAtEntry?: number;
  btcTargetPrice?: number;
  btcDistanceUsd?: number;
  momentumDirection?: string;
  momentumChangeUsd?: number;
  rawOrderResponse?: unknown;
}) {
  const database = getDb();
  const result = await database
    .insert(schema.trades)
    .values({
      polymarketOrderId: data.polymarketOrderId || null,
      marketId: data.marketId || null,
      conditionId: data.conditionId || null,
      tokenId: data.tokenId,
      marketCategory: data.marketCategory || null,
      windowType: data.windowType || null,
      side: data.side ?? "BUY",
      orderType: data.orderType ?? "FAK",
      outcomeLabel: data.outcomeLabel || null,
      status: data.status ?? "PENDING",
      entryTs: data.entryTs,
      entryPrice: data.entryPrice,
      entryShares: data.entryShares,
      positionBudget: data.positionBudget,
      actualCost: data.actualCost,
      entryFees: data.entryFees ?? "0",
      fillStatus: data.fillStatus ?? "FULL",
      btcPriceAtEntry: data.btcPriceAtEntry?.toString() ?? null,
      btcTargetPrice: data.btcTargetPrice?.toString() ?? null,
      btcDistanceUsd: data.btcDistanceUsd?.toString() ?? null,
      momentumDirection: data.momentumDirection || null,
      momentumChangeUsd: data.momentumChangeUsd?.toString() ?? null,
      rawOrderResponse: data.rawOrderResponse as any,
    })
    .returning();
  return result[0];
}

/** Update trade status and metadata after Polymarket trade confirmations. */
export async function updateTradeStatus(
  id: string,
  updates: {
    status?: string;
    tradeStatus?: string;
    polymarketTradeIds?: string[];
    transactionHashes?: string[];
    entryPrice?: string;
    entryShares?: string;
    actualCost?: string;
    entryFees?: string;
    rawTradeData?: unknown;
  },
) {
  const database = getDb();
  const setObj: Record<string, any> = { updatedAt: new Date() };
  if (updates.status) setObj.status = updates.status;
  if (updates.tradeStatus) setObj.tradeStatus = updates.tradeStatus;
  if (updates.polymarketTradeIds)
    setObj.polymarketTradeIds = updates.polymarketTradeIds;
  if (updates.transactionHashes)
    setObj.transactionHashes = updates.transactionHashes;
  if (updates.entryPrice) setObj.entryPrice = updates.entryPrice;
  if (updates.entryShares) setObj.entryShares = updates.entryShares;
  if (updates.actualCost) setObj.actualCost = updates.actualCost;
  if (updates.entryFees) setObj.entryFees = updates.entryFees;
  if (updates.rawTradeData) setObj.rawTradeData = updates.rawTradeData;

  const result = await database
    .update(schema.trades)
    .set(setObj)
    .where(eq(schema.trades.id, id))
    .returning();
  return result[0];
}

/** Resolve/settle a trade (market resolved or stop-loss executed). */
export async function resolveTrade(
  id: string,
  outcome: "WIN" | "LOSS" | "STOP_LOSS",
  realizedPnl: string,
  exitPrice?: string,
  minPriceDuringPosition?: string,
  exitOrderId?: string,
  exitFees?: string,
) {
  const database = getDb();
  const finalExitPrice = exitPrice ?? (outcome === "WIN" ? "1" : "0");

  const result = await database
    .update(schema.trades)
    .set({
      exitOutcome: outcome,
      exitPrice: finalExitPrice,
      exitTs: new Date(),
      realizedPnl,
      status: "SETTLED",
      updatedAt: new Date(),
      ...(minPriceDuringPosition != null ? { minPriceDuringPosition } : {}),
      ...(exitOrderId != null ? { exitOrderId } : {}),
      ...(exitFees != null ? { exitFees } : {}),
    })
    .where(eq(schema.trades.id, id))
    .returning();
  return result[0];
}

/** Mark a trade as failed (order rejected, timeout, etc.). */
export async function failTrade(id: string, errorMessage: string) {
  const database = getDb();
  const result = await database
    .update(schema.trades)
    .set({
      status: "FAILED",
      updatedAt: new Date(),
      rawTradeData: { error: errorMessage } as any,
    })
    .where(eq(schema.trades.id, id))
    .returning();
  return result[0];
}

// ============================================
// Audit log
// ============================================

export async function logAudit(
  level: "info" | "warn" | "error",
  category: string,
  message: string,
  metadata?: unknown,
) {
  const database = getDb();
  try {
    await database.insert(schema.auditLogs).values({
      level,
      category,
      message,
      metadata: metadata as any,
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to write audit log");
  }
}

// ============================================
// Portfolio helpers
// ============================================

export async function getPortfolio() {
  const database = getDb();
  const rows = await database
    .select()
    .from(schema.portfolio)
    .where(eq(schema.portfolio.id, 1))
    .limit(1);
  return rows[0] ?? null;
}

export async function initPortfolio(startingCapital: number) {
  const database = getDb();
  const existing = await getPortfolio();
  if (existing) return existing;

  const result = await database
    .insert(schema.portfolio)
    .values({
      id: 1,
      initialCapital: startingCapital.toString(),
      lastKnownBalance: startingCapital.toString(),
    })
    .returning();
  return result[0];
}

/** Update the cached USDC balance from Polymarket. */
export async function updateLastKnownBalance(newBalance: string) {
  const database = getDb();
  const result = await database
    .update(schema.portfolio)
    .set({
      lastKnownBalance: newBalance,
      balanceUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.portfolio.id, 1))
    .returning();
  return result[0];
}

/** Record a balance snapshot for equity curve tracking. */
export async function insertBalanceSnapshot(data: {
  usdcBalance: string;
  positionsValue: string;
  totalValue: string;
}) {
  const database = getDb();
  await database.insert(schema.balanceSnapshots).values({
    usdcBalance: data.usdcBalance,
    positionsValue: data.positionsValue,
    totalValue: data.totalValue,
  });
}

/** Wipe all data and reset portfolio. */
export async function wipeAndResetPortfolio(startingCapital: number) {
  const database = getDb();
  await database.delete(schema.trades);
  await database.delete(schema.balanceSnapshots);
  await database.delete(schema.auditLogs);
  await database.delete(schema.portfolio);
  const result = await database
    .insert(schema.portfolio)
    .values({
      id: 1,
      initialCapital: startingCapital.toString(),
      lastKnownBalance: startingCapital.toString(),
    })
    .returning();
  return result[0];
}
