export type SymbolName = 'EURUSD' | 'GBPUSD' | 'USDJPY' | 'XAUUSD';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D1';

export interface SymbolSpec {
  symbol: SymbolName;
  displayName: string;
  digits: number;
  point: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  stepVolume: number;
  spreadPips: number;
  bid: number;
  ask: number;
  swapLong: number; // in USD or points per lot/day
  swapShort: number;
  currency: string;
  pipValuePerLotUSD: number; // $10 for EUR/USD, dynamic for USD/JPY, $100 for XAU/USD
  tripleSwapDay?: number; // 0=Sun, 1=Mon, 2=Tue, 3=Wed (standard for FX), 4=Thu, 5=Fri
}

export interface Candle {
  time: number; // timestamp in seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number; // in pips
}

export type ProvenanceType = 'MT5_BRIDGE' | 'USER_CSV' | 'SIMULATED';

export interface DataProvenance {
  source: ProvenanceType;
  label: 'MT5 BRIDGE' | 'USER CSV' | 'SIMULATED';
  details: string;
  brokerServer?: string;
  accountType?: 'DEMO' | 'REAL';
  fileName?: string;
  importDate?: string;
  utcOffsetHours: number;
  isResearchEligible: boolean;
}

export interface DatasetRecord {
  id: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  year?: number;
  rowCount: number;
  fileSizeKB: number;
  firstDate: string;
  lastDate: string;
  provenance: DataProvenance;
  candles: Candle[];
  qualityScore: number;
  lastUpdated: string;
}

export type AccountMode = 'DEMO' | 'LIVE';

export interface BrokerAccount {
  id: string;
  label: string;
  broker: 'Exness';
  server: string; // e.g. "Exness-MT5Trial9"
  login: string;  // e.g. "50192834"
  mode: AccountMode;
  symbolSuffix: string; // "m" for Standard
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  currency: string;
  isConnected: boolean;
  isSimulated: boolean;
  lastHeartbeat: string;
  utcOffsetHours: number;
}

export interface Position {
  id: string;
  ticket: number;
  symbol: SymbolName;
  side: 'BUY' | 'SELL';
  volume: number; // lots
  openPrice: number;
  currentPrice: number;
  sl?: number;
  tp?: number;
  pnl: number;
  pips: number;
  openTime: number;
  swap: number;
  commission: number;
  comment?: string;
  magicNumber?: number;
}

export interface PendingOrder {
  id: string;
  ticket: number;
  symbol: SymbolName;
  type: 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
  volume: number;
  price: number;
  sl?: number;
  tp?: number;
  placedTime: number;
  comment?: string;
}

export interface StrategyParamSchema {
  name: string;
  type: 'number' | 'boolean' | 'string' | 'select';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description: string;
}

export interface StrategyInitContext {
  warmupPeriod: number;
  params: Record<string, any>;
}

export interface StrategyExecutionContext {
  data: Candle[];
  currentBar: Candle;
  barIndex: number;
  openPositions: Position[];
  accountBalance: number;
  accountEquity: number;
  params: Record<string, any>;
  buy: (size?: number, sl?: number, tp?: number, comment?: string) => void;
  sell: (size?: number, sl?: number, tp?: number, comment?: string) => void;
  close: (ticket?: number) => void;
  modify: (ticket: number, sl?: number, tp?: number) => void;
}

export interface StrategyContract {
  name: string;
  version: string;
  paramsSchema: StrategyParamSchema[];
  init: (ctx: StrategyInitContext) => void;
  onBar: (ctx: StrategyExecutionContext, bar: Candle) => void;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  sourceType: 'typescript' | 'pine_converted';
  code: string; // Runnable TypeScript strategy conforming to StrategyContract
  pineSource?: string;
  paramsSchema: StrategyParamSchema[];
  params: Record<string, any>;
  version: string;
  author?: string;
  licenseNote?: string;
  tags: string[];
  createdAt: string;
  lastBacktestNetProfit?: number;
  lastBacktestWinRate?: number;
}

export interface CostModel {
  spreadMode: 'fixed' | 'historical';
  fixedSpreadPips: number;
  commissionPerLotRoundTurn: number; // e.g. $7 per lot
  slippagePips: number;
  includeSwap: boolean;
}

export interface BacktestConfig {
  strategyId: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialBalance: number;
  leverage: number;
  lotSize: number;
  positionSizing: 'fixed_lot' | 'risk_pct' | 'volatility_atr';
  riskPctPerTrade: number;
  costModel: CostModel;
  params: Record<string, any>;
  provenance: DataProvenance;
}

export interface BacktestTrade {
  ticket: number;
  entryTime: number;
  exitTime: number;
  symbol: SymbolName;
  direction: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  exitPrice: number;
  sl?: number;
  tp?: number;
  pnl: number;
  pips: number;
  durationMinutes: number;
  costs: {
    spread: number;
    commission: number;
    swap: number;
    slippage: number;
  };
  mae: number;
  mfe: number;
  exitReason: 'TP' | 'SL' | 'SIGNAL' | 'END_OF_DATA';
}

export interface MonthlyReturn {
  year: number;
  months: Record<number, number>;
  totalYearReturn: number;
}

export interface MonteCarloConfidence {
  percentile: number;
  maxDrawdownPct: number;
  finalEquity: number;
}

export interface BacktestResult {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  period: string;
  barCount: number;
  provenance: DataProvenance;
  initialBalance: number;
  finalBalance: number;
  netProfit: number;
  returnPct: number;
  cagr: number;

  profitFactor: number;
  expectancy: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  tradesPerMonth: number;
  exposureTimePct: number;

  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  recoveryFactor: number;
  maxDrawdownAmount: number;
  maxDrawdownPct: number;
  maxDrawdownDurationDays: number;
  avgDrawdownPct: number;
  ulcerIndex: number;
  valueAtRisk95: number;

  totalSpreadCost: number;
  totalCommission: number;
  totalSwap: number;
  totalSlippageCost: number;

  equityCurve: { time: number; equity: number; drawdownPct: number; balance: number }[];
  trades: BacktestTrade[];
  monthlyReturns: MonthlyReturn[];
  hourlyReturns?: { hour: number; pnl: number; tradesCount: number }[];
  weekdayReturns?: { weekday: string; pnl: number; tradesCount: number }[];
  monteCarlo: MonteCarloConfidence[];
  mcSeed?: number;
  overfittingWarningScore: number;
  overfittingNotes: string[];
  overfittingLabel?: 'Lower Estimated Overfitting Risk' | 'Moderate Empirical Divergence' | 'Elevated Overfitting Indication';
  aiSummary?: string;
  createdAt: string;
}

export type BotMode = 'PAPER' | 'DEMO_LIVE' | 'LIVE';
export type BotStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR';

export interface Bot {
  id: string;
  name: string;
  strategyId: string;
  strategyName: string;
  accountId: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  mode: BotMode;
  status: BotStatus;
  params: Record<string, any>;
  riskLimits: {
    maxRiskPctPerTrade: number;
    maxLotSize: number;
    maxOpenPositions: number;
    maxDailyLossUSD: number;
    stopLossPips: number;
    takeProfitPips: number;
    maxSpreadPips: number;
  };
  todayPnl: number;
  totalPnl: number;
  tradesCount: number;
  lastSignal?: {
    action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD';
    time: string;
    price: number;
    reason: string;
  };
  lastHeartbeat: string;
  logs: { time: string; level: 'INFO' | 'WARN' | 'ERROR'; message: string }[];
}

export interface RiskSettings {
  maxRiskPerTradePct: number;
  maxLotSize: number;
  maxOpenPositionsTotal: number;
  maxOpenPositionsPerSymbol: number;
  maxDailyLossPct: number;
  maxTotalDrawdownPct: number;
  maxAllowedSpreadPips: number;
  enableTradingHoursFilter: boolean;
  tradingStartHourUTC: number;
  tradingEndHourUTC: number;
  killSwitchAction: 'CLOSE_ALL_AND_HALT' | 'CANCEL_PENDING_ONLY';
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity: string;
  details: string;
  status: 'SUCCESS' | 'WARNING' | 'CRITICAL';
}

export interface JournalEntry {
  id: string;
  tradeTicket: number;
  symbol: SymbolName;
  pnl: number;
  tags: string[];
  notes: string;
  rating: number;
  createdAt: string;
}

export interface PineConversionResponse {
  typescriptCode: string;
  detectedParams: StrategyParamSchema[];
  warnings: string[];
  lookaheadDetected: boolean;
  repaintingDetected: boolean;
  explanation: string;
  author?: string;
  sourceUrl?: string;
  license?: string;
  strategySettings?: {
    commissionValue?: number;
    slippage?: number;
    pyramiding?: number;
    defaultQtyValue?: number;
  };
}

export type OrderStatus =
  | 'PENDING_BROKER'
  | 'SENT'
  | 'FILLED'
  | 'REJECTED'
  | 'UNKNOWN'
  | 'CANCELLED'
  | 'SIMULATED'
  | 'FAILED';

export interface OrderRecord {
  id: string;
  idempotencyKey: string;
  botId: string;
  magicNumber: number;
  ticket?: number;
  symbol: SymbolName;
  side: 'BUY' | 'SELL';
  volume: number;
  intentPrice: number;
  fillPrice?: number;
  sl: number; // Mandatory Stop-Loss
  tp?: number;
  status: OrderStatus;
  comment: string;
  createdAt: string;
  filledAt?: string;
  errorReason?: string;
}

export interface LiveTokenRecord {
  token: string;
  botId: string;
  accountLogin: string;
  riskHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export interface OptimizationParamRange {
  name: string;
  min: number;
  max: number;
  step: number;
}

export interface OptimizationConfig {
  strategyId: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  inSamplePct: number; // e.g. 70
  searchType: 'grid' | 'random';
  randomTrials?: number;
  seed?: number;
  paramRanges: OptimizationParamRange[];
  initialBalance: number;
  costModel: CostModel;
}

export interface OptimizationTrial {
  id: string;
  params: Record<string, any>;
  isSharpe: number;
  oosSharpe: number;
  isNetProfit: number;
  oosNetProfit: number;
  isTrades: number;
  oosTrades: number;
  isWinRate: number;
  oosWinRate: number;
  maxDrawdownPct: number;
  overfittingScore: number;
  overfittingLabel: 'Lower Estimated Overfitting Risk' | 'Moderate Empirical Divergence' | 'Elevated Overfitting Indication';
  overfittingNotes: string[];
}

export interface OptimizationReport {
  id: string;
  strategyId: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  totalTrials: number;
  trials: OptimizationTrial[];
  bestTrial?: OptimizationTrial;
  walkForwardDegradationRatio: number;
  overallOverfittingScore: number;
  paramXName: string;
  paramYName: string;
  metric: 'oosSharpe' | 'oosNetProfit' | 'isSharpe';
  heatmapMatrix: { x: number; y: number; value: number }[];
  seed: number;
  createdAt: string;
}

export interface MonteCarloAnalysis {
  seed: number;
  trialsCount: number;
  medianMaxDrawdownPct: number;
  percentile95MaxDrawdownPct: number;
  medianFinalEquity: number;
  percentile5FinalEquity: number;
  ruinProbabilityPct: number;
  reshuffledCurves: { timeIndex: number; equity: number }[][];
  bootstrappedCurves: { timeIndex: number; equity: number }[][];
}

export interface TradingViewTradeRecord {
  tradeNumber: number;
  type: 'Entry Long' | 'Exit Long' | 'Entry Short' | 'Exit Short';
  signal: string;
  date: string;
  price: number;
  contracts: number;
  profitUSD?: number;
  cumProfitUSD?: number;
  runupUSD?: number;
  drawdownUSD?: number;
}

export interface TradingViewComparisonReport {
  tvTradeCount: number;
  portalTradeCount: number;
  tradeCountMatch: boolean;
  tvNetProfit: number;
  portalNetProfit: number;
  pnlDifferenceUSD: number;
  pnlDifferencePct: number;
  timingDivergenceMinutes: number;
  alignmentScore: number; // 0 - 100
  notes: string[];
}

export interface DataIntegrityReport {
  totalBars: number;
  validBars: number;
  gapCount: number;
  duplicateCount: number;
  invalidOhlcCount: number;
  gaps: { startTime: number; endTime: number; missingBarsEstimated: number }[];
  invalidBars: { time: number; reason: string }[];
  sha256Hash: string;
  qualityScore: number; // 0 - 100
}

