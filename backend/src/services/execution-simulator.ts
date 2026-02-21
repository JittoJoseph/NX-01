import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { Orderbook } from "../types/index.js";

const logger = createModuleLogger("execution-simulator");

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export interface ExecutionConfig {
  latencyMin: number; // Min latency in ms
  latencyMax: number; // Max latency in ms
  slippageModel: "pessimistic" | "realistic" | "optimistic";
  feeModel: "15m" | "standard"; // BTC 15M markets always use "15m"
}

export interface ExecutionResult {
  averagePrice: Decimal;
  totalShares: Decimal;
  totalSpent: Decimal;
  isPartialFill: boolean;
  fees: Decimal;
  slippage: Decimal;
  latencyMs: number;
  fillDetails: Array<{
    price: string;
    size: string;
    filledSize: string;
  }>;
}

/**
 * Calculate taker fee for 15M crypto markets based on Polymarket's fee curve.
 *
 * Per Polymarket docs (trading-fees.md):
 * - Formula: fee = takerBaseFee × min(price, 1-price) × size
 * - takerBaseFee comes from the market's Gamma API metadata
 * - 15M crypto markets typically have takerBaseFee = 200 (2% in basis points)
 * - Fee peaks at price 0.50 and declines toward 0 and 1
 */
export function calculate15mTakerFee(
  price: Decimal,
  size: Decimal,
  takerBaseFee?: number | null,
): Decimal {
  const basisPoints = takerBaseFee ?? 200;
  const baseFeeRate = new Decimal(basisPoints).div(10000);
  const priceFactor = Decimal.min(price, new Decimal(1).minus(price));
  return baseFeeRate.mul(priceFactor).mul(size);
}

/**
 * Simulate latency (network + API processing delay)
 */
export function simulateLatency(config: ExecutionConfig): number {
  const range = config.latencyMax - config.latencyMin;
  return config.latencyMin + Math.random() * range;
}

/**
 * Simulate price micro-movement during latency.
 * For BTC 15M markets the volatility is relatively high near window end.
 */
export function simulateSlippage(
  price: Decimal,
  latencyMs: number,
  config: ExecutionConfig,
): Decimal {
  let baseSlippageRate: Decimal;

  switch (config.slippageModel) {
    case "optimistic":
      baseSlippageRate = new Decimal(0.0005);
      break;
    case "realistic":
      baseSlippageRate = new Decimal(0.001);
      break;
    case "pessimistic":
      baseSlippageRate = new Decimal(0.002);
      break;
  }

  const latencyFactor = new Decimal(latencyMs).div(100);
  const scaledSlippage = baseSlippageRate.mul(latencyFactor);
  return price.mul(scaledSlippage);
}

/**
 * Simulate a BUY order walk through the orderbook (entry only).
 *
 * Models:
 *  1. Walking ask levels to fill an order
 *  2. Latency between seeing the book and executing
 *  3. Slippage due to price drift
 *  4. Taker fees (15M fee curve)
 *  5. Partial fill scenarios
 */
export function executeSimulatedOrder(
  orderbook: Orderbook,
  amount: Decimal,
  side: "BUY" | "SELL",
  config: ExecutionConfig,
  takerBaseFee?: number | null,
): ExecutionResult {
  const rawLevels = side === "BUY" ? orderbook.asks : orderbook.bids;

  if (rawLevels.length === 0) {
    return {
      averagePrice: new Decimal(0),
      totalShares: new Decimal(0),
      totalSpent: new Decimal(0),
      isPartialFill: true,
      fees: new Decimal(0),
      slippage: new Decimal(0),
      latencyMs: simulateLatency(config),
      fillDetails: [],
    };
  }

  // Sort best-first
  const levels = [...rawLevels].sort((a, b) => {
    const pA = parseFloat(a.price);
    const pB = parseFloat(b.price);
    return side === "BUY" ? pA - pB : pB - pA;
  });

  const latencyMs = simulateLatency(config);

  let remainingAmount = amount;
  let totalShares = new Decimal(0);
  let totalSpent = new Decimal(0);
  const fillDetails: ExecutionResult["fillDetails"] = [];

  for (const level of levels) {
    if (remainingAmount.lte(0)) break;

    const levelPrice = new Decimal(level.price);
    const levelSize = new Decimal(level.size);

    const slip = simulateSlippage(levelPrice, latencyMs, config);
    const effectivePrice =
      side === "BUY" ? levelPrice.plus(slip) : levelPrice.minus(slip);

    let sharesToFill: Decimal;
    let costAtLevel: Decimal;

    if (side === "BUY") {
      const maxSharesAtLevel = remainingAmount.div(effectivePrice);
      sharesToFill = Decimal.min(maxSharesAtLevel, levelSize);
      costAtLevel = sharesToFill.mul(effectivePrice);
    } else {
      sharesToFill = Decimal.min(remainingAmount, levelSize);
      costAtLevel = sharesToFill.mul(effectivePrice);
    }

    totalShares = totalShares.plus(sharesToFill);
    totalSpent = totalSpent.plus(costAtLevel);
    remainingAmount = remainingAmount.minus(
      side === "BUY" ? costAtLevel : sharesToFill,
    );

    fillDetails.push({
      price: effectivePrice.toString(),
      size: levelSize.toString(),
      filledSize: sharesToFill.toString(),
    });
  }

  const averagePrice = totalShares.gt(0)
    ? totalSpent.div(totalShares)
    : new Decimal(0);

  // Always use 15M fee calculation
  const fees = calculate15mTakerFee(averagePrice, totalShares, takerBaseFee);

  const midPrice =
    levels.length > 0 ? new Decimal(levels[0]?.price || 0) : new Decimal(0);
  const slippage = averagePrice.minus(midPrice).abs();

  return {
    averagePrice,
    totalShares,
    totalSpent,
    isPartialFill: remainingAmount.gt(0),
    fees,
    slippage,
    latencyMs,
    fillDetails,
  };
}
