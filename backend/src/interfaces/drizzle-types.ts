import type { InferSelectModel } from "drizzle-orm";
import type {
  simulatedTrades,
  markets,
  auditLogs,
  experimentRuns,
} from "../db/schema.js";

export type SimulatedTrade = InferSelectModel<typeof simulatedTrades>;
export type Market = InferSelectModel<typeof markets>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type ExperimentRun = InferSelectModel<typeof experimentRuns>;
