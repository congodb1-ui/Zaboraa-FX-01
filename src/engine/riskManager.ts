import { SymbolName, RiskSettings, OrderRecord, Position } from '../types/forex';
import { calculatePipValue, SYMBOL_SPECS } from '../services/marketData';
import { insertRiskEvent, getNoNewOrdersFlag, getOpenPositionsDb } from '../services/db';

export interface RiskEvaluationContext {
  account: {
    balance: number;
    equity: number;
    peakEquity?: number;
    login: string;
    mode: 'DEMO' | 'REAL' | 'PAPER' | string;
  };
  currentSpreadPips: number;
  openPositions?: Position[];
  todayRealizedLossUSD?: number;
  evaluationTimeUtc?: Date;
  allowedSymbols?: SymbolName[];
  newsBlackoutHook?: (symbol: SymbolName, timestampUtc: number) => { isBlackout: boolean; eventTitle?: string };
}

export interface RiskCheckResult {
  allowed: boolean;
  reasonCode: string;
  details: string;
  evaluatedRule?: string;
  riskAmountUSD?: number;
  riskPct?: number;
}

export const DEFAULT_ALLOWED_SYMBOLS: SymbolName[] = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

/**
 * Authoritative Risk Manager
 * Evaluates orders against all configured risk rules and logs every decision to risk_events.
 */
export function evaluateOrderRisk(
  order: {
    symbol: SymbolName;
    side: 'BUY' | 'SELL';
    volume: number;
    price: number;
    sl: number;
    tp?: number;
    botId?: string;
    magicNumber?: number;
  },
  riskSettings: RiskSettings,
  context: RiskEvaluationContext
): RiskCheckResult {
  const evalTime = context.evaluationTimeUtc || new Date();
  const botId = order.botId || 'manual';
  const spec = SYMBOL_SPECS[order.symbol];

  // Helper to log risk event
  const logDecision = (allowed: boolean, reasonCode: string, details: string, severity: 'INFO' | 'WARN' | 'CRITICAL') => {
    try {
      insertRiskEvent({
        id: `risk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        actor: 'RiskManager',
        action: allowed ? 'ORDER_PERMITTED' : 'ORDER_REJECTED',
        entity: `${order.symbol} ${order.side} ${order.volume}L (Bot: ${botId})`,
        details: `[${reasonCode}] ${details}`,
        severity,
        status: allowed ? 'ALLOWED' : 'BLOCKED',
      });
    } catch (_) {
      // In-memory or test fallback
    }
  };

  // 1. Emergency Kill Switch / Halt Flag
  if (getNoNewOrdersFlag()) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_KILL_SWITCH_ACTIVE',
      details: 'Emergency Halt (no_new_orders) is engaged. All trading is suspended.',
      evaluatedRule: 'killSwitch',
    };
    logDecision(false, res.reasonCode, res.details, 'CRITICAL');
    return res;
  }

  // 2. Mandatory Stop-Loss Validation
  if (!order.sl || typeof order.sl !== 'number' || order.sl <= 0) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_NO_STOP_LOSS',
      details: 'Mandatory Stop-Loss is missing or non-positive. Broker-side protection required.',
      evaluatedRule: 'mandatoryStopLoss',
    };
    logDecision(false, res.reasonCode, res.details, 'CRITICAL');
    return res;
  }

  // Check SL direction
  if (order.side === 'BUY' && order.sl >= order.price) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_INVALID_STOP_LOSS_SIDE',
      details: `BUY stop-loss (${order.sl}) must be below entry price (${order.price}).`,
      evaluatedRule: 'mandatoryStopLoss',
    };
    logDecision(false, res.reasonCode, res.details, 'CRITICAL');
    return res;
  }
  if (order.side === 'SELL' && order.sl <= order.price) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_INVALID_STOP_LOSS_SIDE',
      details: `SELL stop-loss (${order.sl}) must be above entry price (${order.price}).`,
      evaluatedRule: 'mandatoryStopLoss',
    };
    logDecision(false, res.reasonCode, res.details, 'CRITICAL');
    return res;
  }

  // 3. Allowed Symbols Filter
  const allowedSymbols = context.allowedSymbols || DEFAULT_ALLOWED_SYMBOLS;
  if (!allowedSymbols.includes(order.symbol)) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_SYMBOL_DISALLOWED',
      details: `Symbol ${order.symbol} is not in the allowed trade universe (${allowedSymbols.join(', ')}).`,
      evaluatedRule: 'allowedSymbols',
    };
    logDecision(false, res.reasonCode, res.details, 'WARN');
    return res;
  }

  // 4. Max Lot Size Rule
  const maxLot = riskSettings.maxLotSize || 1.0;
  if (order.volume > maxLot) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_MAX_LOT_EXCEEDED',
      details: `Order lot size (${order.volume}) exceeds maximum permitted lot size (${maxLot}).`,
      evaluatedRule: 'maxLotSize',
    };
    logDecision(false, res.reasonCode, res.details, 'WARN');
    return res;
  }

  // 5. Max Spread Filter
  const maxSpread = riskSettings.maxAllowedSpreadPips || 2.5;
  if (context.currentSpreadPips > maxSpread) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_SPREAD_EXCEEDED',
      details: `Current spread (${context.currentSpreadPips} pips) exceeds maximum allowed spread (${maxSpread} pips).`,
      evaluatedRule: 'maxAllowedSpreadPips',
    };
    logDecision(false, res.reasonCode, res.details, 'WARN');
    return res;
  }

  // 6. Trading Hours Filter
  if (riskSettings.enableTradingHoursFilter) {
    const utcHour = evalTime.getUTCHours();
    const startHour = riskSettings.tradingStartHourUTC ?? 1;
    const endHour = riskSettings.tradingEndHourUTC ?? 22;

    const isInside =
      startHour <= endHour
        ? utcHour >= startHour && utcHour <= endHour
        : utcHour >= startHour || utcHour <= endHour;

    if (!isInside) {
      const res: RiskCheckResult = {
        allowed: false,
        reasonCode: 'RULE_TRADING_HOURS_BLOCKED',
        details: `Current UTC hour (${utcHour}:00) is outside allowed trading window (${startHour}:00 - ${endHour}:00 UTC).`,
        evaluatedRule: 'tradingHours',
      };
      logDecision(false, res.reasonCode, res.details, 'WARN');
      return res;
    }
  }

  // 7. Open Positions Limits (Total and Per-Symbol)
  let openPositions: Position[] = context.openPositions || [];
  if (!context.openPositions) {
    try {
      const dbPos = getOpenPositionsDb();
      openPositions = dbPos.map((p) => ({
        id: String(p.ticket),
        ticket: p.ticket,
        symbol: p.symbol as SymbolName,
        side: p.side as 'BUY' | 'SELL',
        volume: p.volume,
        openPrice: p.openPrice,
        currentPrice: p.currentPrice ?? p.openPrice,
        sl: p.sl,
        tp: p.tp,
        pnl: p.pnl ?? 0,
        pips: 0,
        openTime: p.openTime,
        swap: p.swap ?? 0,
        commission: p.commission ?? 0,
      }));
    } catch (_) {
      openPositions = [];
    }
  }

  const maxTotalPos = riskSettings.maxOpenPositionsTotal || 5;
  if (openPositions.length >= maxTotalPos) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_MAX_POSITIONS_TOTAL_EXCEEDED',
      details: `Current open positions count (${openPositions.length}) reaches maximum total limit (${maxTotalPos}).`,
      evaluatedRule: 'maxOpenPositionsTotal',
    };
    logDecision(false, res.reasonCode, res.details, 'WARN');
    return res;
  }

  const maxSymbolPos = riskSettings.maxOpenPositionsPerSymbol || 2;
  const currentSymbolPositions = openPositions.filter((p) => p.symbol === order.symbol);
  if (currentSymbolPositions.length >= maxSymbolPos) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_MAX_POSITIONS_SYMBOL_EXCEEDED',
      details: `Current open positions for ${order.symbol} (${currentSymbolPositions.length}) reaches per-symbol limit (${maxSymbolPos}).`,
      evaluatedRule: 'maxOpenPositionsPerSymbol',
    };
    logDecision(false, res.reasonCode, res.details, 'WARN');
    return res;
  }

  // 8. Max Risk Per Trade Pct
  const pipValuePerLot = calculatePipValue(order.symbol, order.price);
  const point = spec?.point || (order.symbol === 'USDJPY' ? 0.001 : order.symbol === 'XAUUSD' ? 0.01 : 0.00001);
  const isPipsFactor = (spec?.digits === 3 || spec?.digits === 5) ? 10 : 1;
  const pipsDistance = Math.abs(order.price - order.sl) / (point * isPipsFactor);
  const riskAmountUSD = pipsDistance * pipValuePerLot * order.volume;
  const equity = Math.max(context.account.equity, 1);
  const riskPct = (riskAmountUSD / equity) * 100;

  const maxRiskPct = riskSettings.maxRiskPerTradePct || 1.5;
  if (riskPct > maxRiskPct + 0.001) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_MAX_RISK_EXCEEDED',
      details: `Calculated trade risk ($${riskAmountUSD.toFixed(2)} / ${riskPct.toFixed(2)}%) exceeds maximum allowed risk per trade (${maxRiskPct}%).`,
      evaluatedRule: 'maxRiskPerTradePct',
      riskAmountUSD,
      riskPct,
    };
    logDecision(false, res.reasonCode, res.details, 'WARN');
    return res;
  }

  // 9. Max Daily Loss Limit (day boundary in UTC)
  const maxDailyLossPct = riskSettings.maxDailyLossPct || 4.0;
  const balance = Math.max(context.account.balance, 1);
  const todayRealizedLoss = context.todayRealizedLossUSD || 0;
  // Also include current unrealized floating negative pnl
  const floatingLoss = openPositions.reduce((acc, p) => (p.pnl < 0 ? acc + Math.abs(p.pnl) : acc), 0);
  const totalDailyLossSoFar = todayRealizedLoss + floatingLoss;
  const currentDailyLossPct = (totalDailyLossSoFar / balance) * 100;

  if (currentDailyLossPct >= maxDailyLossPct) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_MAX_DAILY_LOSS_EXCEEDED',
      details: `Cumulative daily loss ($${totalDailyLossSoFar.toFixed(2)} / ${currentDailyLossPct.toFixed(2)}%) exceeds max daily loss threshold (${maxDailyLossPct}%).`,
      evaluatedRule: 'maxDailyLossPct',
    };
    logDecision(false, res.reasonCode, res.details, 'CRITICAL');
    return res;
  }

  // 10. Max Total Drawdown Limit
  const peakEquity = context.account.peakEquity || Math.max(context.account.balance, context.account.equity);
  const currentDrawdownPct = peakEquity > 0 ? ((peakEquity - context.account.equity) / peakEquity) * 100 : 0;
  const maxDrawdownLimit = riskSettings.maxTotalDrawdownPct || 10.0;

  if (currentDrawdownPct >= maxDrawdownLimit) {
    const res: RiskCheckResult = {
      allowed: false,
      reasonCode: 'RULE_MAX_DRAWDOWN_EXCEEDED',
      details: `Current account drawdown (${currentDrawdownPct.toFixed(2)}%) reaches max drawdown limit (${maxDrawdownLimit}%).`,
      evaluatedRule: 'maxTotalDrawdownPct',
    };
    logDecision(false, res.reasonCode, res.details, 'CRITICAL');
    return res;
  }

  // 11. News Blackout Hook (Stage 5B integration point)
  if (context.newsBlackoutHook) {
    const barSec = Math.floor(evalTime.getTime() / 1000);
    const blackoutCheck = context.newsBlackoutHook(order.symbol, barSec);
    if (blackoutCheck.isBlackout) {
      const res: RiskCheckResult = {
        allowed: false,
        reasonCode: 'RULE_NEWS_BLACKOUT',
        details: `Trading blocked: high-impact news blackout window active for ${order.symbol} (${blackoutCheck.eventTitle || 'Scheduled Event'}).`,
        evaluatedRule: 'newsBlackoutHook',
      };
      logDecision(false, res.reasonCode, res.details, 'WARN');
      return res;
    }
  }

  // All risk checks passed
  const passResult: RiskCheckResult = {
    allowed: true,
    reasonCode: 'RISK_CHECK_PASSED',
    details: `All risk firewall rules passed. Risk: $${riskAmountUSD.toFixed(2)} (${riskPct.toFixed(2)}%), lot: ${order.volume}.`,
    riskAmountUSD,
    riskPct,
  };
  logDecision(true, passResult.reasonCode, passResult.details, 'INFO');
  return passResult;
}
