import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  decimal,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================
// PenguinX Live Trading Schema (v4.0)
// All simulation code removed — real Polymarket execution only
// ============================================

/** Cached market metadata from Gamma API */
export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(),
    conditionId: text("condition_id"),
    slug: text("slug"),
    question: text("question"),
    clobTokenIds: jsonb("clob_token_ids"), // ["tokenUp","tokenDown"]
    outcomes: jsonb("outcomes"), // ["Up","Down"]
    windowType: text("window_type").notNull(), // 5M, 15M, 1H, 4H, 1D
    category: text("category").notNull(), // btc-5m, btc-15m, etc.
    endDate: text("end_date"),
    targetPrice: decimal("target_price", { precision: 18, scale: 2 }),
    negRisk: boolean("neg_risk").default(false).notNull(),
    tickSize: text("tick_size").default("0.01"),
    feesEnabled: boolean("fees_enabled").default(true).notNull(),
    active: boolean("active").default(true).notNull(),
    metadata: jsonb("metadata"),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index("markets_slug_idx").on(table.slug),
    activeIdx: index("markets_active_idx").on(table.active),
    endDateIdx: index("markets_end_date_idx").on(table.endDate),
    windowTypeIdx: index("markets_window_type_idx").on(table.windowType),
  }),
);

/** Portfolio state (single-row table) */
export const portfolio = pgTable("portfolio", {
  id: integer("id").primaryKey().default(1),
  initialCapital: decimal("initial_capital", {
    precision: 18,
    scale: 8,
  }).notNull(),
  /** Cached USDC.e balance from Polymarket — updated on trades and periodic sync */
  lastKnownBalance: decimal("last_known_balance", {
    precision: 18,
    scale: 8,
  }).notNull(),
  balanceUpdatedAt: timestamp("balance_updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Real trades executed on Polymarket */
export const trades = pgTable(
  "trades",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Polymarket references
    polymarketOrderId: text("polymarket_order_id"),
    polymarketTradeIds: jsonb("polymarket_trade_ids"), // string[]
    transactionHashes: jsonb("transaction_hashes"), // string[]
    // Market references
    marketId: text("market_id"),
    conditionId: text("condition_id"),
    tokenId: text("token_id"),
    marketCategory: text("market_category"),
    windowType: text("window_type"),
    outcomeLabel: text("outcome_label"), // "Up" or "Down"
    side: text("side").default("BUY").notNull(),
    orderType: text("order_type").default("FAK").notNull(),
    // Order lifecycle: PENDING → MATCHED → CONFIRMED → SETTLED / FAILED
    status: text("status").default("PENDING").notNull(),
    /** Polymarket trade status: MATCHED | MINED | CONFIRMED | RETRYING | FAILED */
    tradeStatus: text("trade_status"),
    // Entry (from Polymarket order response / trade confirmation)
    entryTs: timestamp("entry_ts"),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }),
    entryShares: decimal("entry_shares", { precision: 18, scale: 8 }),
    positionBudget: decimal("position_budget", { precision: 18, scale: 8 }),
    actualCost: decimal("actual_cost", { precision: 18, scale: 8 }),
    entryFees: decimal("entry_fees", { precision: 18, scale: 8 }).default("0"),
    fillStatus: text("fill_status"), // FULL | PARTIAL
    // BTC context at entry
    btcPriceAtEntry: decimal("btc_price_at_entry", { precision: 18, scale: 2 }),
    btcTargetPrice: decimal("btc_target_price", { precision: 18, scale: 2 }),
    btcDistanceUsd: decimal("btc_distance_usd", { precision: 10, scale: 4 }),
    // Momentum context at entry
    momentumDirection: text("momentum_direction"),
    momentumChangeUsd: decimal("momentum_change_usd", {
      precision: 10,
      scale: 4,
    }),
    // Exit / resolution
    exitPrice: decimal("exit_price", { precision: 18, scale: 8 }),
    exitTs: timestamp("exit_ts"),
    exitOutcome: text("exit_outcome"), // WIN | LOSS | STOP_LOSS
    exitOrderId: text("exit_order_id"), // polymarket order ID for stop-loss sell
    exitFees: decimal("exit_fees", { precision: 18, scale: 8 }).default("0"),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }),
    /** Lowest bestBid observed while position was open */
    minPriceDuringPosition: decimal("min_price_during_position", {
      precision: 18,
      scale: 8,
    }),
    // Raw Polymarket data for audit
    rawOrderResponse: jsonb("raw_order_response"),
    rawTradeData: jsonb("raw_trade_data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    marketIdIdx: index("trades_market_id_idx").on(table.marketId),
    statusIdx: index("trades_status_idx").on(table.status),
    entryTsIdx: index("trades_entry_ts_idx").on(table.entryTs),
    polyOrderIdx: index("trades_poly_order_idx").on(table.polymarketOrderId),
    // Prevent duplicate active trades per market+token
    uqActiveTradePerToken: uniqueIndex("uq_active_trade_per_market_token")
      .on(table.marketId, table.tokenId)
      .where(sql`status IN ('PENDING','MATCHED','CONFIRMED')`),
  }),
);

/** Periodic balance snapshots for equity curve tracking */
export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    usdcBalance: decimal("usdc_balance", { precision: 18, scale: 8 }).notNull(),
    positionsValue: decimal("positions_value", {
      precision: 18,
      scale: 8,
    }).notNull(),
    totalValue: decimal("total_value", { precision: 18, scale: 8 }).notNull(),
    snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  },
  (table) => ({
    snapshotAtIdx: index("bs_snapshot_at_idx").on(table.snapshotAt),
  }),
);

/** Audit log for errors, rate limits, system events */
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
    levelIdx: index("al_level_idx").on(table.level),
    categoryIdx: index("al_category_idx").on(table.category),
    createdAtIdx: index("al_created_at_idx").on(table.createdAt),
  }),
);
