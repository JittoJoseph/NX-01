import express, { Express, Request, Response, NextFunction } from "express";
import { createServer, Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";
import { getMarketOrchestrator } from "./market-orchestrator.js";
import { getMarketScanner } from "./market-scanner.js";
import { getStrategyEngine } from "./strategy-engine.js";
import { getMarketWebSocketWatcher } from "./market-ws-watcher.js";
import {
  calculatePortfolioPerformance,
  type TimePeriod,
} from "./performance-calculator.js";
import Decimal from "decimal.js";

const logger = createModuleLogger("api-server");

export class ApiServer {
  private app: Express;
  private server: HttpServer;
  private wss: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private startedAt: Date | null = null;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({
      server: this.server,
      path: "/ws/simulated",
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

    // CORS
    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    });

    this.app.use((req, res, next) => {
      logger.debug({ method: req.method, path: req.path }, "Request");
      next();
    });

    this.app.use(
      (err: Error, req: Request, res: Response, next: NextFunction) => {
        logger.error({ error: err.message, path: req.path }, "Request error");
        res.status(500).json({ error: "Internal server error" });
      },
    );
  }

  private setupRoutes(): void {
    this.app.get("/health", async (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    this.app.get("/ping", (req, res) => {
      res.json({ message: "pong" });
    });

    // ============================================
    // ACTIVE MARKET (live data for frontend)
    // ============================================
    this.app.get("/api/active-market", (req, res) => {
      try {
        const orchestrator = getMarketOrchestrator();
        const activeMarket = orchestrator.getActiveMarket();
        res.json(activeMarket);
      } catch (error) {
        logger.error({ error }, "Error getting active market");
        res.status(500).json({ error: "Failed to get active market" });
      }
    });

    // ============================================
    // SYSTEM STATS
    // ============================================
    this.app.get("/api/system/stats", async (req, res) => {
      try {
        const orchestrator = getMarketOrchestrator();
        const scanner = getMarketScanner();
        const strategyEngine = getStrategyEngine();
        const wsWatcher = getMarketWebSocketWatcher();
        const db = getDb();

        // Optimized: 2 queries instead of 7
        const tradeStatsResult = await db.execute(sql`
          SELECT 
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status = 'OPEN')::int as open,
            COUNT(*) FILTER (WHERE status = 'CLOSED')::int as closed
          FROM simulated_trades
        `);

        const otherStatsResult = await db.execute(sql`
          SELECT 
            (SELECT COUNT(*)::int FROM markets WHERE active = true) as active_markets,
            (SELECT COUNT(*)::int FROM strategy_triggers) as total_triggers,
            (SELECT COUNT(*)::int FROM experiment_runs) as total_experiments
        `);

        const ts = (tradeStatsResult[0] || {}) as any;
        const os = (otherStatsResult[0] || {}) as any;

        const uptimeMs = this.startedAt
          ? Date.now() - this.startedAt.getTime()
          : 0;

        res.json({
          system: "btc-15m",
          uptimeSeconds: Math.floor(uptimeMs / 1000),
          startedAt: this.startedAt?.toISOString() ?? null,
          orchestrator: orchestrator.getStats(),
          scanner: { discoveredMarkets: scanner.getDiscoveredCount() },
          strategy: strategyEngine.getStats(),
          websocket: wsWatcher.getStats(),
          database: {
            totalTrades: ts.total || 0,
            openTrades: ts.open || 0,
            closed: ts.closed || 0,
            activeMarkets: os.active_markets || 0,
            totalTriggers: os.total_triggers || 0,
            totalExperiments: os.total_experiments || 0,
          },
          wsClients: this.wsClients.size,
        });
      } catch (error) {
        logger.error({ error }, "Error getting system stats");
        res.status(500).json({ error: "Failed to get system stats" });
      }
    });

    // ============================================
    // TRADES
    // ============================================
    this.app.get("/api/trades", async (req, res) => {
      try {
        const db = getDb();
        const { status, limit = "50", offset = "0", experimentId } = req.query;

        const limitNum = Math.min(parseInt(String(limit), 10), 100);
        const offsetNum = parseInt(String(offset), 10);

        const conditions = [];
        if (status) {
          conditions.push(eq(schema.simulatedTrades.status, String(status)));
        }
        if (experimentId) {
          conditions.push(
            eq(schema.simulatedTrades.experimentId, String(experimentId)),
          );
        }

        const baseQuery = db
          .select({
            id: schema.simulatedTrades.id,
            experimentId: schema.simulatedTrades.experimentId,
            marketId: schema.simulatedTrades.marketId,
            tokenId: schema.simulatedTrades.tokenId,
            marketCategory: schema.simulatedTrades.marketCategory,
            outcomeLabel: schema.simulatedTrades.outcomeLabel,
            side: schema.simulatedTrades.side,
            entryTs: schema.simulatedTrades.entryTs,
            entryPrice: schema.simulatedTrades.entryPrice,
            entryShares: schema.simulatedTrades.entryShares,
            simulatedUsdAmount: schema.simulatedTrades.simulatedUsdAmount,
            entryFees: schema.simulatedTrades.entryFees,
            entrySlippage: schema.simulatedTrades.entrySlippage,
            entryLatencyMs: schema.simulatedTrades.entryLatencyMs,
            fillStatus: schema.simulatedTrades.fillStatus,
            claimAt: schema.simulatedTrades.claimAt,
            claimOutcome: schema.simulatedTrades.claimOutcome,
            claimPrice: schema.simulatedTrades.claimPrice,
            claimTs: schema.simulatedTrades.claimTs,
            realizedPnl: schema.simulatedTrades.realizedPnl,
            status: schema.simulatedTrades.status,
            strategyTrigger: schema.simulatedTrades.strategyTrigger,
            createdAt: schema.simulatedTrades.createdAt,
            market: {
              question: schema.markets.question,
              slug: schema.markets.slug,
              outcomes: schema.markets.outcomes,
              endDate: schema.markets.endDate,
            },
          })
          .from(schema.simulatedTrades)
          .leftJoin(
            schema.markets,
            eq(schema.simulatedTrades.marketId, schema.markets.id),
          )
          .orderBy(desc(schema.simulatedTrades.entryTs))
          .limit(limitNum)
          .offset(offsetNum);

        const trades =
          conditions.length > 0
            ? await baseQuery.where(and(...conditions))
            : await baseQuery;

        const tradeResponses = trades.map((trade) => ({
          id: trade.id,
          experimentId: trade.experimentId,
          marketId: trade.marketId,
          tokenId: trade.tokenId,
          marketCategory: trade.marketCategory,
          outcomeLabel: trade.outcomeLabel,
          side: trade.side,
          entryTs: trade.entryTs.toISOString(),
          entryPrice: trade.entryPrice.toString(),
          entryShares: trade.entryShares.toString(),
          simulatedUsdAmount: trade.simulatedUsdAmount.toString(),
          entryFees: trade.entryFees?.toString() ?? "0",
          entrySlippage: trade.entrySlippage?.toString() ?? "0",
          entryLatencyMs: trade.entryLatencyMs?.toString() ?? null,
          fillStatus: trade.fillStatus,
          claimAt: trade.claimAt?.toISOString() ?? null,
          claimOutcome: trade.claimOutcome,
          claimPrice: trade.claimPrice?.toString() ?? null,
          claimTs: trade.claimTs?.toISOString() ?? null,
          realizedPnl: trade.realizedPnl?.toString() ?? null,
          status: trade.status,
          strategyTrigger: trade.strategyTrigger,
          createdAt: trade.createdAt.toISOString(),
          market: trade.market
            ? {
                question: trade.market.question,
                slug: trade.market.slug,
                outcomes: trade.market.outcomes,
                outcome: trade.outcomeLabel,
                endDate: trade.market.endDate,
              }
            : null,
        }));

        res.json({ trades: tradeResponses, total: trades.length });
      } catch (error) {
        logger.error({ error }, "Failed to get trades");
        res.status(500).json({ error: "Failed to get trades" });
      }
    });

    // /api/positions is now served by /api/trades?status=CLOSED

    // ============================================
    // MARKETS
    // ============================================
    this.app.get("/api/markets", async (req, res) => {
      try {
        const db = getDb();
        const { active, includePast } = req.query;
        const now = new Date();

        const conditions = [];
        if (active !== undefined) {
          conditions.push(eq(schema.markets.active, active === "true"));
        }
        // By default, filter out past markets (endDate >= now)
        // Unless includePast=true is explicitly set
        if (includePast !== "true") {
          conditions.push(
            sql`${schema.markets.endDate}::timestamp >= ${now.toISOString()}::timestamp`,
          );
        }

        const baseQuery = db
          .select()
          .from(schema.markets)
          .orderBy(schema.markets.endDate);
        const markets =
          conditions.length > 0
            ? await baseQuery.where(and(...conditions))
            : await baseQuery;

        // Determine which market is currently active (first one that hasn't ended)
        const currentActiveMarketId =
          markets.find((m) => {
            if (!m.endDate) return false;
            const endTime = new Date(m.endDate);
            const startTime = new Date(endTime.getTime() - 15 * 60 * 1000);
            return now >= startTime && now < endTime;
          })?.id ?? null;

        res.json({
          markets: markets.map((m) => ({
            id: m.id,
            conditionId: m.conditionId,
            slug: m.slug,
            question: m.question,
            category: m.category,
            marketFrequency: m.marketFrequency,
            endDate: m.endDate,
            active: m.active,
            outcomes: m.outcomes,
            clobTokenIds: m.clobTokenIds,
            takerBaseFee: m.takerBaseFee,
            makerBaseFee: m.makerBaseFee,
            lastFetchedAt: m.lastFetchedAt?.toISOString() ?? null,
            createdAt: m.createdAt.toISOString(),
            isActive: m.id === currentActiveMarketId,
          })),
          total: markets.length,
        });
      } catch (error) {
        logger.error({ error }, "Failed to get markets");
        res.status(500).json({ error: "Failed to get markets" });
      }
    });

    // ============================================
    // STRATEGY TRIGGERS
    // ============================================
    this.app.get("/api/triggers", async (req, res) => {
      try {
        const db = getDb();
        const { limit = "50", executed } = req.query;
        const limitNum = Math.min(parseInt(String(limit), 10), 200);

        const conditions = [];
        if (executed !== undefined) {
          conditions.push(
            eq(schema.strategyTriggers.executed, executed === "true"),
          );
        }

        const baseQuery = db
          .select()
          .from(schema.strategyTriggers)
          .orderBy(desc(schema.strategyTriggers.createdAt))
          .limit(limitNum);

        const triggers =
          conditions.length > 0
            ? await baseQuery.where(and(...conditions))
            : await baseQuery;

        res.json({
          triggers: triggers.map((t) => ({
            id: t.id,
            marketId: t.marketId,
            tokenId: t.tokenId,
            triggerType: t.triggerType,
            triggerPrice: t.triggerPrice?.toString() ?? null,
            triggerTs: t.triggerTs.toISOString(),
            windowStart: t.windowStart?.toISOString() ?? null,
            windowEnd: t.windowEnd?.toISOString() ?? null,
            executed: t.executed,
            simulatedTradeId: t.simulatedTradeId,
            metadata: t.metadata,
            createdAt: t.createdAt.toISOString(),
          })),
          total: triggers.length,
        });
      } catch (error) {
        logger.error({ error }, "Failed to get triggers");
        res.status(500).json({ error: "Failed to get triggers" });
      }
    });

    // ============================================
    // EXPERIMENT RUNS
    // ============================================
    this.app.get("/api/experiments", async (req, res) => {
      try {
        const db = getDb();
        const { status } = req.query;

        const conditions = [];
        if (status) {
          conditions.push(eq(schema.experimentRuns.status, String(status)));
        }

        const baseQuery = db
          .select()
          .from(schema.experimentRuns)
          .orderBy(desc(schema.experimentRuns.startedAt));

        const experiments =
          conditions.length > 0
            ? await baseQuery.where(and(...conditions))
            : await baseQuery;

        res.json({
          experiments: experiments.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            strategyVariant: e.strategyVariant,
            parameters: e.parameters,
            startedAt: e.startedAt.toISOString(),
            endedAt: e.endedAt?.toISOString() ?? null,
            status: e.status,
            totalTrades: e.totalTrades?.toString() ?? "0",
            successfulTrades: e.successfulTrades?.toString() ?? "0",
            avgRealizedPnl: e.avgRealizedPnl?.toString() ?? null,
            metadata: e.metadata,
            createdAt: e.createdAt.toISOString(),
          })),
          total: experiments.length,
        });
      } catch (error) {
        logger.error({ error }, "Failed to get experiments");
        res.status(500).json({ error: "Failed to get experiments" });
      }
    });

    // ============================================
    // PERFORMANCE
    // ============================================
    this.app.get("/api/performance", async (req, res) => {
      try {
        const { period = "1D" } = req.query;

        const validPeriods: TimePeriod[] = ["1D", "1W", "1M", "ALL"];
        if (!validPeriods.includes(period as TimePeriod)) {
          res.status(400).json({
            error: "Invalid period. Use 1D, 1W, 1M, or ALL",
          });
          return;
        }

        const performance = await calculatePortfolioPerformance(
          period as TimePeriod,
        );
        res.json(performance);
      } catch (error) {
        logger.error({ error }, "Failed to get portfolio performance");
        res.status(500).json({ error: "Failed to get portfolio performance" });
      }
    });

    // ============================================
    // AUDIT LOGS
    // ============================================
    this.app.get("/api/audit", async (req, res) => {
      try {
        const db = getDb();
        const { level, category, limit = "50" } = req.query;
        const limitNum = Math.min(parseInt(String(limit), 10), 200);

        const baseQuery = db
          .select()
          .from(schema.auditLogs)
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(limitNum);

        const conditions = [];
        if (level) {
          conditions.push(eq(schema.auditLogs.level, String(level)));
        }
        if (category) {
          conditions.push(eq(schema.auditLogs.category, String(category)));
        }

        const logs =
          conditions.length > 0
            ? await baseQuery.where(and(...conditions))
            : await baseQuery;

        res.json({ logs });
      } catch (error) {
        logger.error({ error }, "Failed to get audit logs");
        res.status(500).json({ error: "Failed to get audit logs" });
      }
    });

    // ============================================
    // ADMIN
    // ============================================
    this.app.post(
      "/api/admin/wipe",
      async (req: Request, res: Response): Promise<void> => {
        try {
          const { password } = req.body;
          const config = getConfig();

          if (!password || password !== config.wipe.password) {
            logger.warn({ ip: req.ip }, "Unauthorized wipe attempt");
            res.status(401).json({ error: "Invalid password" });
            return;
          }

          logger.warn("Starting database wipe operation");
          const db = getDb();

          // Get all table names in the public schema
          const tablesResult = await db.execute(
            sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
          );
          const tableNames = tablesResult.map((row: any) => row.tablename);

          // Truncate all tables
          for (const tableName of tableNames) {
            await db.execute(sql.raw(`TRUNCATE TABLE "${tableName}" CASCADE`));
          }

          logger.warn("Database wipe completed successfully");
          res.json({
            success: true,
            message: "Database wiped successfully",
            tablesWiped: tableNames.length,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error({ error }, "Failed to wipe database");
          res.status(500).json({ error: "Failed to wipe database" });
        }
      },
    );
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      logger.debug("WebSocket client connected");
      this.wsClients.add(ws);

      ws.on("close", () => {
        logger.debug("WebSocket client disconnected");
        this.wsClients.delete(ws);
      });

      ws.on("error", (error) => {
        logger.error({ error }, "WebSocket client error");
        this.wsClients.delete(ws);
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // Ignore invalid messages
        }
      });

      ws.send(
        JSON.stringify({
          type: "connected",
          timestamp: new Date().toISOString(),
        }),
      );
    });

    // Forward orchestrator events to WebSocket clients
    try {
      const orchestrator = getMarketOrchestrator();
      orchestrator.on("tradeExecuted", (data: unknown) => {
        this.broadcast({
          type: "tradeExecuted",
          data,
          timestamp: new Date().toISOString(),
        });
      });

      orchestrator.on("tradeClosed", (data: unknown) => {
        this.broadcast({
          type: "tradeClosed",
          data,
          timestamp: new Date().toISOString(),
        });
      });

      orchestrator.on("activeMarketUpdate", (data: unknown) => {
        this.broadcast({
          type: "activeMarketUpdate",
          data,
          timestamp: new Date().toISOString(),
        });
      });

      // Forward live price ticks to frontend WS clients (lightweight updates)
      orchestrator.on("priceTickUpdate", (data: unknown) => {
        this.broadcast({
          type: "priceTickUpdate",
          data,
          timestamp: new Date().toISOString(),
        });
      });
    } catch {
      logger.warn("Orchestrator not ready during WebSocket setup");
    }
  }

  private broadcast(message: object): void {
    const payload = JSON.stringify(message);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  async start(): Promise<void> {
    const config = getConfig();
    return new Promise((resolve) => {
      this.server.listen(config.server.port, config.server.host, () => {
        this.startedAt = new Date();
        logger.info(
          { port: config.server.port, host: config.server.host },
          "API server started",
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.wsClients) {
        client.close();
      }
      this.wsClients.clear();
      this.wss.close(() => {
        this.server.close(() => {
          logger.info("API server stopped");
          resolve();
        });
      });
    });
  }
}

// Singleton
let serverInstance: ApiServer | null = null;

export function getApiServer(): ApiServer {
  if (!serverInstance) {
    serverInstance = new ApiServer();
  }
  return serverInstance;
}
