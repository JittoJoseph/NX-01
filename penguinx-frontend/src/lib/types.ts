/**
 * Types for the PenguinX BTC 15-minute market simulation frontend.
 */

// ============================================
// Trade types
// ============================================

export interface SimulatedTrade {
  id: string;
  experimentId: string | null;
  marketId: string | null;
  tokenId: string | null;
  marketCategory: string | null;
  outcomeLabel: string | null;
  side: string;
  entryTs: string;
  entryPrice: string;
  entryShares: string;
  simulatedUsdAmount: string;
  entryFees: string;
  entrySlippage: string;
  entryLatencyMs: string | null;
  fillStatus: string | null;
  claimAt: string | null;
  claimOutcome: string | null;
  claimPrice: string | null;
  claimTs: string | null;
  realizedPnl: string | null;
  status: string;
  strategyTrigger: string | null;
  createdAt: string;
  market: {
    question: string | null;
    slug: string | null;
    outcomes: unknown;
    outcome: string | null;
    endDate: string | null;
  } | null;
}

// ============================================
// Position types
// ============================================

export interface SimulatedPosition {
  marketId: string;
  tokenId: string | null;
  outcomeLabel: string | null;
  question: string | null;
  status: string;
  totalShares: string;
  averageEntryPrice: string;
  claimAt: string | null;
  openTradesCount: number;
  marketWindowStart: string | null;
  marketWindowEnd: string | null;
}

// ============================================
// System stats types
// ============================================

export interface SystemStats {
  system: string;
  uptimeSeconds: number;
  startedAt: string | null;
  orchestrator: Record<string, unknown>;
  scanner: {
    discoveredMarkets: number;
  };
  strategy: Record<string, unknown>;
  websocket: Record<string, unknown>;
  database: {
    totalTrades: number;
    openTrades: number;
    closed: number;
    activeMarkets: number;
    totalTriggers: number;
    totalExperiments: number;
  };
  wsClients: number;
}

// ============================================
// Market types
// ============================================

export interface DiscoveredMarket {
  id: string;
  conditionId: string | null;
  slug: string | null;
  question: string | null;
  category: string | null;
  marketFrequency: string | null;
  endDate: string | null;
  active: boolean;
  outcomes: unknown;
  clobTokenIds: unknown;
  takerBaseFee: string | null;
  makerBaseFee: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  isActive: boolean;
}

// ============================================
// Strategy trigger types
// ============================================

export interface StrategyTrigger {
  id: string;
  marketId: string;
  tokenId: string;
  triggerType: string;
  triggerPrice: string | null;
  triggerTs: string;
  windowStart: string | null;
  windowEnd: string | null;
  executed: boolean;
  simulatedTradeId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ============================================
// Experiment types
// ============================================

export interface ExperimentRun {
  id: string;
  name: string;
  description: string | null;
  strategyVariant: string | null;
  parameters: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  totalTrades: string;
  successfulTrades: string;
  avgRealizedPnl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ============================================
// Performance types
// ============================================

export interface PerformanceMetrics {
  period: string;
  timeframe: { start: string | null; end: string };
  summary: {
    totalPnl: string;
    realizedPnl: string;
    unrealizedPnl: string;
    netPnl: string;
    totalFees: string;
    totalInvested: string;
    roi: string;
  };
  trades: {
    total: number;
    open: number;
    closed: number;
    wins: number;
    losses: number;
    winRate: string;
  };
  performance: {
    largestWin: string;
    largestLoss: string;
    avgWin: string;
    avgLoss: string;
  };
}

// ============================================
// Audit log types
// ============================================

export interface AuditLog {
  id: string;
  level: string;
  category: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ============================================
// API response wrappers
// ============================================

export interface TradesResponse {
  trades: SimulatedTrade[];
  total: number;
}

export interface MarketsResponse {
  markets: DiscoveredMarket[];
  total: number;
}

export interface TriggersResponse {
  triggers: StrategyTrigger[];
  total: number;
}

export interface ExperimentsResponse {
  experiments: ExperimentRun[];
  total: number;
}

export interface AuditResponse {
  logs: AuditLog[];
}

export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

// ============================================
// WebSocket types
// ============================================

export interface WsMessage {
  type:
    | "connected"
    | "tradeExecuted"
    | "tradeClosed"
    | "activeMarketUpdate"
    | "priceTickUpdate"
    | "pong";
  data?: unknown;
  timestamp: string;
}

export interface ActiveMarket {
  marketId: string;
  conditionId: string | null;
  question: string | null;
  slug: string | null;
  endDate: string;
  upTokenId: string | null;
  downTokenId: string | null;
  upPrice: number;
  downPrice: number;
  polymarketUrl: string;
  activeBet: {
    tradeId: string;
    outcomeLabel: string;
    entryPrice: number;
    shares: number;
  } | null;
  openPositions: OpenPosition[];
}

/** Open position from orchestrator's in-memory state with live prices */
export interface OpenPosition {
  tradeId: string;
  tokenId: string;
  marketId: string;
  outcomeLabel: string;
  entryPrice: number;
  shares: number;
  entryFees: number;
  currentPrice: number;
  entryTs: string;
  marketEndTime: string;
  market?: {
    question: string | null;
    slug: string | null;
    endDate: string;
  };
}

/** Lightweight price-only update from backend WS */
export interface PriceTickUpdate {
  marketId: string;
  tokenId: string;
  upPrice: number;
  downPrice: number;
  source: string;
}

// ============================================
// UI helper types
// ============================================

export type Direction = "up" | "down" | "flat";

export type MarketCategory = "btc-15m";

export const MARKET_CATEGORIES: {
  value: MarketCategory;
  label: string;
  shortLabel: string;
  color: string;
}[] = [
  {
    value: "btc-15m",
    label: "BTC 15-MIN",
    shortLabel: "BTC",
    color: "text-amber-500",
  },
];
