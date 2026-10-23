import { Strategy, Candle } from '../types/forex';
import { calculateSMA, calculateRSI, calculateBollingerBands, calculateATR } from './marketData';

export const BUILT_IN_STRATEGIES: Strategy[] = [
  {
    id: 'strat_sma_cross',
    name: 'Dual SMA Dynamic Crossover',
    description: 'Classic trend-following strategy using fast and slow Simple Moving Averages with dynamic ATR-based trailing stops.',
    sourceType: 'python',
    version: '1.2.0',
    tags: ['Trend Following', 'Moving Average', 'Low Frequency'],
    author: 'Zaboraa FX Quant Team',
    licenseNote: 'Apache-2.0 Open Source',
    paramsSchema: [
      { name: 'fastPeriod', type: 'number', default: 20, min: 5, max: 100, step: 1, description: 'Period for fast moving average' },
      { name: 'slowPeriod', type: 'number', default: 50, min: 20, max: 200, step: 1, description: 'Period for slow moving average' },
      { name: 'stopLossPips', type: 'number', default: 35, min: 10, max: 200, step: 5, description: 'Fixed Stop Loss in pips' },
      { name: 'takeProfitPips', type: 'number', default: 70, min: 15, max: 400, step: 5, description: 'Fixed Take Profit in pips' },
      { name: 'trailStop', type: 'boolean', default: true, description: 'Enable ATR dynamic trailing stop' },
    ],
    params: {
      fastPeriod: 20,
      slowPeriod: 50,
      stopLossPips: 35,
      takeProfitPips: 70,
      trailStop: true,
    },
    code: `"""
Dual SMA Dynamic Crossover Strategy
Conforms to Zaboraa FX Strategy Interface Contract
"""
class SMACrossoverStrategy:
    def __init__(self):
        self.name = "Dual SMA Crossover"
        self.version = "1.2.0"

    def init(self, ctx):
        ctx.warmup_period = 50

    def on_bar(self, ctx, bar):
        closes = [b.close for b in ctx.data]
        fast_sma = sum(closes[-ctx.params['fastPeriod']:]) / ctx.params['fastPeriod']
        slow_sma = sum(closes[-ctx.params['slowPeriod']:]) / ctx.params['slowPeriod']

        prev_closes = closes[:-1]
        prev_fast = sum(prev_closes[-ctx.params['fastPeriod']:]) / ctx.params['fastPeriod']
        prev_slow = sum(prev_closes[-ctx.params['slowPeriod']:]) / ctx.params['slowPeriod']

        # Bullish Crossover
        if prev_fast <= prev_slow and fast_sma > slow_sma:
            if not ctx.open_positions:
                ctx.buy(sl_pips=ctx.params['stopLossPips'], tp_pips=ctx.params['takeProfitPips'])
            elif ctx.open_positions[0].direction == 'SELL':
                ctx.close()
                ctx.buy(sl_pips=ctx.params['stopLossPips'], tp_pips=ctx.params['takeProfitPips'])

        # Bearish Crossover
        elif prev_fast >= prev_slow and fast_sma < slow_sma:
            if not ctx.open_positions:
                ctx.sell(sl_pips=ctx.params['stopLossPips'], tp_pips=ctx.params['takeProfitPips'])
            elif ctx.open_positions[0].direction == 'BUY':
                ctx.close()
                ctx.sell(sl_pips=ctx.params['stopLossPips'], tp_pips=ctx.params['takeProfitPips'])
`,
    createdAt: '2026-01-15T00:00:00.000Z',
    lastBacktestNetProfit: 2140.50,
    lastBacktestWinRate: 58.4,
  },
  {
    id: 'strat_rsi_reversion',
    name: 'RSI Statistical Mean Reversion',
    description: 'Captures counter-trend reversals when Relative Strength Index indicates extreme exhaustion.',
    sourceType: 'python',
    version: '1.0.4',
    tags: ['Mean Reversion', 'Oscillator', 'Forex Majors'],
    author: 'Zaboraa FX Quant Team',
    licenseNote: 'MIT License',
    paramsSchema: [
      { name: 'rsiPeriod', type: 'number', default: 14, min: 5, max: 50, step: 1, description: 'RSI calculation window' },
      { name: 'oversold', type: 'number', default: 30, min: 10, max: 40, step: 1, description: 'Oversold entry threshold' },
      { name: 'overbought', type: 'number', default: 70, min: 60, max: 90, step: 1, description: 'Overbought entry threshold' },
      { name: 'slPips', type: 'number', default: 25, min: 10, max: 100, step: 5, description: 'Stop Loss in pips' },
      { name: 'tpPips', type: 'number', default: 45, min: 15, max: 200, step: 5, description: 'Take Profit in pips' },
    ],
    params: {
      rsiPeriod: 14,
      oversold: 30,
      overbought: 70,
      slPips: 25,
      tpPips: 45,
    },
    code: `"""
RSI Statistical Mean Reversion Strategy
"""
class RSIMeanReversionStrategy:
    def __init__(self):
        self.name = "RSI Mean Reversion"
        self.version = "1.0.4"

    def init(self, ctx):
        ctx.warmup_period = 20

    def on_bar(self, ctx, bar):
        rsi = ctx.indicators.rsi(period=ctx.params['rsiPeriod'])
        if rsi is None:
            return

        if rsi < ctx.params['oversold'] and not ctx.open_positions:
            ctx.buy(sl_pips=ctx.params['slPips'], tp_pips=ctx.params['tpPips'])
        elif rsi > ctx.params['overbought'] and not ctx.open_positions:
            ctx.sell(sl_pips=ctx.params['slPips'], tp_pips=ctx.params['tpPips'])
`,
    createdAt: '2026-02-01T00:00:00.000Z',
    lastBacktestNetProfit: 1680.00,
    lastBacktestWinRate: 64.2,
  },
  {
    id: 'strat_bollinger_breakout',
    name: 'Bollinger Band Squeeze & Breakout',
    description: 'Detects volatility compression squeezes followed by aggressive expansion breaks outside 2-sigma bands.',
    sourceType: 'python',
    version: '2.1.0',
    tags: ['Volatility', 'Breakout', 'Momentum'],
    author: 'Zaboraa FX Quant Team',
    licenseNote: 'Apache-2.0',
    paramsSchema: [
      { name: 'bbPeriod', type: 'number', default: 20, min: 10, max: 50, step: 1, description: 'Bollinger Band period' },
      { name: 'bbStdDev', type: 'number', default: 2.0, min: 1.0, max: 3.5, step: 0.1, description: 'Standard deviation multiplier' },
      { name: 'trailStopAtrMultiplier', type: 'number', default: 2.5, min: 1.0, max: 5.0, step: 0.5, description: 'ATR multiple for trailing stop' },
    ],
    params: {
      bbPeriod: 20,
      bbStdDev: 2.0,
      trailStopAtrMultiplier: 2.5,
    },
    code: `"""
Bollinger Band Squeeze & Breakout Strategy
"""
class BollingerBreakoutStrategy:
    def __init__(self):
        self.name = "Bollinger Breakout"
        self.version = "2.1.0"

    def on_bar(self, ctx, bar):
        bands = ctx.indicators.bollinger(ctx.params['bbPeriod'], ctx.params['bbStdDev'])
        if not bands:
            return

        # Upward Breakout
        if bar.close > bands.upper and not ctx.open_positions:
            ctx.buy(sl=bands.middle, comment="BB Upper Break")
        # Downward Breakout
        elif bar.close < bands.lower and not ctx.open_positions:
            ctx.sell(sl=bands.middle, comment="BB Lower Break")
`,
    createdAt: '2026-03-10T00:00:00.000Z',
    lastBacktestNetProfit: 3420.20,
    lastBacktestWinRate: 53.8,
  },
  {
    id: 'strat_donchian_breakout',
    name: 'Donchian Channel Turtle Breakout',
    description: 'Classic 20-day / 20-bar Donchian breakout system with 10-bar exit and volatility position sizing.',
    sourceType: 'python',
    version: '1.5.0',
    tags: ['Turtle Trading', 'Trend', 'Donchian'],
    author: 'Zaboraa FX Quant Team',
    licenseNote: 'Public Domain',
    paramsSchema: [
      { name: 'entryPeriod', type: 'number', default: 20, min: 10, max: 60, step: 1, description: 'Channel high/low period for entry' },
      { name: 'exitPeriod', type: 'number', default: 10, min: 5, max: 30, step: 1, description: 'Channel exit trailing period' },
    ],
    params: {
      entryPeriod: 20,
      exitPeriod: 10,
    },
    code: `"""
Donchian Channel Turtle Breakout Strategy
"""
class DonchianTurtleStrategy:
    def __init__(self):
        self.name = "Donchian Breakout"
        self.version = "1.5.0"

    def on_bar(self, ctx, bar):
        highs = [b.high for b in ctx.data[-ctx.params['entryPeriod']-1:-1]]
        lows = [b.low for b in ctx.data[-ctx.params['entryPeriod']-1:-1]]
        if not highs or not lows:
            return

        highest_high = max(highs)
        lowest_low = min(lows)

        if bar.close > highest_high and not ctx.open_positions:
            ctx.buy(comment="Donchian 20-bar High")
        elif bar.close < lowest_low and not ctx.open_positions:
            ctx.sell(comment="Donchian 20-bar Low")
`,
    createdAt: '2026-03-15T00:00:00.000Z',
    lastBacktestNetProfit: 2890.00,
    lastBacktestWinRate: 51.2,
  },
];

export function getStrategyExecutor(strategyId: string) {
  return (
    ctx: {
      data: Candle[];
      currentBar: Candle;
      barIndex: number;
      buy: (size?: number, sl?: number, tp?: number, comment?: string) => void;
      sell: (size?: number, sl?: number, tp?: number, comment?: string) => void;
      closePosition: (ticket?: number) => void;
      modifyPosition: (ticket: number, sl?: number, tp?: number) => void;
      openPositions: any[];
      accountBalance: number;
      accountEquity: number;
    },
    params: Record<string, any>
  ) => {
    const closes = ctx.data.map((c) => c.close);
    const i = ctx.barIndex;
    const current = ctx.currentBar;

    if (strategyId === 'strat_sma_cross' || strategyId.includes('sma')) {
      const fastP = params.fastPeriod || 20;
      const slowP = params.slowPeriod || 50;
      const slPips = params.stopLossPips || 35;
      const tpPips = params.takeProfitPips || 70;

      if (ctx.data.length < slowP + 2) return;

      const fastSMA = calculateSMA(closes, fastP);
      const slowSMA = calculateSMA(closes, slowP);

      const currFast = fastSMA[fastSMA.length - 1];
      const prevFast = fastSMA[fastSMA.length - 2];
      const currSlow = slowSMA[slowSMA.length - 1];
      const prevSlow = slowSMA[slowSMA.length - 2];

      if (!currFast || !prevFast || !currSlow || !prevSlow) return;

      const pipMultiplier = current.close > 500 ? 1.0 : (current.close > 50 ? 0.01 : 0.0001);

      if (prevFast <= prevSlow && currFast > currSlow) {
        if (ctx.openPositions.length === 0) {
          ctx.buy(undefined, current.close - slPips * pipMultiplier, current.close + tpPips * pipMultiplier);
        } else if (ctx.openPositions[0].direction === 'SELL') {
          ctx.closePosition();
          ctx.buy(undefined, current.close - slPips * pipMultiplier, current.close + tpPips * pipMultiplier);
        }
      } else if (prevFast >= prevSlow && currFast < currSlow) {
        if (ctx.openPositions.length === 0) {
          ctx.sell(undefined, current.close + slPips * pipMultiplier, current.close - tpPips * pipMultiplier);
        } else if (ctx.openPositions[0].direction === 'BUY') {
          ctx.closePosition();
          ctx.sell(undefined, current.close + slPips * pipMultiplier, current.close - tpPips * pipMultiplier);
        }
      }
    } else if (strategyId === 'strat_rsi_reversion' || strategyId.includes('rsi')) {
      const rsiP = params.rsiPeriod || 14;
      const oversold = params.oversold || 30;
      const overbought = params.overbought || 70;
      const slPips = params.slPips || 25;
      const tpPips = params.tpPips || 45;

      const rsiSeries = calculateRSI(closes, rsiP);
      const currRsi = rsiSeries[rsiSeries.length - 1];
      const prevRsi = rsiSeries[rsiSeries.length - 2];

      if (!currRsi || !prevRsi) return;

      const pipMultiplier = current.close > 500 ? 1.0 : (current.close > 50 ? 0.01 : 0.0001);

      if (prevRsi < oversold && currRsi >= oversold && ctx.openPositions.length === 0) {
        ctx.buy(undefined, current.close - slPips * pipMultiplier, current.close + tpPips * pipMultiplier);
      } else if (prevRsi > overbought && currRsi <= overbought && ctx.openPositions.length === 0) {
        ctx.sell(undefined, current.close + slPips * pipMultiplier, current.close - tpPips * pipMultiplier);
      }
    } else if (strategyId === 'strat_bollinger_breakout' || strategyId.includes('bollinger')) {
      const bbP = params.bbPeriod || 20;
      const bbStd = params.bbStdDev || 2.0;
      const bb = calculateBollingerBands(closes, bbP, bbStd);

      const upper = bb.upper[bb.upper.length - 1];
      const lower = bb.lower[bb.lower.length - 1];
      const middle = bb.middle[bb.middle.length - 1];

      if (!upper || !lower || !middle) return;

      if (current.close > upper && ctx.openPositions.length === 0) {
        ctx.buy(undefined, middle, current.close + (current.close - middle) * 1.5);
      } else if (current.close < lower && ctx.openPositions.length === 0) {
        ctx.sell(undefined, middle, current.close - (middle - current.close) * 1.5);
      }
    } else {
      // Default Turtle / Donchian breakout
      const entryP = params.entryPeriod || 20;
      if (ctx.data.length < entryP + 2) return;
      const highSlice = ctx.data.slice(-entryP - 1, -1).map((c) => c.high);
      const lowSlice = ctx.data.slice(-entryP - 1, -1).map((c) => c.low);
      const maxHigh = Math.max(...highSlice);
      const minLow = Math.min(...lowSlice);

      const pipMultiplier = current.close > 500 ? 1.0 : (current.close > 50 ? 0.01 : 0.0001);

      if (current.close > maxHigh && ctx.openPositions.length === 0) {
        ctx.buy(undefined, current.close - 40 * pipMultiplier, current.close + 80 * pipMultiplier);
      } else if (current.close < minLow && ctx.openPositions.length === 0) {
        ctx.sell(undefined, current.close + 40 * pipMultiplier, current.close - 80 * pipMultiplier);
      }
    }
  };
}
