import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { tradingClient } from "./polymarket-trading-client.js";
import { balanceManager } from "./balance-manager.js";
import { createTrade, logAudit } from "../db/client.js";
import type { OrderResult } from "../types/index.js";

const logger = createModuleLogger("order-executor");

/**
 * Execute a real market BUY order on Polymarket (FAK — partial fills accepted).
 * Returns an OrderResult with the order ID and fill details.
 */
export async function executeBuyOrder(params: {
  tokenId: string;
  conditionId?: string;
  marketId: string;
  marketCategory?: string;
  windowType?: string;
  outcomeLabel?: string;
  positionBudget: number;
  worstPrice: number;
  tickSize: string;
  negRisk: boolean;
  btcPriceAtEntry?: number;
  btcTargetPrice?: number;
  btcDistanceUsd?: number;
  momentumDirection?: string;
  momentumChangeUsd?: number;
}): Promise<OrderResult> {
  const {
    tokenId,
    conditionId,
    marketId,
    marketCategory,
    windowType,
    outcomeLabel,
    positionBudget,
    worstPrice,
    tickSize,
    negRisk,
  } = params;

  try {
    // Check available balance first
    const balance = await balanceManager.getBalance();
    if (balance < positionBudget) {
      logger.warn(
        { balance, positionBudget },
        "Insufficient USDC balance for buy order",
      );
      return {
        success: false,
        errorMessage: `Insufficient balance: ${balance.toFixed(2)} < ${positionBudget.toFixed(2)}`,
      };
    }

    // Place the order via SDK
    const resp = await tradingClient.marketBuy(
      tokenId,
      positionBudget,
      worstPrice,
      tickSize,
      negRisk,
    );

    if (!resp || !resp.success) {
      const errMsg = resp?.errorMsg || "Order rejected by Polymarket";
      logger.error({ resp }, errMsg);
      await logAudit("error", "order", errMsg, {
        tokenId,
        positionBudget,
        resp,
      });
      return { success: false, errorMessage: errMsg, rawResponse: resp };
    }

    // Parse fill data from response
    const makingAmount = parseFloat(resp.makingAmount || "0");
    const takingAmount = parseFloat(resp.takingAmount || "0");
    const filledShares = makingAmount > 0 ? makingAmount : 0;
    const totalCost = takingAmount > 0 ? takingAmount : positionBudget;
    const avgPrice =
      filledShares > 0
        ? new Decimal(totalCost).div(filledShares).toNumber()
        : worstPrice;

    // Persist the trade to DB
    const trade = await createTrade({
      polymarketOrderId: resp.orderID,
      marketId,
      conditionId: conditionId || undefined,
      tokenId,
      marketCategory,
      windowType,
      outcomeLabel,
      side: "BUY",
      orderType: "FAK",
      status: "MATCHED",
      entryTs: new Date(),
      entryPrice: avgPrice.toString(),
      entryShares: filledShares.toString(),
      positionBudget: positionBudget.toString(),
      actualCost: totalCost.toString(),
      fillStatus: filledShares > 0 ? "FULL" : "PARTIAL",
      btcPriceAtEntry: params.btcPriceAtEntry,
      btcTargetPrice: params.btcTargetPrice,
      btcDistanceUsd: params.btcDistanceUsd,
      momentumDirection: params.momentumDirection,
      momentumChangeUsd: params.momentumChangeUsd,
      rawOrderResponse: resp,
    });

    if (!trade) {
      throw new Error("Failed to persist trade to DB");
    }

    // Invalidate balance cache since we spent USDC
    balanceManager.invalidate();

    logger.info(
      {
        tradeId: trade.id,
        orderID: resp.orderID,
        shares: filledShares,
        cost: totalCost,
        avgPrice,
      },
      "BUY order executed and recorded",
    );

    return {
      success: true,
      orderID: resp.orderID,
      filledShares,
      avgPrice,
      totalCost,
      rawResponse: resp,
    };
  } catch (err) {
    logger.error({ error: err, tokenId, positionBudget }, "BUY order failed");
    await logAudit("error", "order", "BUY order exception", {
      tokenId,
      positionBudget,
      error: String(err),
    });
    return { success: false, errorMessage: String(err) };
  }
}

/**
 * Execute a real market SELL order on Polymarket (FOK — all-or-nothing for stop-loss).
 * Returns an OrderResult with the order ID and fill details.
 */
export async function executeSellOrder(params: {
  tokenId: string;
  shares: number;
  worstPrice: number;
  tickSize: string;
  negRisk: boolean;
  tradeId: string;
}): Promise<OrderResult> {
  const { tokenId, shares, worstPrice, tickSize, negRisk, tradeId } = params;

  try {
    const resp = await tradingClient.marketSell(
      tokenId,
      shares,
      worstPrice,
      tickSize,
      negRisk,
    );

    if (!resp || !resp.success) {
      const errMsg = resp?.errorMsg || "Sell order rejected";
      logger.error({ resp, tradeId }, errMsg);
      await logAudit("error", "order", errMsg, { tokenId, shares, resp });
      return { success: false, errorMessage: errMsg, rawResponse: resp };
    }

    // Invalidate balance cache since we received USDC
    balanceManager.invalidate();

    logger.info(
      { tradeId, orderID: resp.orderID, shares, worstPrice },
      "SELL order executed",
    );

    return {
      success: true,
      orderID: resp.orderID,
      filledShares: shares,
      avgPrice: worstPrice,
      totalCost: new Decimal(shares).mul(worstPrice).toNumber(),
      rawResponse: resp,
    };
  } catch (err) {
    logger.error({ error: err, tradeId, tokenId }, "SELL order failed");
    await logAudit("error", "order", "SELL order exception", {
      tradeId,
      tokenId,
      error: String(err),
    });
    return { success: false, errorMessage: String(err) };
  }
}
