/**
 * test-oracle-filter.ts
 *
 * Replays all historical losses against the new oracle confirmation logic
 * and simulates what the PnL would have been if the filter was active.
 *
 * Usage: npx tsx scripts/test-oracle-filter.ts
 */

const MIN_ORACLE_LEAD_USD = 50; // matches config default

interface TradeRecord {
  id: string;
  outcomeLabel: string;
  entryPrice: number;
  btcPriceAtEntry: number;
  btcTargetPrice: number;
  btcDistanceUsd: number;
  exitOutcome: "WIN" | "LOSS";
  realizedPnl: number;
  entryTs: string;
}

// All 4 historical losses from Feb 27 run
const historicalLosses: TradeRecord[] = [
  {
    id: "93ae2489",
    entryTs: "2026-02-27T15:19:06Z",
    outcomeLabel: "Down",
    entryPrice: 0.95,
    btcPriceAtEntry: 65935.84,
    btcTargetPrice: 66042.27,
    btcDistanceUsd: 106.43,
    exitOutcome: "LOSS",
    realizedPnl: -0.999969,
  },
  {
    id: "2ab373c4",
    entryTs: "2026-02-27T14:28:47Z",
    outcomeLabel: "Down",
    entryPrice: 0.95,
    btcPriceAtEntry: 66003.21,
    btcTargetPrice: 66089.50,
    btcDistanceUsd: 86.29,
    exitOutcome: "LOSS",
    realizedPnl: -0.999969,
  },
  {
    id: "79b49e53",
    entryTs: "2026-02-27T13:29:57Z",
    outcomeLabel: "Down",
    entryPrice: 0.71,
    btcPriceAtEntry: 65934.13,
    btcTargetPrice: 65998.58,
    btcDistanceUsd: 64.45,
    exitOutcome: "LOSS",
    realizedPnl: -0.999990,
  },
  {
    id: "36724232",
    entryTs: "2026-02-27T13:14:16Z",
    outcomeLabel: "Down",
    entryPrice: 0.98,
    btcPriceAtEntry: 65980.00,
    btcTargetPrice: 66031.53,
    btcDistanceUsd: 51.53,
    exitOutcome: "LOSS",
    realizedPnl: -0.999998,
  },
];

// All historical wins from the 100-trade dump to check for false negatives
const TOTAL_WINS = 76;
const TOTAL_WIN_PNL = 2.812; // approximate sum of win PnLs from performance API

function checkOracleFilter(
  outcomeLabel: string,
  btcPriceAtEntry: number,
  btcTargetPrice: number,
  minLeadUsd: number,
): { pass: boolean; oracleLeadUsd: number; reason: string } {
  const oracleLeadUsd = btcPriceAtEntry - btcTargetPrice;

  if (outcomeLabel === "Up" && oracleLeadUsd < minLeadUsd) {
    return {
      pass: false,
      oracleLeadUsd,
      reason: `UP blocked: BTC +${oracleLeadUsd.toFixed(2)} < +${minLeadUsd} required`,
    };
  }
  if (outcomeLabel === "Down" && oracleLeadUsd > -minLeadUsd) {
    return {
      pass: false,
      oracleLeadUsd,
      reason: `DOWN blocked: BTC ${oracleLeadUsd.toFixed(2)} > -${minLeadUsd} threshold`,
    };
  }
  return {
    pass: true,
    oracleLeadUsd,
    reason: `Oracle confirmed: BTC ${oracleLeadUsd >= 0 ? "+" : ""}${oracleLeadUsd.toFixed(2)} USD`,
  };
}

console.log("\n======================================================");
console.log("  Oracle Confirmation Filter — Historical Loss Replay");
console.log("======================================================\n");

console.log(`  minOracleLeadUsd = $${MIN_ORACLE_LEAD_USD}\n`);
console.log(
  `  ${"Trade ID".padEnd(12)} ${"Outcome".padEnd(6)} ${"Entry".padEnd(7)} ${"BTC Entry".padEnd(11)} ${"BTC Target".padEnd(11)} ${"Lead USD".padEnd(10)} ${"Filter".padEnd(10)} ${"Actual"}`,
);
console.log("  " + "─".repeat(80));

let savedPnl = 0;
let blockedCount = 0;

for (const trade of historicalLosses) {
  const result = checkOracleFilter(
    trade.outcomeLabel,
    trade.btcPriceAtEntry,
    trade.btcTargetPrice,
    MIN_ORACLE_LEAD_USD,
  );

  const filterStatus = result.pass ? "✅ ALLOW" : "🚫 BLOCK";
  const actualResult = trade.exitOutcome;

  if (!result.pass) {
    blockedCount++;
    savedPnl += Math.abs(trade.realizedPnl);
  }

  console.log(
    `  ${trade.id.substring(0, 8).padEnd(12)} ${trade.outcomeLabel.padEnd(6)} ${trade.entryPrice.toFixed(2).padEnd(7)} ` +
      `$${trade.btcPriceAtEntry.toFixed(2).padEnd(10)} $${trade.btcTargetPrice.toFixed(2).padEnd(10)} ` +
      `${result.oracleLeadUsd >= 0 ? "+" : ""}${result.oracleLeadUsd.toFixed(2).padEnd(10)} ${filterStatus.padEnd(10)} ${actualResult}`,
  );
  console.log(`    → ${result.reason}`);
}

console.log("\n  " + "─".repeat(80));
console.log(`\n  Losses that would have been BLOCKED: ${blockedCount} / ${historicalLosses.length}`);
console.log(`  Saved PnL from blocked losses: $${savedPnl.toFixed(4)}`);
console.log(
  `\n  Current net PnL (ALL period): -$1.19`,
);
console.log(
  `  Simulated net PnL with oracle: -$${(1.19 - savedPnl).toFixed(4)} (${savedPnl > 1.19 ? "POSITIVE" : "LESS NEGATIVE"})`,
);

console.log("\n  ── Win false-negative analysis ──────────────────────────────────────");
console.log(
  `  Note: Wins data not available in this script — check live system logs for`,
);
console.log(
  `  "Skipping: BTC has not cleared window-start by enough" messages after deploy.`,
);
console.log(
  `  If oracle filter is blocking wins, lower MIN_ORACLE_LEAD_USD in .env.`,
);

console.log("\n  ── Config recommendation ────────────────────────────────────────────");
console.log(`  MIN_ORACLE_LEAD_USD=50   (current default)`);
console.log(`  MIN_BTC_DISTANCE_USD=50  (unchanged, keep for absolute distance guard)`);
console.log(
  `\n  The oracle and distance checks are complementary:\n` +
    `    - btcDistanceUsd: absolute distance (prevents tiny-range markets)\n` +
    `    - oracleLeadUsd: directional distance (prevents wrong-side entries)\n`,
);
