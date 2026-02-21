import { loadConfig, getConfig } from "./utils/config.js";
import { createModuleLogger } from "./utils/logger.js";
import { connectDatabase, disconnectDatabase } from "./db/client.js";
import { getMarketOrchestrator } from "./services/market-orchestrator.js";
import { getApiServer } from "./services/api-server.js";

const logger = createModuleLogger("main");

async function main(): Promise<void> {
  logger.info("Starting PenguinX backend (BTC 15-Minute Claim System)...");

  // 1. Load configuration
  loadConfig();
  const config = getConfig();
  logger.info({ env: config.env }, "Configuration loaded");

  // 2. Initialize database
  logger.info("Initializing database connection...");
  await connectDatabase();
  logger.info("Database connected");

  // 3. Initialize market orchestrator (coordinates all services)
  logger.info("Initializing market orchestrator...");
  const orchestrator = getMarketOrchestrator();

  // 4. Start API server
  logger.info("Starting API server...");
  const apiServer = getApiServer();
  await apiServer.start();

  // 5. Start orchestrator (starts scanner, strategy engine, websocket)
  logger.info("Starting market orchestrator...");
  await orchestrator.start();

  // Setup event listeners for logging
  orchestrator.on("tradeExecuted", ({ trade, execution }) => {
    logger.info(
      {
        tradeId: trade.id,
        tokenId: trade.tokenId,
        price: execution.averagePrice.toString(),
        fees: execution.fees.toString(),
      },
      "Simulated trade executed",
    );
  });

  orchestrator.on("tradeClosed", ({ tradeId, outcome, realizedPnl }) => {
    logger.info({ tradeId, outcome, realizedPnl }, "Trade closed");
  });

  logger.info(
    {
      port: config.server.port,
      system: "btc-15m-claim",
      experimentId: orchestrator.getStats().experimentId,
    },
    "🐧 PenguinX backend is running (BTC 15-Minute Claim Mode)",
  );
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Received shutdown signal");

  try {
    // Stop orchestrator
    const orchestrator = getMarketOrchestrator();
    orchestrator.stop();
    logger.info("Orchestrator stopped");

    // Stop API server
    const apiServer = getApiServer();
    await apiServer.stop();
    logger.info("API server stopped");

    // Disconnect database
    await disconnectDatabase();
    logger.info("Database disconnected");

    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.fatal({ error }, "Failed to start application");
  process.exit(1);
});
