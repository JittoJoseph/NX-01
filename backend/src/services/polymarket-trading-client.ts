import {
  ClobClient,
  Chain,
  SignatureType,
  AssetType,
} from "@polymarket/clob-client";
import type { TickSize } from "@polymarket/clob-client";
import { RelayClient, RelayerTxType } from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { createWalletClient, http, encodeFunctionData, zeroHash } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { createModuleLogger } from "../utils/logger.js";
import { Config, POLY_URLS, type BalanceAllowance } from "../types/index.js";

// Polymarket contract addresses on Polygon
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const RELAYER_URL = "https://relayer-v2.polymarket.com/";

const CTF_REDEEM_ABI = [
  {
    name: "redeemPositions",
    type: "function",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const logger = createModuleLogger("polymarket-trading");

/** Singleton wrapper around @polymarket/clob-client for authenticated trading operations. */
class PolymarketTradingClient {
  private client: ClobClient | null = null;
  private relayClient: RelayClient | null = null;
  private heartbeatId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async init(config: Config): Promise<void> {
    const account = privateKeyToAccount(config.polymarket.privateKey as Hex);
    const wallet = createWalletClient({
      account,
      chain: polygon,
      transport: http(),
    });

    this.client = new ClobClient(
      POLY_URLS.CLOB_BASE,
      Chain.POLYGON,
      wallet as any,
      {
        key: config.polymarket.apiKey,
        secret: config.polymarket.apiSecret,
        passphrase: config.polymarket.apiPassphrase,
      },
      SignatureType.POLY_PROXY,
      config.polymarket.funderAddress,
    );

    // Initialize relayer client for gasless transactions (redeem, etc.)
    const { builderApiKey, builderSecret, builderPassphrase } =
      config.polymarket;
    if (builderApiKey && builderSecret && builderPassphrase) {
      const builderConfig = new BuilderConfig({
        localBuilderCreds: {
          key: builderApiKey,
          secret: builderSecret,
          passphrase: builderPassphrase,
        },
      });
      this.relayClient = new RelayClient(
        RELAYER_URL,
        137,
        wallet,
        builderConfig,
        RelayerTxType.PROXY,
      );
      logger.info("Relayer client initialized for gasless transactions");
    }

    // Verify connectivity by fetching balance
    const bal = await this.client.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    logger.info(
      { balance: bal.balance, allowance: bal.allowance },
      "Trading client initialized — USDC.e balance fetched",
    );
  }

  getClient(): ClobClient {
    if (!this.client) throw new Error("Trading client not initialized");
    return this.client;
  }

  // ---- Heartbeat management ----

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    logger.info("Starting heartbeat loop (5s interval)");
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), 5_000);
    // Send first heartbeat immediately
    void this.sendHeartbeat();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.heartbeatId = null;
      logger.info("Heartbeat stopped");
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const resp = await this.getClient().postHeartbeat(this.heartbeatId);
      this.heartbeatId = resp.heartbeat_id;
    } catch (err: unknown) {
      // Reset to null so the next call starts a fresh heartbeat chain.
      // Using IDs from error responses doesn't work — they're from
      // failed/expired chains and the server rejects them too.
      logger.warn(
        { previousId: this.heartbeatId },
        "Heartbeat failed — will start fresh chain on next tick",
      );
      this.heartbeatId = null;
    }
  }

  // ---- Balance ----

  async getUsdcBalance(): Promise<BalanceAllowance> {
    const resp = await this.getClient().getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    return { balance: resp.balance, allowance: resp.allowance };
  }

  async getConditionalBalance(tokenId: string): Promise<BalanceAllowance> {
    const resp = await this.getClient().getBalanceAllowance({
      asset_type: AssetType.CONDITIONAL,
      token_id: tokenId,
    });
    return { balance: resp.balance, allowance: resp.allowance };
  }

  // ---- Orders ----

  /** Place a market buy order (FAK — partial fills accepted). */
  async marketBuy(
    tokenId: string,
    amountUsd: number,
    worstPrice: number,
    tickSize: string,
    negRisk: boolean,
  ) {
    const client = this.getClient();
    const order = await client.createMarketOrder(
      {
        tokenID: tokenId,
        amount: amountUsd,
        price: worstPrice,
        side: "BUY" as any,
      },
      { tickSize: tickSize as TickSize, negRisk },
    );
    const resp = await client.postOrder(order, "FAK" as any);
    logger.info(
      { orderID: resp?.orderID, tokenId, amountUsd, worstPrice },
      "Market BUY order placed",
    );
    return resp;
  }

  /** Place a market sell order (FOK — all-or-nothing for stop-loss). */
  async marketSell(
    tokenId: string,
    shares: number,
    worstPrice: number,
    tickSize: string,
    negRisk: boolean,
  ) {
    const client = this.getClient();
    const order = await client.createMarketOrder(
      {
        tokenID: tokenId,
        amount: shares,
        price: worstPrice,
        side: "SELL" as any,
      },
      { tickSize: tickSize as TickSize, negRisk },
    );
    const resp = await client.postOrder(order, "FOK" as any);
    logger.info(
      { orderID: resp?.orderID, tokenId, shares, worstPrice },
      "Market SELL order placed",
    );
    return resp;
  }

  // ---- Open orders / trades ----

  async getOpenOrders(marketId?: string) {
    const params = marketId ? { market: marketId } : undefined;
    return this.getClient().getOpenOrders(params);
  }

  async getOrder(orderId: string) {
    return this.getClient().getOrder(orderId);
  }

  async getTrades(marketId?: string) {
    const params = marketId ? { market: marketId } : undefined;
    return this.getClient().getTrades(params);
  }

  async cancelAllOrders(): Promise<void> {
    await this.getClient().cancelAll();
    logger.info("All open orders canceled");
  }

  /** Redeem winning conditional tokens for USDC.e via the Polymarket relayer (gasless). */
  async redeemPositions(conditionId: string): Promise<void> {
    if (!this.relayClient) {
      logger.warn(
        { conditionId },
        "Skipping auto-redeem — Builder API credentials not configured. Redeem manually at polymarket.com",
      );
      return;
    }

    const redeemTx = {
      to: CTF_ADDRESS,
      data: encodeFunctionData({
        abi: CTF_REDEEM_ABI,
        functionName: "redeemPositions",
        args: [
          USDC_E_ADDRESS,
          zeroHash, // parentCollectionId — always zero for top-level
          conditionId as Hex,
          [1n, 2n], // both outcome index sets for binary markets
        ],
      }),
      value: "0",
    };

    const response = await this.relayClient.execute(
      [redeemTx],
      "Redeem winning positions",
    );
    logger.info(
      { conditionId, transactionId: response.transactionID },
      "Redeem submitted via Polymarket relayer (gasless)",
    );
  }
}

export const tradingClient = new PolymarketTradingClient();
