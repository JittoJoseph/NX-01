import { describe, it, expect } from "vitest";
import {
  simulateLimitBuy,
  simulateLimitSell,
  calculateWinProfit,
  calculateLossAmount,
  calculateEarlyExitPnl,
  type ExecutionResult,
  type SellExecutionResult,
} from "../services/execution-simulator.js";
import type { Orderbook } from "../types/index.js";

/**
 * Helper to build a mock orderbook for testing.
 */
function makeOrderbook(
  asks: Array<{ price: string; size: string }>,
  bids: Array<{ price: string; size: string }>,
  tickSize = "0.01",
): Orderbook {
  return {
    market: "0xtest",
    asset_id: "test-token-id",
    timestamp: String(Date.now()),
    hash: "0xhash",
    bids,
    asks,
    tick_size: tickSize,
    neg_risk: false,
  };
}

// ============================================
// simulateLimitBuy
// ============================================

describe("simulateLimitBuy", () => {
  it("fills at all ask levels at or below the limit price", () => {
    const orderbook = makeOrderbook(
      [
        { price: "0.93", size: "100" },
        { price: "0.95", size: "200" },
        { price: "0.97", size: "500" },
      ],
      [{ price: "0.92", size: "100" }],
    );

    // Limit at 0.95 — should fill 0.93 and 0.95, skip 0.97
    const result = simulateLimitBuy(orderbook, 1000, 0.95, 25);

    expect(result.fillDetails.length).toBe(2);
    expect(result.fillDetails[0]!.price).toBe(0.93);
    expect(result.fillDetails[1]!.price).toBe(0.95);
    // Should NOT include the 0.97 level
    expect(result.fillDetails.every((d) => d.price <= 0.95)).toBe(true);
    expect(result.totalShares).toBeGreaterThan(0);
  });

  it("skips all asks above the limit price", () => {
    const orderbook = makeOrderbook(
      [
        { price: "0.96", size: "100" },
        { price: "0.97", size: "200" },
      ],
      [{ price: "0.94", size: "100" }],
    );

    // Limit at 0.95 — all asks are above → no fill
    const result = simulateLimitBuy(orderbook, 1, 0.95, 25);

    expect(result.totalShares).toBe(0);
    expect(result.fillDetails.length).toBe(0);
  });

  it("respects the USD budget", () => {
    const orderbook = makeOrderbook(
      [{ price: "0.50", size: "1000" }], // Cheap shares, lots of liquidity
      [],
    );

    // Only $1 budget at $0.50/share → should buy ~2 shares
    const result = simulateLimitBuy(orderbook, 1, 0.5, 0);

    expect(result.totalShares).toBeCloseTo(2, 1);
    expect(result.totalCost).toBeLessThanOrEqual(1.0);
  });

  it("handles an empty orderbook gracefully", () => {
    const orderbook = makeOrderbook([], []);
    const result = simulateLimitBuy(orderbook, 1, 0.95, 25);

    expect(result.totalShares).toBe(0);
    expect(result.averagePrice).toBe(0);
    expect(result.fees).toBe(0);
  });

  it("fills across multiple ask levels with price improvement", () => {
    const orderbook = makeOrderbook(
      [
        { price: "0.90", size: "5" },
        { price: "0.93", size: "5" },
        { price: "0.95", size: "100" },
      ],
      [],
    );

    // Limit at 0.97 — fills at 0.90, 0.93, 0.95 (price improvement)
    const result = simulateLimitBuy(orderbook, 100, 0.97, 25);

    expect(result.fillDetails.length).toBe(3);
    // Average price should be weighted toward 0.95 (most volume there)
    expect(result.averagePrice).toBeGreaterThan(0.9);
    expect(result.averagePrice).toBeLessThan(0.97);
  });

  it("applies fees correctly at extreme prices (near 0.97)", () => {
    const orderbook = makeOrderbook([{ price: "0.97", size: "100" }], []);

    // At p=0.97, fee = 0.25 × (0.97 × 0.03)^2 ≈ 0.000212
    // With 4-decimal rounding: 0.0002
    const result = simulateLimitBuy(orderbook, 1, 0.97, 25);

    // Fee per share should be very small at extreme prices
    expect(result.fees).toBeGreaterThanOrEqual(0);
    expect(result.fees).toBeLessThan(0.01); // Less than 1 cent for $1 trade
  });

  it("applies zero fees when feeRateBps is 0", () => {
    const orderbook = makeOrderbook([{ price: "0.50", size: "100" }], []);

    const result = simulateLimitBuy(orderbook, 1, 0.5, 0);

    expect(result.fees).toBe(0);
  });

  it("correctly marks partial fills", () => {
    const orderbook = makeOrderbook(
      [{ price: "0.95", size: "0.5" }], // Only 0.5 shares available
      [],
    );

    // $10 budget, only $0.475 worth available → >10% unfilled
    const result = simulateLimitBuy(orderbook, 10, 0.95, 0);

    expect(result.isPartialFill).toBe(true);
    expect(result.totalShares).toBeCloseTo(0.5, 1);
  });
});

// ============================================
// simulateLimitSell
// ============================================

describe("simulateLimitSell", () => {
  it("fills at bid levels at or above the limit price", () => {
    const orderbook = makeOrderbook(
      [],
      [
        { price: "0.90", size: "100" },
        { price: "0.85", size: "200" },
        { price: "0.80", size: "500" },
      ],
    );

    // Sell 50 shares with limit at 0.85 → fill at 0.90 and 0.85
    const result = simulateLimitSell(orderbook, 50, 0.85, 25);

    expect(result.totalSharesSold).toBe(50);
    expect(result.fillDetails.length).toBe(1); // Only 0.90 needed (100 size > 50 shares)
    expect(result.fillDetails[0]!.price).toBe(0.9);
  });

  it("skips bids below the limit price", () => {
    const orderbook = makeOrderbook(
      [],
      [
        { price: "0.80", size: "100" },
        { price: "0.70", size: "200" },
      ],
    );

    // Limit at 0.85 → all bids below → no fill
    const result = simulateLimitSell(orderbook, 10, 0.85, 25);

    expect(result.totalSharesSold).toBe(0);
    expect(result.fillDetails.length).toBe(0);
  });

  it("panic-sells at any price when limit is 0", () => {
    const orderbook = makeOrderbook(
      [],
      [
        { price: "0.50", size: "10" },
        { price: "0.30", size: "10" },
        { price: "0.10", size: "10" },
      ],
    );

    // Sell 25 shares at any price (stop-loss panic)
    const result = simulateLimitSell(orderbook, 25, 0, 0);

    expect(result.totalSharesSold).toBe(25);
    expect(result.fillDetails.length).toBe(3); // 10+10+5
    // Average price should be weighted toward higher bids
    expect(result.averagePrice).toBeGreaterThan(0.1);
    expect(result.averagePrice).toBeLessThan(0.5);
  });

  it("handles empty bids gracefully", () => {
    const orderbook = makeOrderbook([], []);
    const result = simulateLimitSell(orderbook, 10, 0, 0);

    expect(result.totalSharesSold).toBe(0);
    expect(result.averagePrice).toBe(0);
    expect(result.netRevenue).toBe(0);
  });

  it("handles partial fills correctly", () => {
    const orderbook = makeOrderbook(
      [],
      [{ price: "0.80", size: "5" }], // Only 5 shares of demand
    );

    // Try to sell 100 shares → only 5 filled
    const result = simulateLimitSell(orderbook, 100, 0, 0);

    expect(result.totalSharesSold).toBe(5);
    expect(result.isPartialFill).toBe(true);
  });
});

// ============================================
// PnL Calculation Helpers
// ============================================

describe("calculateWinProfit", () => {
  it("calculates profit for a winning trade", () => {
    // Buy 10 shares at $0.95, each pays $1.00 on win
    // Profit = (1 - 0.95) × 10 - fees = 0.5 - 0.01 = 0.49
    const profit = calculateWinProfit(0.95, 10, 0.01);
    expect(profit).toBeCloseTo(0.49, 4);
  });

  it("returns higher profit for lower entry price", () => {
    const profitAt95 = calculateWinProfit(0.95, 10, 0);
    const profitAt90 = calculateWinProfit(0.9, 10, 0);
    expect(profitAt90).toBeGreaterThan(profitAt95);
  });

  it("returns 0 profit at entry price 1.00", () => {
    const profit = calculateWinProfit(1.0, 10, 0);
    expect(profit).toBeCloseTo(0, 4);
  });
});

describe("calculateLossAmount", () => {
  it("calculates full loss for a losing trade", () => {
    // Buy 10 shares at $0.95, market resolves to $0
    // Loss = -(0.95 × 10 + 0.01) = -9.51
    const loss = calculateLossAmount(0.95, 10, 0.01);
    expect(loss).toBeCloseTo(-9.51, 4);
  });

  it("loss is always negative", () => {
    const loss = calculateLossAmount(0.5, 1, 0);
    expect(loss).toBeLessThan(0);
  });
});

describe("calculateEarlyExitPnl", () => {
  it("calculates partial loss for stop-loss exit", () => {
    // Buy at 0.95, sell at 0.80
    // PnL = (0.80 - 0.95) × 10 - 0.01 - 0.005 = -1.515
    const pnl = calculateEarlyExitPnl(0.95, 0.8, 10, 0.01, 0.005);
    expect(pnl).toBeCloseTo(-1.515, 4);
  });

  it("calculates profit for a profitable early exit", () => {
    // Buy at 0.50, sell at 0.70
    // PnL = (0.70 - 0.50) × 10 - 0.01 - 0.01 = 1.98
    const pnl = calculateEarlyExitPnl(0.5, 0.7, 10, 0.01, 0.01);
    expect(pnl).toBeCloseTo(1.98, 4);
  });

  it("stop-loss loss is smaller than full loss", () => {
    const fullLoss = calculateLossAmount(0.95, 10, 0.01);
    const stopLoss = calculateEarlyExitPnl(0.95, 0.8, 10, 0.01, 0.005);
    // Stop-loss should lose less money (less negative)
    expect(stopLoss).toBeGreaterThan(fullLoss);
  });
});
