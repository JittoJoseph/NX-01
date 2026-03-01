import type { InferSelectModel } from "drizzle-orm";
import type {
  simulatedTrades,
  markets,
  auditLogs,
  portfolio,
} from "../db/schema.js";

export type SimulatedTrade = InferSelectModel<typeof simulatedTrades>;
export type Market = InferSelectModel<typeof markets>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type Portfolio = InferSelectModel<typeof portfolio>;
