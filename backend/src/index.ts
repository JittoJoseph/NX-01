import { createModuleLogger } from "./utils/logger.js";
import { getConfig } from "./utils/config.js";
import { connectDatabase } from "./db/client.js";
import { getBtcPriceWatcher } from "./services/btc-price-watcher.js";
import { getMarketOrchestrator } from "./services/market-orchestrator.js";
import { getApiServer } from "./services/api-server.js";
import { tradingClient } from "./services/polymarket-trading-client.js";
import { positionTracker } from "./services/position-tracker.js";

const logger = createModuleLogger("main");

async function main(): Promise<void> {
  logger.info("═══════════════════════════════════════════");
  logger.info("  PenguinX BTC Trading — v4.0");
  logger.info("  Real Polymarket Order Execution");
  logger.info("═══════════════════════════════════════════");

  // 1. Load and validate configuration
  const config = getConfig();
  logger.info(
    {
      window: config.strategy.marketWindow,
      threshold: config.strategy.entryPriceThreshold,
      maxEntryPrice: config.strategy.maxEntryPrice,
      tradeWindowSec: config.strategy.tradeFromWindowSeconds,
      stopLoss: config.strategy.stopLossPriceTrigger,
    },
    "Configuration loaded",
  );

  // 2. Check geographic eligibility before proceeding
  const geoResp = await fetch("https://polymarket.com/api/geoblock");
  const geo = (await geoResp.json()) as {
    blocked: boolean;
    ip: string;
    country: string;
    region: string;
  };
  if (geo.blocked) {
    logger.fatal(
      { ip: geo.ip, country: geo.country, region: geo.region },
      "Geographic restriction — trading not available from this location",
    );
    process.exit(1);
  }
  logger.info(
    { ip: geo.ip, country: geo.country, region: geo.region },
    "Geoblock check passed",
  );

  // 3. Connect to database
  await connectDatabase();

  // 4. Initialize Polymarket trading client (authenticated SDK)
  await tradingClient.init(config);
  tradingClient.startHeartbeat();
  logger.info("Polymarket trading client initialized with heartbeat");

  // 5. Start position tracker (User WS channel for trade updates)
  positionTracker.init({
    apiKey: config.polymarket.apiKey,
    apiSecret: config.polymarket.apiSecret,
    apiPassphrase: config.polymarket.apiPassphrase,
  });
  positionTracker.connect();
  logger.info("Position tracker connected to User WS channel");

  // 6. Start BTC price watcher (RTDS WebSocket)
  const btcWatcher = getBtcPriceWatcher();
  btcWatcher.start();
  logger.info("BTC price watcher started");

  // 7. Start market orchestrator (scanner + WS + strategy + execution)
  const orchestrator = getMarketOrchestrator();
  await orchestrator.start();

  // 8. Start API server
  const apiServer = getApiServer();
  await apiServer.start();

  logger.info("All systems operational ✓");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    try {
      apiServer.stop();
      orchestrator.stop();
      btcWatcher.stop();
      tradingClient.stopHeartbeat();
      positionTracker.disconnect();
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
    }

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "Unhandled rejection");
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
