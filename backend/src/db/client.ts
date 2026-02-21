import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import * as schema from "./schema.js";
import { eq, sql } from "drizzle-orm";

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

export async function upsertMarket(
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
    active?: boolean;
    metadata?: unknown;
  },
) {
  const database = getDb();

  const existing = await database
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, id))
    .limit(1);

  const record = {
    conditionId: data.conditionId || null,
    slug: data.slug || null,
    question: data.question || null,
    clobTokenIds: data.clobTokenIds as any,
    outcomes: data.outcomes as any,
    windowType: data.windowType,
    category: data.category,
    endDate: data.endDate || null,
    targetPrice: data.targetPrice?.toString() ?? null,
    active: data.active ?? true,
    metadata: data.metadata as any,
  };

  if (existing.length > 0) {
    const result = await database
      .update(schema.markets)
      .set({ ...record, lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.markets.id, id))
      .returning();
    return result[0];
  } else {
    const result = await database
      .insert(schema.markets)
      .values({ id, ...record })
      .returning();
    return result[0];
  }
}

// ============================================
// Trade helpers
// ============================================

export async function createSimulatedTrade(data: {
  experimentId?: string;
  marketId?: string;
  tokenId: string;
  marketCategory?: string;
  windowType?: string;
  outcomeLabel?: string;
  entryTs: Date;
  entryPrice: string;
  entryShares: string;
  simulatedUsdAmount?: number;
  entryFees?: string;
  feeRateBps?: number;
  fillStatus?: string;
  btcPriceAtEntry?: number;
  btcTargetPrice?: number;
  btcDistancePercent?: number;
  strategyTrigger?: string;
  orderbookSnapshot?: unknown;
  raw?: unknown;
}) {
  const database = getDb();
  const result = await database
    .insert(schema.simulatedTrades)
    .values({
      experimentId: data.experimentId || null,
      marketId: data.marketId || null,
      tokenId: data.tokenId,
      marketCategory: data.marketCategory || null,
      windowType: data.windowType || null,
      side: "BUY",
      orderType: "LIMIT_GTC",
      outcomeLabel: data.outcomeLabel || null,
      entryTs: data.entryTs,
      entryPrice: data.entryPrice,
      entryShares: data.entryShares,
      simulatedUsdAmount: data.simulatedUsdAmount?.toString() ?? "1",
      entryFees: data.entryFees ?? "0",
      feeRateBps: data.feeRateBps ?? null,
      fillStatus: data.fillStatus ?? "FULL",
      btcPriceAtEntry: data.btcPriceAtEntry?.toString() ?? null,
      btcTargetPrice: data.btcTargetPrice?.toString() ?? null,
      btcDistancePercent: data.btcDistancePercent?.toString() ?? null,
      strategyTrigger: data.strategyTrigger || null,
      orderbookSnapshot: data.orderbookSnapshot as any,
      raw: data.raw as any,
      status: "OPEN",
    })
    .returning();
  return result[0];
}

export async function resolveTrade(
  id: string,
  outcome: "WIN" | "LOSS" | "STOP_LOSS",
  realizedPnl: string,
  exitPrice?: string,
) {
  const database = getDb();
  const finalExitPrice = exitPrice ?? (outcome === "WIN" ? "1" : "0");

  const result = await database
    .update(schema.simulatedTrades)
    .set({
      exitOutcome: outcome,
      exitPrice: finalExitPrice,
      exitTs: new Date(),
      realizedPnl,
      status: "CLOSED",
      updatedAt: new Date(),
    })
    .where(eq(schema.simulatedTrades.id, id))
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
// Experiment runs
// ============================================

export async function createExperimentRun(data: {
  id: string;
  name: string;
  description?: string | null;
  strategyVariant?: string | null;
  parameters?: any;
  status?: string;
}): Promise<void> {
  const database = getDb();
  await database.insert(schema.experimentRuns).values({
    id: data.id,
    name: data.name,
    description: data.description || null,
    strategyVariant: data.strategyVariant || null,
    parameters: data.parameters || null,
    status: data.status || "RUNNING",
  });
}

export async function updateExperimentRun(
  experimentId: string,
  updates: {
    endedAt?: string | Date;
    status?: string;
    totalTrades?: string;
    successfulTrades?: string;
    avgRealizedPnl?: string;
    metadata?: any;
  },
): Promise<void> {
  const database = getDb();
  const dbUpdates: Record<string, unknown> = { ...updates };
  if (updates.endedAt) {
    dbUpdates.endedAt =
      updates.endedAt instanceof Date
        ? updates.endedAt
        : new Date(updates.endedAt);
  }
  await database
    .update(schema.experimentRuns)
    .set(dbUpdates)
    .where(eq(schema.experimentRuns.id, experimentId));
}
