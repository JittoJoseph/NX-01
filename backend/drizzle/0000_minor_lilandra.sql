CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"strategy_variant" text,
	"parameters" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"total_trades" numeric(18, 0) DEFAULT '0',
	"successful_trades" numeric(18, 0) DEFAULT '0',
	"avg_realized_pnl" numeric(18, 8),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"condition_id" text,
	"slug" text,
	"question" text,
	"clob_token_ids" jsonb,
	"outcomes" jsonb,
	"taker_base_fee" numeric(18, 8),
	"maker_base_fee" numeric(18, 8),
	"category" text,
	"market_frequency" text,
	"end_date" text,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"value" numeric(18, 8) NOT NULL,
	"tags" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orderbook_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"market_id" text,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulated_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text,
	"market_id" text,
	"token_id" text,
	"market_category" text,
	"side" text DEFAULT 'BUY' NOT NULL,
	"entry_ts" timestamp NOT NULL,
	"entry_price" numeric(18, 8) NOT NULL,
	"entry_shares" numeric(18, 8) NOT NULL,
	"entry_orderbook_snapshot_id" text,
	"simulated_usd_amount" numeric(18, 8) DEFAULT '1' NOT NULL,
	"entry_fees" numeric(18, 8) DEFAULT '0',
	"entry_slippage" numeric(18, 8) DEFAULT '0',
	"entry_latency_ms" text,
	"fill_status" text DEFAULT 'FULL',
	"exit_ts" timestamp,
	"exit_price" numeric(18, 8),
	"exit_shares" numeric(18, 8),
	"exit_fees" numeric(18, 8) DEFAULT '0',
	"exit_slippage" numeric(18, 8) DEFAULT '0',
	"exit_latency_ms" text,
	"realized_pnl" numeric(18, 8),
	"unrealized_pnl" numeric(18, 8),
	"current_price" numeric(18, 8),
	"status" text DEFAULT 'OPEN' NOT NULL,
	"strategy_trigger" text,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"token_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_price" numeric(18, 8),
	"trigger_ts" timestamp NOT NULL,
	"window_start" timestamp,
	"window_end" timestamp,
	"executed" boolean DEFAULT false NOT NULL,
	"simulated_trade_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_level_idx" ON "audit_log" USING btree ("level");--> statement-breakpoint
CREATE INDEX "audit_log_category_idx" ON "audit_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "experiment_runs_status_idx" ON "experiment_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "experiment_runs_started_at_idx" ON "experiment_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "markets_slug_idx" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "markets_condition_id_idx" ON "markets" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "markets_category_idx" ON "markets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "markets_active_idx" ON "markets" USING btree ("active");--> statement-breakpoint
CREATE INDEX "metrics_name_idx" ON "metrics" USING btree ("name");--> statement-breakpoint
CREATE INDEX "metrics_timestamp_idx" ON "metrics" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "orderbook_snapshots_token_id_idx" ON "orderbook_snapshots" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "orderbook_snapshots_snapshot_at_idx" ON "orderbook_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "simulated_trades_market_id_idx" ON "simulated_trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "simulated_trades_status_idx" ON "simulated_trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "simulated_trades_entry_ts_idx" ON "simulated_trades" USING btree ("entry_ts");--> statement-breakpoint
CREATE INDEX "simulated_trades_experiment_id_idx" ON "simulated_trades" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "simulated_trades_market_category_idx" ON "simulated_trades" USING btree ("market_category");--> statement-breakpoint
CREATE INDEX "strategy_triggers_market_id_idx" ON "strategy_triggers" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "strategy_triggers_executed_idx" ON "strategy_triggers" USING btree ("executed");--> statement-breakpoint
CREATE INDEX "strategy_triggers_trigger_ts_idx" ON "strategy_triggers" USING btree ("trigger_ts");