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
  monteCarlo: MonteCarloConfidence[];
  overfittingWarningScore: number;
  overfittingNotes: string[];
  aiSummary?: string;
  createdAt: string;
}

export type BotMode = 'PAPER' | 'DEMO_LIVE' | 'LIVE';
export type BotStatus = 'RUNNING' | 'PAUSED' | 'STOPPED';

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
}
