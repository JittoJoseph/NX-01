import type { InferSelectModel } from "drizzle-orm";
import type {
  trades,
  markets,
  auditLogs,
  portfolio,
  balanceSnapshots,
} from "../db/schema.js";

export type Trade = InferSelectModel<typeof trades>;
export type Market = InferSelectModel<typeof markets>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type Portfolio = InferSelectModel<typeof portfolio>;
export type BalanceSnapshot = InferSelectModel<typeof balanceSnapshots>;
