import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import * as schema from "./schema.js";
import { eq, and, lte } from "drizzle-orm";

const logger = createModuleLogger("database");

// Create the connection (Supabase PostgreSQL)
let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    const config = getConfig();

    // Create postgres client — lower pool for resource optimization
    client = postgres(config.db.url, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    });

    // Create drizzle instance
    db = drizzle(client, { schema, logger: false });

    logger.info("Drizzle database client initialized (Supabase)");
  }

  return db;
}

export async function connectDatabase(): Promise<void> {
  const db = getDb();
  // Test the connection
  await db.execute("SELECT 1");
  logger.info("Database connection established (Supabase)");
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
    takerBaseFee?: number;
    makerBaseFee?: number;
    endDate?: string | null;
    active?: boolean;
    metadata?: unknown;
  },
) {
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, id))
    .limit(1);

  const record = {
    clobTokenIds: data.clobTokenIds as any,
    outcomes: data.outcomes as any,
    takerBaseFee: data.takerBaseFee?.toString(),
    makerBaseFee: data.makerBaseFee?.toString(),
    category: "btc-15m",
    marketFrequency: "15M",
    endDate: data.endDate || null,
    active: data.active ?? true,
    metadata: data.metadata as any,
    conditionId: data.conditionId || null,
    slug: data.slug || null,
    question: data.question || null,
  };

  if (existing.length > 0) {
    const result = await db
      .update(schema.markets)
      .set({
        ...record,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.markets.id, id))
      .returning();
    return result[0];
  } else {
    const result = await db
      .insert(schema.markets)
      .values({ id, ...record })
      .returning();
    return result[0];
  }
}

export async function saveOrderbookSnapshot(
  id: string,
  tokenId: string,
  raw: unknown,
) {
  const db = getDb();
  const result = await db
    .insert(schema.orderbookSnapshots)
    .values({ id, tokenId, raw: raw as any })
    .returning();
  return result[0];
}

// ============================================
// Simulated trade helpers
// ============================================

export async function createSimulatedTrade(data: {
  experimentId?: string;
  marketId?: string;
  tokenId: string;
  outcomeLabel?: string;
  entryTs: Date;
  entryPrice: string;
  entryShares: string;
  entryOrderbookSnapshotId?: string;
  simulatedUsdAmount?: number;
  entryFees?: string;
  entrySlippage?: string;
  entryLatencyMs?: string;
  fillStatus?: string;
  strategyTrigger?: string;
  raw?: unknown;
}) {
  const db = getDb();
  const result = await db
    .insert(schema.simulatedTrades)
    .values({
      experimentId: data.experimentId || null,
      marketId: data.marketId || null,
      tokenId: data.tokenId,
      marketCategory: "btc-15m",
      outcomeLabel: data.outcomeLabel || null,
      side: "BUY",
      entryTs: data.entryTs,
      entryPrice: data.entryPrice,
      entryShares: data.entryShares,
      entryOrderbookSnapshotId: data.entryOrderbookSnapshotId || null,
      simulatedUsdAmount: data.simulatedUsdAmount?.toString() ?? "1",
      entryFees: data.entryFees ?? "0",
      entrySlippage: data.entrySlippage ?? "0",
      entryLatencyMs: data.entryLatencyMs || null,
      fillStatus: data.fillStatus ?? "FULL",
      strategyTrigger: data.strategyTrigger || null,
      raw: data.raw as any,
      status: "OPEN",
    })
    .returning();
  return result[0];
}

/**
 * Close a trade when its market window ends or stop-loss is triggered.
 * Transitions OPEN → CLOSED.
 *
 * @param id - Trade ID
 * @param outcome - WIN, LOSS, or STOP_LOSS
 * @param realizedPnl - Net profit/loss as string
 * @param exitPrice - Optional exit price (defaults based on outcome: WIN=1, LOSS=0)
 */
export async function resolveTradeImmediately(
  id: string,
  outcome: "WIN" | "LOSS" | "STOP_LOSS",
  realizedPnl: string,
  exitPrice?: string,
) {
  const db = getDb();

  // Default exit price based on outcome
  const finalExitPrice = exitPrice ?? (outcome === "WIN" ? "1" : "0");

  const result = await db
    .update(schema.simulatedTrades)
    .set({
      claimOutcome: outcome,
      claimPrice: finalExitPrice,
      claimTs: new Date(),
      realizedPnl,
      status: "CLOSED",
      updatedAt: new Date(),
    })
    .where(eq(schema.simulatedTrades.id, id))
    .returning();
  return result[0];
}

// ============================================
// Audit / metrics
// ============================================

export async function logAudit(
  level: "info" | "warn" | "error",
  category: string,
  message: string,
  metadata?: unknown,
) {
  const db = getDb();
  try {
    await db.insert(schema.auditLogs).values({
      level,
      category,
      message,
      metadata: metadata as any,
    });
  } catch (e) {
    // Don't crash the system for audit log failures
    logger.error({ error: e }, "Failed to write audit log");
  }
}

export async function recordMetric(
  name: string,
  value: number,
  tags?: unknown,
) {
  const db = getDb();
  try {
    await db.insert(schema.metrics).values({
      name,
      value: value.toString(),
      tags: tags as any,
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to record metric");
  }
}

// ============================================
// Strategy triggers / experiments
// ============================================

export async function createStrategyTrigger(data: {
  id: string;
  marketId: string;
  tokenId: string;
  triggerType: string;
  triggerPrice: string;
  triggerTs: string | Date;
  windowStart?: string | Date | null;
  windowEnd?: string | Date | null;
  executed?: boolean;
  simulatedTradeId?: string | null;
  metadata?: any;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.strategyTriggers).values({
    id: data.id,
    marketId: data.marketId,
    tokenId: data.tokenId,
    triggerType: data.triggerType,
    triggerPrice: data.triggerPrice,
    triggerTs:
      data.triggerTs instanceof Date
        ? data.triggerTs
        : new Date(data.triggerTs),
    windowStart: data.windowStart
      ? data.windowStart instanceof Date
        ? data.windowStart
        : new Date(data.windowStart)
      : null,
    windowEnd: data.windowEnd
      ? data.windowEnd instanceof Date
        ? data.windowEnd
        : new Date(data.windowEnd)
      : null,
    executed: data.executed ?? false,
    simulatedTradeId: data.simulatedTradeId || null,
    metadata: data.metadata || null,
  });
}

export async function createExperimentRun(data: {
  id: string;
  name: string;
  description?: string | null;
  strategyVariant?: string | null;
  parameters?: any;
  status?: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.experimentRuns).values({
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
  const db = getDb();
  const dbUpdates: Record<string, unknown> = { ...updates };
  if (updates.endedAt) {
    dbUpdates.endedAt =
      updates.endedAt instanceof Date
        ? updates.endedAt
        : new Date(updates.endedAt);
  }
  await db
    .update(schema.experimentRuns)
    .set(dbUpdates)
    .where(eq(schema.experimentRuns.id, experimentId));
}

export async function getActiveMarkets(): Promise<
  Array<typeof schema.markets.$inferSelect>
> {
  const db = getDb();
  return db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.active, true));
}
