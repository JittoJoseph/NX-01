DROP INDEX "markets_category_idx";--> statement-breakpoint
DROP INDEX "simulated_trades_market_category_idx";--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "category" SET DEFAULT 'btc-15m';--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "market_frequency" SET DEFAULT '15M';--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "market_frequency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "simulated_trades" ALTER COLUMN "market_category" SET DEFAULT 'btc-15m';--> statement-breakpoint
ALTER TABLE "simulated_trades" ADD COLUMN "outcome_label" text;--> statement-breakpoint
ALTER TABLE "simulated_trades" ADD COLUMN "claim_at" timestamp;--> statement-breakpoint
ALTER TABLE "simulated_trades" ADD COLUMN "claim_outcome" text;--> statement-breakpoint
ALTER TABLE "simulated_trades" ADD COLUMN "claim_price" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "simulated_trades" ADD COLUMN "claim_ts" timestamp;--> statement-breakpoint
CREATE INDEX "markets_end_date_idx" ON "markets" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "simulated_trades_claim_at_idx" ON "simulated_trades" USING btree ("claim_at");--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "exit_ts";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "exit_price";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "exit_shares";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "exit_fees";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "exit_slippage";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "exit_latency_ms";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "unrealized_pnl";--> statement-breakpoint
ALTER TABLE "simulated_trades" DROP COLUMN "current_price";