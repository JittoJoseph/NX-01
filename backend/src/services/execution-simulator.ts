import { createModuleLogger } from "../utils/logger.js";
import {
  CRYPTO_FEE,
  type Orderbook,
  type OrderbookLevel,
} from "../types/index.js";
import Decimal from "decimal.js";

const logger = createModuleLogger("execution-simulator");

/** Result of a simulated limit order fill */
export interface ExecutionResult {
  averagePrice: number;
  totalShares: number;
  totalCost: number; // USD spent (before fees)
  fees: number; // Taker fee in USD
  netCost: number; // totalCost + fees
  isPartialFill: boolean;
  fillDetails: FillDetail[];
  orderbookSnapshot: unknown;
  feeRateBps: number;
}

interface FillDetail {
  price: number;
  shares: number;
  cost: number;
  feeForLevel: number;
}

/**
 * Simulates a GTC limit BUY order that crosses at the best ask.
 *
 * Models the scenario: user places a limit buy at `limitPrice`, and the order
 * fills immediately against resting asks at or below that price (taker fill).
 *
 * Fee formula (from Polymarket docs, for 5M/15M crypto markets):
 *   fee = C × feeRate × (p × (1 - p))^exponent
 *   where C = shares, p = price, feeRate = 0.25, exponent = 2
 *
 * At p=0.97: fee per share = 0.25 × (0.97 × 0.03)^2 = 0.25 × 0.000847 = 0.000212
 * So for 100 shares at 0.97: fee = 0.0212 USDC (~0.02% effective)
 *
 * Fees are rounded to 4 decimal places (smallest fee: 0.0001 USDC).
 */
export function simulateLimitBuy(
  orderbook: Orderbook,
  usdAmount: number,
  limitPrice: number,
  feeRateBps: number,
): ExecutionResult {
  // Sort asks by price ascending (best first)
  const asks = [...orderbook.asks].sort(
    (a, b) => parseFloat(a.price) - parseFloat(b.price),
  );

  const fillDetails: FillDetail[] = [];
  let remainingUsd = new Decimal(usdAmount);
  let totalShares = new Decimal(0);
  let totalCost = new Decimal(0);
  let totalFees = new Decimal(0);

  for (const level of asks) {
    if (remainingUsd.lte(0)) break;

    const askPrice = parseFloat(level.price);
    const askSize = parseFloat(level.size);

    // Only fill at prices at or below our limit price
    if (askPrice > limitPrice) break;

    // Calculate how many shares we can buy at this level
    const feePerShare = calculateFeePerShare(askPrice, feeRateBps);
    const costPerShare = new Decimal(askPrice).plus(feePerShare);

    // Max shares we can afford at this level
    const maxSharesByBudget = remainingUsd.div(costPerShare).toNumber();
    const sharesToFill = Math.min(maxSharesByBudget, askSize);

    if (sharesToFill <= 0) continue;

    const shares = new Decimal(sharesToFill);
    const cost = shares.mul(askPrice);
    const fee = shares.mul(feePerShare);

    totalShares = totalShares.plus(shares);
    totalCost = totalCost.plus(cost);
    totalFees = totalFees.plus(fee);
    remainingUsd = remainingUsd.minus(cost).minus(fee);

    fillDetails.push({
      price: askPrice,
      shares: sharesToFill,
      cost: cost.toNumber(),
      feeForLevel: fee.toNumber(),
    });
  }

  const isPartialFill = remainingUsd.gt(new Decimal(usdAmount).mul(0.1)); // >10% unfilled
  const avgPrice = totalShares.gt(0)
    ? totalCost.div(totalShares).toNumber()
    : 0;

  // Round fees to 4 decimal places (Polymarket precision)
  const roundedFees = Math.round(totalFees.toNumber() * 10000) / 10000;

  if (totalShares.gt(0)) {
    logger.debug(
      {
        avgPrice: avgPrice.toFixed(6),
        shares: totalShares.toNumber().toFixed(4),
        cost: totalCost.toNumber().toFixed(4),
        fees: roundedFees.toFixed(4),
        levels: fillDetails.length,
        partial: isPartialFill,
      },
      "Limit buy simulated",
    );
  }

  return {
    averagePrice: avgPrice,
    totalShares: totalShares.toNumber(),
    totalCost: totalCost.toNumber(),
    fees: roundedFees,
    netCost: totalCost.toNumber() + roundedFees,
    isPartialFill,
    fillDetails,
    orderbookSnapshot: {
      bids: orderbook.bids.slice(0, 5),
      asks: orderbook.asks.slice(0, 5),
      tick_size: orderbook.tick_size,
      timestamp: orderbook.timestamp,
    },
    feeRateBps,
  };
}

/**
 * Calculate fee per share using Polymarket's documented formula.
 * fee_per_share = feeRate × (p × (1-p))^exponent
 *
 * For crypto 5M/15M: feeRate = 0.25, exponent = 2
 * For fee-free markets: returns 0
 */
function calculateFeePerShare(price: number, feeRateBps: number): number {
  if (feeRateBps <= 0) return 0;

  // Use the canonical formula from docs:
  // fee = C × feeRate × (p × (1-p))^exponent
  // Per share (C=1): fee = feeRate × (p × (1-p))^exponent
  const feeRate = CRYPTO_FEE.RATE;
  const exponent = CRYPTO_FEE.EXPONENT;
  const pq = price * (1 - price); // p × (1-p)
  const fee = feeRate * Math.pow(pq, exponent);

  // Round to 4 decimal places (smallest fee: 0.0001)
  return Math.round(fee * 10000) / 10000;
}

/**
 * Calculate expected profit for a winning trade at a given entry price.
 * profit = (1.00 - entryPrice) × shares - fees
 */
export function calculateWinProfit(
  entryPrice: number,
  shares: number,
  fees: number,
): number {
  return (1.0 - entryPrice) * shares - fees;
}

/**
 * Calculate expected loss for a losing trade at a given entry price.
 * loss = -(entryPrice × shares + fees)
 */
export function calculateLossAmount(
  entryPrice: number,
  shares: number,
  fees: number,
): number {
  return -(entryPrice * shares + fees);
}
