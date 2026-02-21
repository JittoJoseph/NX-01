-- Prevent duplicate open/awaiting trades for the same market + token.
-- This is a partial unique index: only enforced when status is OPEN or AWAITING_CLAIM.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_open_trade_per_market_token"
  ON "simulated_trades" ("market_id", "token_id")
  WHERE "status" IN ('OPEN', 'AWAITING_CLAIM');
