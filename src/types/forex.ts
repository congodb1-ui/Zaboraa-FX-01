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
  swapLong: number; // in points or USD/lot
  swapShort: number;
  currency: string;
  pipValuePerLotUSD: number; // e.g. 10 for EURUSD, dynamic for USDJPY, 100 for XAUUSD
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

export interface Tick {
  time: number; // in milliseconds
  bid: number;
  ask: number;
  spread: number;
  volume: number;
}

export type AccountMode = 'DEMO' | 'LIVE';

export interface BrokerAccount {
  id: string;
  label: string;
  broker: 'Exness';
  server: string;
  login: string;
  mode: AccountMode;
  symbolSuffix: string; // e.g. "m" for Exness standard accounts (EURUSDm)
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  currency: string;
  isConnected: boolean;
  isSimulated: boolean;
  lastHeartbeat: string;
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

export interface Strategy {
  id: string;
  name: string;
  description: string;
  sourceType: 'python' | 'pine_converted' | 'nocode';
  code: string;
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
  slippagePips: number; // average slippage
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
}

export interface BacktestTrade {
  ticket: number;
  entryTime: number;
  exitTime: number;
  symbol: SymbolName;
  direction: 'BUY' | 'SELL';
  size: number; // lots
  entryPrice: number;
  exitPrice: number;
  sl?: number;
  tp?: number;
  pnl: number; // net USD
  pips: number;
  durationMinutes: number;
  costs: {
    spread: number;
    commission: number;
    swap: number;
    slippage: number;
  };
  mae: number; // Maximum Adverse Excursion in pips
  mfe: number; // Maximum Favorable Excursion in pips
  exitReason: 'TP' | 'SL' | 'SIGNAL' | 'END_OF_DATA';
}

export interface MonthlyReturn {
  year: number;
  months: Record<number, number>; // month index 0-11 -> return %
  totalYearReturn: number;
}

export interface MonteCarloConfidence {
  percentile: number; // 95, 99
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
  initialBalance: number;
  finalBalance: number;
  netProfit: number;
  returnPct: number;
  cagr: number;
  
  // Performance
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

  // Risk
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

  // Costs
  totalSpreadCost: number;
  totalCommission: number;
  totalSwap: number;
  totalSlippageCost: number;

  // Data & Arrays
  equityCurve: { time: number; equity: number; drawdownPct: number; balance: number }[];
  trades: BacktestTrade[];
  monthlyReturns: MonthlyReturn[];
  monteCarlo: MonteCarloConfidence[];
  overfittingWarningScore: number; // 0 to 100
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
  rating: number; // 1-5
  createdAt: string;
}

export interface PineConversionResponse {
  pythonCode: string;
  detectedParams: StrategyParamSchema[];
  warnings: string[];
  lookaheadDetected: boolean;
  repaintingDetected: boolean;
  explanation: string;
}
