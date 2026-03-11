CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"usdc_balance" numeric(18, 8) NOT NULL,
	"positions_value" numeric(18, 8) NOT NULL,
	"total_value" numeric(18, 8) NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"condition_id" text,
	"slug" text,
	"question" text,
	"clob_token_ids" jsonb,
	"outcomes" jsonb,
	"window_type" text NOT NULL,
	"category" text NOT NULL,
	"end_date" text,
	"target_price" numeric(18, 2),
	"neg_risk" boolean DEFAULT false NOT NULL,
	"tick_size" text DEFAULT '0.01',
	"fees_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"initial_capital" numeric(18, 8) NOT NULL,
	"last_known_balance" numeric(18, 8) NOT NULL,
	"balance_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"polymarket_order_id" text,
	"polymarket_trade_ids" jsonb,
	"transaction_hashes" jsonb,
	"market_id" text,
	"condition_id" text,
	"token_id" text,
	"market_category" text,
	"window_type" text,
	"outcome_label" text,
	"side" text DEFAULT 'BUY' NOT NULL,
	"order_type" text DEFAULT 'FAK' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"trade_status" text,
	"entry_ts" timestamp,
	"entry_price" numeric(18, 8),
	"entry_shares" numeric(18, 8),
	"position_budget" numeric(18, 8),
	"actual_cost" numeric(18, 8),
	"entry_fees" numeric(18, 8) DEFAULT '0',
	"fill_status" text,
	"btc_price_at_entry" numeric(18, 2),
	"btc_target_price" numeric(18, 2),
	"btc_distance_usd" numeric(10, 4),
	"momentum_direction" text,
	"momentum_change_usd" numeric(10, 4),
	"exit_price" numeric(18, 8),
	"exit_ts" timestamp,
	"exit_outcome" text,
	"exit_order_id" text,
	"exit_fees" numeric(18, 8) DEFAULT '0',
	"realized_pnl" numeric(18, 8),
	"min_price_during_position" numeric(18, 8),
	"raw_order_response" jsonb,
	"raw_trade_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "al_level_idx" ON "audit_log" USING btree ("level");--> statement-breakpoint
CREATE INDEX "al_category_idx" ON "audit_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX "al_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bs_snapshot_at_idx" ON "balance_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "markets_slug_idx" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "markets_active_idx" ON "markets" USING btree ("active");--> statement-breakpoint
CREATE INDEX "markets_end_date_idx" ON "markets" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "markets_window_type_idx" ON "markets" USING btree ("window_type");--> statement-breakpoint
CREATE INDEX "trades_market_id_idx" ON "trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "trades_status_idx" ON "trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trades_entry_ts_idx" ON "trades" USING btree ("entry_ts");--> statement-breakpoint
CREATE INDEX "trades_poly_order_idx" ON "trades" USING btree ("polymarket_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_active_trade_per_market_token" ON "trades" USING btree ("market_id","token_id") WHERE status IN ('PENDING','MATCHED','CONFIRMED');