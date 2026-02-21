import {
  pgTable,
  index,
  text,
  jsonb,
  numeric,
  timestamp,
  uniqueIndex,
  unique,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const markets = pgTable(
  "markets",
  {
    id: text().primaryKey().notNull(),
    conditionId: text("condition_id"),
    slug: text(),
    question: text(),
    clobTokenIds: jsonb("clob_token_ids"),
    outcomes: jsonb(),
    takerBaseFee: numeric("taker_base_fee", { precision: 18, scale: 8 }),
    makerBaseFee: numeric("maker_base_fee", { precision: 18, scale: 8 }),
    category: text(), // e.g., "weather", "crypto-15m"
    marketFrequency: text("market_frequency"), // "15M", "daily", "other"
    endDate: timestamp("end_date", { mode: "string" }),
    active: boolean().default(true),
    metadata: jsonb(),
    lastFetchedAt: timestamp("last_fetched_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("markets_condition_id_idx").using(
      "btree",
      table.conditionId.asc().nullsLast().op("text_ops"),
    ),
    index("markets_slug_idx").using(
      "btree",
      table.slug.asc().nullsLast().op("text_ops"),
    ),
    index("markets_category_idx").using(
      "btree",
      table.category.asc().nullsLast().op("text_ops"),
    ),
    index("markets_active_idx").using(
      "btree",
      table.active.asc().nullsLast().op("bool_ops"),
    ),
  ],
);

export const orderbookSnapshots = pgTable(
  "orderbook_snapshots",
  {
    id: text().primaryKey().notNull(),
    tokenId: text("token_id").notNull(),
    marketId: text("market_id"),
    snapshotAt: timestamp("snapshot_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    raw: jsonb().notNull(),
  },
  (table) => [
    index("orderbook_snapshots_snapshot_at_idx").using(
      "btree",
      table.snapshotAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("orderbook_snapshots_token_id_idx").using(
      "btree",
      table.tokenId.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const simulatedTrades = pgTable(
  "simulated_trades",
  {
    id: text().primaryKey().notNull(),
    experimentId: text("experiment_id"),
    marketId: text("market_id"),
    tokenId: text("token_id"),
    marketCategory: text("market_category"), // "weather-daily" or "btc-15m"
    side: text().default("BUY").notNull(),
    entryTs: timestamp("entry_ts", { mode: "string" }).notNull(),
    entryPrice: numeric("entry_price", { precision: 18, scale: 8 }).notNull(),
    entryShares: numeric("entry_shares", { precision: 18, scale: 8 }).notNull(),
    entryOrderbookSnapshotId: text("entry_orderbook_snapshot_id"),
    simulatedUsdAmount: numeric("simulated_usd_amount", {
      precision: 18,
      scale: 8,
    })
      .default("1")
      .notNull(),
    entryFees: numeric("entry_fees", { precision: 18, scale: 8 })
      .default("0")
      .notNull(),
    entrySlippage: numeric("entry_slippage", {
      precision: 18,
      scale: 8,
    }).default("0"),
    entryLatencyMs: numeric("entry_latency_ms", { precision: 18, scale: 2 }),
    fillStatus: text("fill_status").default("FULL"), // FULL, PARTIAL, FAILED
    exitTs: timestamp("exit_ts", { mode: "string" }),
    exitPrice: numeric("exit_price", { precision: 18, scale: 8 }),
    exitShares: numeric("exit_shares", { precision: 18, scale: 8 }),
    exitFees: numeric("exit_fees", { precision: 18, scale: 8 }).default("0"),
    exitSlippage: numeric("exit_slippage", { precision: 18, scale: 8 }).default(
      "0",
    ),
    exitLatencyMs: numeric("exit_latency_ms", { precision: 18, scale: 2 }),
    realizedPnl: numeric("realized_pnl", { precision: 18, scale: 8 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 18, scale: 8 }),
    currentPrice: numeric("current_price", { precision: 18, scale: 8 }),
    status: text().default("OPEN").notNull(),
    strategyTrigger: text("strategy_trigger"), // e.g., "high_prob_near_end"
    raw: jsonb(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("simulated_trades_entry_ts_idx").using(
      "btree",
      table.entryTs.asc().nullsLast().op("timestamp_ops"),
    ),
    index("simulated_trades_market_id_idx").using(
      "btree",
      table.marketId.asc().nullsLast().op("text_ops"),
    ),
    index("simulated_trades_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("simulated_trades_experiment_id_idx").using(
      "btree",
      table.experimentId.asc().nullsLast().op("text_ops"),
    ),
    index("simulated_trades_market_category_idx").using(
      "btree",
      table.marketCategory.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text().primaryKey().notNull(),
    level: text().notNull(),
    category: text().notNull(),
    message: text().notNull(),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_category_idx").using(
      "btree",
      table.category.asc().nullsLast().op("text_ops"),
    ),
    index("audit_log_created_at_idx").using(
      "btree",
      table.createdAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("audit_log_level_idx").using(
      "btree",
      table.level.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const metrics = pgTable(
  "metrics",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    value: numeric({ precision: 18, scale: 8 }).notNull(),
    tags: jsonb(),
    timestamp: timestamp({ mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("metrics_name_idx").using(
      "btree",
      table.name.asc().nullsLast().op("text_ops"),
    ),
    index("metrics_timestamp_idx").using(
      "btree",
      table.timestamp.asc().nullsLast().op("timestamp_ops"),
    ),
  ],
);

export const rawActivity = pgTable(
  "raw_activity",
  {
    id: text().primaryKey().notNull(),
    activityId: text("activity_id"),
    walletAddress: text("wallet_address").notNull(),
    source: text().default("data-api").notNull(),
    fetchedAt: timestamp("fetched_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    raw: jsonb().notNull(),
  },
  (table) => [
    index("raw_activity_activity_id_idx").using(
      "btree",
      table.activityId.asc().nullsLast().op("text_ops"),
    ),
    index("raw_activity_fetched_at_idx").using(
      "btree",
      table.fetchedAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("raw_activity_wallet_address_idx").using(
      "btree",
      table.walletAddress.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const trackedUsers = pgTable(
  "tracked_users",
  {
    id: text().primaryKey().notNull(),
    walletAddress: text("wallet_address").notNull(),
    label: text(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("tracked_users_wallet_address_key").using(
      "btree",
      table.walletAddress.asc().nullsLast().op("text_ops"),
    ),
    unique("tracked_users_wallet_address_unique").on(table.walletAddress),
  ],
);

export const targetPositions = pgTable(
  "target_positions",
  {
    tokenId: text("token_id").primaryKey().notNull(),
    marketId: text("market_id"),
    trackedUserWallet: text("tracked_user_wallet").notNull(),
    totalSharesBought: numeric("total_shares_bought", {
      precision: 18,
      scale: 8,
    })
      .default("0")
      .notNull(),
    totalSharesSold: numeric("total_shares_sold", { precision: 18, scale: 8 })
      .default("0")
      .notNull(),
    currentShares: numeric("current_shares", { precision: 18, scale: 8 })
      .default("0")
      .notNull(),
    lastBuyTs: timestamp("last_buy_ts", { mode: "string" }),
    lastSellTs: timestamp("last_sell_ts", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("target_positions_wallet_idx").using(
      "btree",
      table.trackedUserWallet.asc().nullsLast().op("text_ops"),
    ),
    index("target_positions_market_idx").using(
      "btree",
      table.marketId.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const strategyTriggers = pgTable(
  "strategy_triggers",
  {
    id: text().primaryKey().notNull(),
    marketId: text("market_id").notNull(),
    tokenId: text("token_id").notNull(),
    triggerType: text("trigger_type").notNull(), // e.g., "high_prob_near_end"
    triggerPrice: numeric("trigger_price", { precision: 18, scale: 8 }),
    triggerTs: timestamp("trigger_ts", { mode: "string" }).notNull(),
    windowStart: timestamp("window_start", { mode: "string" }),
    windowEnd: timestamp("window_end", { mode: "string" }),
    executed: boolean().default(false).notNull(),
    simulatedTradeId: text("simulated_trade_id"),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("strategy_triggers_market_id_idx").using(
      "btree",
      table.marketId.asc().nullsLast().op("text_ops"),
    ),
    index("strategy_triggers_executed_idx").using(
      "btree",
      table.executed.asc().nullsLast().op("bool_ops"),
    ),
    index("strategy_triggers_trigger_ts_idx").using(
      "btree",
      table.triggerTs.asc().nullsLast().op("timestamp_ops"),
    ),
  ],
);

export const experimentRuns = pgTable(
  "experiment_runs",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    strategyVariant: text("strategy_variant"), // e.g., "taker_entry_taker_exit", "maker_entry_taker_exit"
    parameters: jsonb(), // strategy parameters
    startedAt: timestamp("started_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { mode: "string" }),
    status: text().default("RUNNING").notNull(), // RUNNING, COMPLETED, FAILED
    totalTrades: numeric("total_trades", { precision: 18, scale: 0 }).default(
      "0",
    ),
    successfulTrades: numeric("successful_trades", {
      precision: 18,
      scale: 0,
    }).default("0"),
    avgRealizedPnl: numeric("avg_realized_pnl", { precision: 18, scale: 8 }),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("experiment_runs_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("experiment_runs_started_at_idx").using(
      "btree",
      table.startedAt.asc().nullsLast().op("timestamp_ops"),
    ),
  ],
);
