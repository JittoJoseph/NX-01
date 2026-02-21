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
	"window_type" text NOT NULL,
	"category" text NOT NULL,
	"end_date" text,
	"target_price" numeric(18, 2),
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulated_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text,
	"market_id" text,
	"token_id" text,
	"market_category" text,
	"window_type" text,
	"side" text DEFAULT 'BUY' NOT NULL,
	"outcome_label" text,
	"order_type" text DEFAULT 'LIMIT_GTC' NOT NULL,
	"entry_ts" timestamp NOT NULL,
	"entry_price" numeric(18, 8) NOT NULL,
	"entry_shares" numeric(18, 8) NOT NULL,
	"simulated_usd_amount" numeric(18, 8) DEFAULT '1' NOT NULL,
	"entry_fees" numeric(18, 8) DEFAULT '0',
	"fee_rate_bps" integer,
	"fill_status" text DEFAULT 'FULL',
	"btc_price_at_entry" numeric(18, 2),
	"btc_target_price" numeric(18, 2),
	"btc_distance_percent" numeric(10, 4),
	"exit_price" numeric(18, 8),
	"exit_ts" timestamp,
	"exit_outcome" text,
	"realized_pnl" numeric(18, 8),
	"status" text DEFAULT 'OPEN' NOT NULL,
	"strategy_trigger" text,
	"orderbook_snapshot" jsonb,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "al_level_idx" ON "audit_log" USING btree ("level");--> statement-breakpoint
CREATE INDEX "al_category_idx" ON "audit_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX "al_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "er_status_idx" ON "experiment_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "er_started_at_idx" ON "experiment_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "markets_slug_idx" ON "markets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "markets_active_idx" ON "markets" USING btree ("active");--> statement-breakpoint
CREATE INDEX "markets_end_date_idx" ON "markets" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "markets_window_type_idx" ON "markets" USING btree ("window_type");--> statement-breakpoint
CREATE INDEX "st_market_id_idx" ON "simulated_trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "st_status_idx" ON "simulated_trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "st_entry_ts_idx" ON "simulated_trades" USING btree ("entry_ts");--> statement-breakpoint
CREATE INDEX "st_experiment_id_idx" ON "simulated_trades" USING btree ("experiment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_open_trade_per_market_token" ON "simulated_trades" USING btree ("market_id","token_id") WHERE status = 'OPEN';