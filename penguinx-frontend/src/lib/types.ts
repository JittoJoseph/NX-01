/**
 * Types for the PenguinX BTC end-of-window micro-profit simulation frontend.
 */

// ============================================
// Trade types
// ============================================

export interface Trade {
  id: string;
  // Polymarket references
  polymarketOrderId: string | null;
  polymarketTradeIds: string[] | null;
  transactionHashes: string[] | null;
  marketId: string | null;
  conditionId: string | null;
  tokenId: string | null;
  marketCategory: string | null;
  windowType: string | null;
  side: string;
  outcomeLabel: string | null;
  orderType: string;
  // Order lifecycle: PENDING → MATCHED → CONFIRMED → SETTLED / FAILED
  status: string;
  /** Polymarket trade status: MATCHED | MINED | CONFIRMED | RETRYING | FAILED */
  tradeStatus: string | null;
  entryTs: string;
  entryPrice: string;
  entryShares: string;
  /** Budget allocated from portfolio (portfolioValue / slots) */
  positionBudget: string;
  /** Actual USD spent (shares × avgFillPrice + fees) */
  actualCost: string;
  entryFees: string | null;
  fillStatus: string | null;
  btcPriceAtEntry: string | null;
  btcTargetPrice: string | null;
  btcDistanceUsd: string | null;
  /** BTC momentum direction at entry */
  momentumDirection: string | null;
  /** BTC momentum change in USD at entry */
  momentumChangeUsd: string | null;
  exitPrice: string | null;
  exitTs: string | null;
  exitOutcome: string | null;
  exitOrderId: string | null;
  exitFees: string | null;
  realizedPnl: string | null;
  minPriceDuringPosition: string | null;
  rawOrderResponse: unknown;
  rawTradeData: unknown;
  createdAt: string;
  updatedAt: string;
  /** Market end date (ISO string) joined from markets table — used for WINDOW column display */
  marketEndDate: string | null;
  /** Market slug joined from markets table — used to build Polymarket event URL */
  marketSlug: string | null;
  /** Market question joined from markets table */
  marketQuestion: string | null;
}

// ============================================
// Live market types (pushed via WebSocket systemState)
// ============================================

export interface LiveMarketPrice {
  bid: number;
  ask: number;
  mid: number;
}

export interface LiveMarketInfo {
  marketId: string;
  question: string;
  slug: string | null;
  endDate: string; // ISO string
  /** ISO string for when this market's price window opens (endDate - windowDuration) */
  windowStart: string;
  yesTokenId: string;
  noTokenId: string;
  prices: Record<string, LiveMarketPrice>;
  /** ACTIVE = window open; UPCOMING = window not yet started; ENDED = awaiting resolution */
  status: "ACTIVE" | "ENDED" | "UPCOMING";
  hasPosition: boolean;
  /** BTC price captured when the market window opened — the "price to beat" for Up/Down markets */
  btcPriceAtWindowStart: number | null;
}

// ============================================
// System stats types
// ============================================

export interface SystemStats {
  orchestrator: {
    running: boolean;
    paused: boolean;
    activeMarkets: number;
    openPositions: number;
    cycleCount: number;
    scanner: { discoveredCount: number };
    ws: {
      connected: boolean;
      subscribedTokens: number;
      messageCount: number;
      reconnectAttempts: number;
    };
    strategy: {
      watchedTokens: number;
      triggersCount: number;
      evaluatedTokens: number;
    };
    btcConnected: boolean;
    btcPrice: number | null;
    momentum: {
      direction: "UP" | "DOWN" | "NEUTRAL";
      changeUsd: number;
      lookbackMs: number;
      hasData: boolean;
    } | null;
  };
  liveMarkets: LiveMarketInfo[];
  btcPrice: { price: number; timestamp: number } | null;
  config: {
    marketWindow: string;
    entryPriceThreshold: number;
    maxEntryPrice: number;
    tradeFromWindowSeconds: number;
    startingCapital: number;
    maxPositions: number;
    minBtcDistanceUsd: number;
    stopLossPriceTrigger: number;
  };
  portfolio?: {
    lastKnownBalance: number;
    initialCapital: number;
    openPositionsValue: number;
  };
}

// ============================================
// Activity log (unified trade events + audit)
// ============================================

export type ActivityKind =
  | "TRADE_OPENED"
  | "TRADE_WIN"
  | "TRADE_LOSS"
  | "MOMENTUM_SKIP"
  | "MARKET_RESOLVED"
  | "SYSTEM"
  | "INFO"
  | "WARN"
  | "ERROR";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  ts: number; // wall-clock ms
  /** Optional trade data for TRADE_* kinds */
  trade?: Trade;
  /** PnL for TRADE_WIN / TRADE_LOSS */
  pnl?: number;
}

// ============================================
// Market types
// ============================================

export interface DiscoveredMarket {
  id: string;
  conditionId: string | null;
  slug: string | null;
  question: string | null;
  windowType: string;
  category: string;
  endDate: string | null;
  targetPrice: string | null;
  active: boolean;
  outcomes: unknown;
  clobTokenIds: unknown;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Computed by the API: ACTIVE (window open) or ENDED (window closed) */
  computedStatus?: "ACTIVE" | "ENDED";
}

// ============================================
// Performance types
// ============================================

export interface PerformanceMetrics {
  period: string;
  totalPnl: string;
  totalDeployed: string;
  roi: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  avgWin: string;
  avgLoss: string;
  largestWin: string;
  largestLoss: string;
  totalFees: string;
  avgBtcDistance: string;
  openPositions: number;
  unrealizedPnl: string;
  lastKnownBalance: string;
  initialCapital: string;
  openPositionsValue: string;
}

export interface PortfolioState {
  initialCapital: number;
  lastKnownBalance: number;
  openPositionsValue: number;
  portfolioValue: number;
  roi: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Monte Carlo analysis types
// ============================================

export interface MonteCarloHistogram {
  min: number;
  max: number;
  count: number;
}

export interface EquityCurvePoint {
  tradeIndex: number;
  balance: number;
}

export interface PercentileEquityCurve {
  percentile: number;
  curve: EquityCurvePoint[];
}

export interface MonteCarloResult {
  config: { simulations: number; tradesPerSim: number };
  historical: {
    totalSettled: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinPnl: number;
    avgLossPnl: number;
    avgWinPct: number;
    avgLossPct: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;
    expectancy: number;
  };
  distribution: {
    histogram: MonteCarloHistogram[];
    percentiles: {
      p5: number;
      p25: number;
      p50: number;
      p75: number;
      p95: number;
    };
    mean: number;
    stdDev: number;
    profitProbability: number;
    ruinProbability: number;
  };
  equityCurves: PercentileEquityCurve[];
  drawdown: { median: number; p95: number; worst: number };
  startingCapital: number;
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
// WebSocket types
// ============================================

export interface WsMessage {
  type:
    | "systemState"
    | "tradeOpened"
    | "tradeResolved"
    | "btcPriceUpdate"
    | "pong";
  data?: unknown;
}

// ============================================
// UI helper types
// ============================================

export type MarketWindow = "5M" | "15M" | "1H" | "4H" | "1D";

export const MARKET_WINDOW_LABELS: Record<MarketWindow, string> = {
  "5M": "BTC 5-MIN",
  "15M": "BTC 15-MIN",
  "1H": "BTC 1-HOUR",
  "4H": "BTC 4-HOUR",
  "1D": "BTC 1-DAY",
};
