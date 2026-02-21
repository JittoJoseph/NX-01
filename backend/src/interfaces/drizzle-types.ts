import type { InferSelectModel } from "drizzle-orm";
import type {
  simulatedTrades,
  markets,
  orderbookSnapshots,
  auditLogs,
  metrics,
  strategyTriggers,
  experimentRuns,
} from "../db/schema.js";

/**
 * Drizzle-based type definitions for the market-driven simulation system.
 */

export type SimulatedTrade = InferSelectModel<typeof simulatedTrades>;
export type Market = InferSelectModel<typeof markets>;
export type OrderbookSnapshot = InferSelectModel<typeof orderbookSnapshots>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type Metric = InferSelectModel<typeof metrics>;
export type StrategyTrigger = InferSelectModel<typeof strategyTriggers>;
export type ExperimentRun = InferSelectModel<typeof experimentRuns>;
