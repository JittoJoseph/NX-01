import {
  ClobClient,
  Chain,
  SignatureType,
  AssetType,
} from "@polymarket/clob-client";
import { Contract, Wallet, providers, constants } from "ethers";
import { createModuleLogger } from "../utils/logger.js";
import {
  Config,
  POLY_URLS,
  CTF_ADDRESS,
  USDC_E_ADDRESS,
  type BalanceAllowance,
} from "../types/index.js";

const CTF_REDEEM_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
];

const logger = createModuleLogger("polymarket-trading");

/** Singleton wrapper around @polymarket/clob-client for authenticated trading operations. */
class PolymarketTradingClient {
  private client: ClobClient | null = null;
  private signer: Wallet | null = null;
  private heartbeatId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async init(config: Config): Promise<void> {
    const provider = new providers.JsonRpcProvider(POLY_URLS.POLYGON_RPC);
    const wallet = new Wallet(config.polymarket.privateKey, provider);
    this.signer = wallet;

    this.client = new ClobClient(
      POLY_URLS.CLOB_BASE,
      Chain.POLYGON,
      wallet,
      {
        key: config.polymarket.apiKey,
        secret: config.polymarket.apiSecret,
        passphrase: config.polymarket.apiPassphrase,
      },
      SignatureType.POLY_PROXY,
      config.polymarket.funderAddress,
    );

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
      const resp = await this.getClient().postHeartbeat(
        this.heartbeatId ?? undefined,
      );
      this.heartbeatId = resp.heartbeat_id;
    } catch (err) {
      logger.error({ error: err }, "Heartbeat failed — orders may be canceled");
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
    const order = await client.createMarketOrder({
      tokenID: tokenId,
      amount: amountUsd,
      price: worstPrice,
      side: "BUY" as any,
    });
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
    const order = await client.createMarketOrder({
      tokenID: tokenId,
      amount: shares,
      price: worstPrice,
      side: "SELL" as any,
    });
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

  /** Redeem winning conditional tokens for USDC.e via the CTF contract. */
  async redeemPositions(conditionId: string): Promise<string> {
    if (!this.signer) throw new Error("Trading client not initialized");
    const ctf = new Contract(CTF_ADDRESS, CTF_REDEEM_ABI, this.signer);
    const tx = await ctf.redeemPositions(
      USDC_E_ADDRESS,
      constants.HashZero, // parentCollectionId — always zero for top-level
      conditionId,
      [1, 2], // both outcome index sets for binary markets
    );
    const receipt = await tx.wait();
    logger.info(
      { conditionId, txHash: receipt.transactionHash },
      "Winning positions redeemed on CTF contract",
    );
    return receipt.transactionHash;
  }
}

export const tradingClient = new PolymarketTradingClient();
