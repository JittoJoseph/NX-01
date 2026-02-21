import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  decimal,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// BTC 15-Minute Market Simulation Schema
// ============================================

// Cached market metadata from Gamma API
export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(), // Gamma market id
    conditionId: text("condition_id"),
    slug: text("slug"),
    question: text("question"),
    clobTokenIds: jsonb("clob_token_ids"), // Array of token ids
    outcomes: jsonb("outcomes"), // Array of outcome names ["Up","Down"]
    takerBaseFee: decimal("taker_base_fee", { precision: 18, scale: 8 }),
    makerBaseFee: decimal("maker_base_fee", { precision: 18, scale: 8 }),
    category: text("category").default("btc-15m").notNull(),
    marketFrequency: text("market_frequency").default("15M").notNull(),
    endDate: text("end_date"),
    active: boolean("active").default(true).notNull(),
    metadata: jsonb("metadata"),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index("markets_slug_idx").on(table.slug),
    conditionIdIdx: index("markets_condition_id_idx").on(table.conditionId),
    activeIdx: index("markets_active_idx").on(table.active),
    endDateIdx: index("markets_end_date_idx").on(table.endDate),
  }),
);

// Orderbook snapshots recorded at trade simulation time
export const orderbookSnapshots = pgTable(
  "orderbook_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tokenId: text("token_id").notNull(),
    marketId: text("market_id"),
    snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
    raw: jsonb("raw").notNull(),
  },
  (table) => ({
    tokenIdIdx: index("orderbook_snapshots_token_id_idx").on(table.tokenId),
    snapshotAtIdx: index("orderbook_snapshots_snapshot_at_idx").on(
      table.snapshotAt,
    ),
  }),
);

// Simulated trades from BTC 15M strategy
export const simulatedTrades = pgTable(
  "simulated_trades",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    experimentId: text("experiment_id"),
    marketId: text("market_id"),
    tokenId: text("token_id"),
    marketCategory: text("market_category").default("btc-15m"),
    side: text("side").default("BUY").notNull(), // BUY
    outcomeLabel: text("outcome_label"), // "Up" or "Down"
    entryTs: timestamp("entry_ts").notNull(),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
    entryShares: decimal("entry_shares", { precision: 18, scale: 8 }).notNull(),
    entryOrderbookSnapshotId: text("entry_orderbook_snapshot_id"),
    simulatedUsdAmount: decimal("simulated_usd_amount", {
      precision: 18,
      scale: 8,
    })
      .default("1")
      .notNull(),
    entryFees: decimal("entry_fees", { precision: 18, scale: 8 }).default("0"),
    entrySlippage: decimal("entry_slippage", {
      precision: 18,
      scale: 8,
    }).default("0"),
    entryLatencyMs: text("entry_latency_ms"),
    fillStatus: text("fill_status").default("FULL"), // FULL | PARTIAL | FAILED
    // Exit/resolution fields
    claimAt: timestamp("claim_at"), // Legacy column name — when the position was scheduled to close
    claimOutcome: text("claim_outcome"), // WIN | LOSS | STOP_LOSS
    claimPrice: decimal("claim_price", { precision: 18, scale: 8 }), // Exit price (1.00 for win, 0.00 for loss, or stop-loss price)
    claimTs: timestamp("claim_ts"), // When position was actually closed
    // P&L
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }),
    // Status: OPEN | CLOSED
    status: text("status").default("OPEN").notNull(),
    strategyTrigger: text("strategy_trigger"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    marketIdIdx: index("simulated_trades_market_id_idx").on(table.marketId),
    statusIdx: index("simulated_trades_status_idx").on(table.status),
    entryTsIdx: index("simulated_trades_entry_ts_idx").on(table.entryTs),
    experimentIdIdx: index("simulated_trades_experiment_id_idx").on(
      table.experimentId,
    ),
    claimAtIdx: index("simulated_trades_claim_at_idx").on(table.claimAt),
  }),
);

// Audit log for errors, rate limits, and system events
export const auditLogs = pgTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    level: text("level").notNull(),
    category: text("category").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    levelIdx: index("audit_log_level_idx").on(table.level),
    categoryIdx: index("audit_log_category_idx").on(table.category),
    createdAtIdx: index("audit_log_created_at_idx").on(table.createdAt),
  }),
);

// Lightweight metrics
export const metrics = pgTable(
  "metrics",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    value: decimal("value", { precision: 18, scale: 8 }).notNull(),
    tags: jsonb("tags"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("metrics_name_idx").on(table.name),
    timestampIdx: index("metrics_timestamp_idx").on(table.timestamp),
  }),
);

// Strategy triggers - Records when strategy conditions are met
export const strategyTriggers = pgTable(
  "strategy_triggers",
  {
    id: text("id").primaryKey().notNull(),
    marketId: text("market_id").notNull(),
    tokenId: text("token_id").notNull(),
    triggerType: text("trigger_type").notNull(),
    triggerPrice: decimal("trigger_price", { precision: 18, scale: 8 }),
    triggerTs: timestamp("trigger_ts").notNull(),
    windowStart: timestamp("window_start"),
    windowEnd: timestamp("window_end"),
    executed: boolean("executed").default(false).notNull(),
    simulatedTradeId: text("simulated_trade_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    marketIdIdx: index("strategy_triggers_market_id_idx").on(table.marketId),
    executedIdx: index("strategy_triggers_executed_idx").on(table.executed),
    triggerTsIdx: index("strategy_triggers_trigger_ts_idx").on(table.triggerTs),
  }),
);

// Experiment runs - Tracks live simulation sessions
export const experimentRuns = pgTable(
  "experiment_runs",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    strategyVariant: text("strategy_variant"),
    parameters: jsonb("parameters"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    status: text("status").default("RUNNING").notNull(),
    totalTrades: decimal("total_trades", { precision: 18, scale: 0 }).default(
      "0",
    ),
    successfulTrades: decimal("successful_trades", {
      precision: 18,
      scale: 0,
    }).default("0"),
    avgRealizedPnl: decimal("avg_realized_pnl", { precision: 18, scale: 8 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("experiment_runs_status_idx").on(table.status),
    startedAtIdx: index("experiment_runs_started_at_idx").on(table.startedAt),
  }),
);
