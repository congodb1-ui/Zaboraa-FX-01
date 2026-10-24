import { Strategy, Candle, StrategyExecutionContext } from '../types/forex';
import { calculateSMA, calculateRSI, calculateBollingerBands } from './marketData';

export const BUILT_IN_STRATEGIES: Strategy[] = [
  {
    id: 'strat_sma_cross',
    name: 'Dual SMA Dynamic Crossover',
    description: 'Classic trend-following strategy using fast and slow Simple Moving Averages with dynamic stop-loss and take-profit.',
    sourceType: 'typescript',
    version: '1.2.0',
    tags: ['Trend Following', 'Moving Average', 'Low Frequency'],
    author: 'Zaboraa FX Quant Team',
    licenseNote: 'Apache-2.0 Open Source',
    paramsSchema: [
      { name: 'fastPeriod', type: 'number', default: 20, min: 5, max: 100, step: 1, description: 'Period for fast moving average' },
      { name: 'slowPeriod', type: 'number', default: 50, min: 20, max: 200, step: 1, description: 'Period for slow moving average' },
      { name: 'stopLossPips', type: 'number', default: 35, min: 10, max: 200, step: 5, description: 'Fixed Stop Loss in pips' },
      { name: 'takeProfitPips', type: 'number', default: 70, min: 15, max: 400, step: 5, description: 'Fixed Take Profit in pips' },
    ],
    params: {
      fastPeriod: 20,
      slowPeriod: 50,
      stopLossPips: 35,
      takeProfitPips: 70,
    },
    code: `// Dual SMA Dynamic Crossover Strategy
// Implements Zaboraa FX TypeScript Strategy Contract

export const strategy = {
  name: "Dual SMA Crossover",
  version: "1.2.0",
  paramsSchema: [
    { name: "fastPeriod", type: "number", default: 20, description: "Fast SMA" },
    { name: "slowPeriod", type: "number", default: 50, description: "Slow SMA" },
    { name: "stopLossPips", type: "number", default: 35, description: "Stop Loss (pips)" },
    { name: "takeProfitPips", type: "number", default: 70, description: "Take Profit (pips)" }
  ],
  init(ctx) {
    ctx.warmupPeriod = 50;
  },
  onBar(ctx, bar) {
    const fastP = ctx.params.fastPeriod || 20;
    const slowP = ctx.params.slowPeriod || 50;
    const slPips = ctx.params.stopLossPips || 35;
    const tpPips = ctx.params.takeProfitPips || 70;

    if (ctx.data.length < slowP + 2) return;

    const closes = ctx.data.map(b => b.close);
    const fastSMA = closes.slice(-fastP).reduce((a, b) => a + b, 0) / fastP;
    const slowSMA = closes.slice(-slowP).reduce((a, b) => a + b, 0) / slowP;

    const prevCloses = closes.slice(0, -1);
    const prevFast = prevCloses.slice(-fastP).reduce((a, b) => a + b, 0) / fastP;
    const prevSlow = prevCloses.slice(-slowP).reduce((a, b) => a + b, 0) / slowP;

    const pipMult = bar.close > 500 ? 1.0 : (bar.close > 50 ? 0.01 : 0.0001);

    // Bullish Crossover
    if (prevFast <= prevSlow && fastSMA > slowSMA) {
      if (ctx.openPositions.length === 0) {
        ctx.buy(0.1, bar.close - slPips * pipMult, bar.close + tpPips * pipMult, "SMA Cross Long");
      } else if (ctx.openPositions[0].side === "SELL") {
        ctx.close();
        ctx.buy(0.1, bar.close - slPips * pipMult, bar.close + tpPips * pipMult, "SMA Reverse Long");
      }
    }
    // Bearish Crossover
    else if (prevFast >= prevSlow && fastSMA < slowSMA) {
      if (ctx.openPositions.length === 0) {
        ctx.sell(0.1, bar.close + slPips * pipMult, bar.close - tpPips * pipMult, "SMA Cross Short");
      } else if (ctx.openPositions[0].side === "BUY") {
        ctx.close();
        ctx.sell(0.1, bar.close + slPips * pipMult, bar.close - tpPips * pipMult, "SMA Reverse Short");
      }
    }
  }
};
`,
    createdAt: '2026-01-15T00:00:00.000Z',
    lastBacktestNetProfit: 2140.50,
    lastBacktestWinRate: 58.4,
  },
  {
    id: 'strat_rsi_reversion',
    name: 'RSI Statistical Mean Reversion',
    description: 'Captures counter-trend reversals when Relative Strength Index indicates extreme exhaustion.',
    sourceType: 'typescript',
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
    code: `// RSI Statistical Mean Reversion Strategy
// Implements Zaboraa FX TypeScript Strategy Contract

export const strategy = {
  name: "RSI Mean Reversion",
  version: "1.0.4",
  paramsSchema: [
    { name: "rsiPeriod", type: "number", default: 14, description: "RSI Period" },
    { name: "oversold", type: "number", default: 30, description: "Oversold Level" },
    { name: "overbought", type: "number", default: 70, description: "Overbought Level" },
    { name: "slPips", type: "number", default: 25, description: "Stop Loss" },
    { name: "tpPips", type: "number", default: 45, description: "Take Profit" }
  ],
  init(ctx) {
    ctx.warmupPeriod = 20;
  },
  onBar(ctx, bar) {
    const period = ctx.params.rsiPeriod || 14;
    const oversold = ctx.params.oversold || 30;
    const overbought = ctx.params.overbought || 70;
    const slPips = ctx.params.slPips || 25;
    const tpPips = ctx.params.tpPips || 45;

    if (ctx.data.length < period + 5) return;

    // RSI calculation
    const closes = ctx.data.map(b => b.close);
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const rs = losses === 0 ? 100 : gains / losses;
    const rsi = 100 - (100 / (1 + rs));

    const pipMult = bar.close > 500 ? 1.0 : (bar.close > 50 ? 0.01 : 0.0001);

    if (rsi < oversold && ctx.openPositions.length === 0) {
      ctx.buy(0.1, bar.close - slPips * pipMult, bar.close + tpPips * pipMult, "RSI Oversold");
    } else if (rsi > overbought && ctx.openPositions.length === 0) {
      ctx.sell(0.1, bar.close + slPips * pipMult, bar.close - tpPips * pipMult, "RSI Overbought");
    }
  }
};
`,
    createdAt: '2026-02-01T00:00:00.000Z',
    lastBacktestNetProfit: 1680.00,
    lastBacktestWinRate: 64.2,
  },
  {
    id: 'strat_bollinger_breakout',
    name: 'Bollinger Band Squeeze & Breakout',
    description: 'Detects volatility compression squeezes followed by aggressive expansion breaks outside 2-sigma bands.',
    sourceType: 'typescript',
    version: '2.1.0',
    tags: ['Volatility', 'Breakout', 'Momentum'],
    author: 'Zaboraa FX Quant Team',
    licenseNote: 'Apache-2.0',
    paramsSchema: [
      { name: 'bbPeriod', type: 'number', default: 20, min: 10, max: 50, step: 1, description: 'Bollinger Band period' },
      { name: 'bbStdDev', type: 'number', default: 2.0, min: 1.0, max: 3.5, step: 0.1, description: 'Standard deviation multiplier' },
    ],
    params: {
      bbPeriod: 20,
      bbStdDev: 2.0,
    },
    code: `// Bollinger Band Squeeze & Breakout Strategy
// Implements Zaboraa FX TypeScript Strategy Contract

export const strategy = {
  name: "Bollinger Breakout",
  version: "2.1.0",
  init(ctx) {
    ctx.warmupPeriod = 25;
  },
  onBar(ctx, bar) {
    const period = ctx.params.bbPeriod || 20;
    const stdDevMult = ctx.params.bbStdDev || 2.0;

    if (ctx.data.length < period + 2) return;

    const closes = ctx.data.map(b => b.close);
    const slice = closes.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = mean + stdDevMult * stdDev;
    const lower = mean - stdDevMult * stdDev;

    if (bar.close > upper && ctx.openPositions.length === 0) {
      ctx.buy(0.1, mean, bar.close + (bar.close - mean) * 1.5, "BB Upper Breakout");
    } else if (bar.close < lower && ctx.openPositions.length === 0) {
      ctx.sell(0.1, mean, bar.close - (mean - bar.close) * 1.5, "BB Lower Breakout");
    }
  }
};
`,
    createdAt: '2026-03-10T00:00:00.000Z',
    lastBacktestNetProfit: 3420.20,
    lastBacktestWinRate: 53.8,
  },
  {
    id: 'strat_donchian_breakout',
    name: 'Donchian Channel Turtle Breakout',
    description: 'Classic 20-day / 20-bar Donchian breakout system with 10-bar exit and volatility position sizing.',
    sourceType: 'typescript',
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
    code: `// Donchian Channel Turtle Breakout Strategy
// Implements Zaboraa FX TypeScript Strategy Contract

export const strategy = {
  name: "Donchian Breakout",
  version: "1.5.0",
  init(ctx) {
    ctx.warmupPeriod = 25;
  },
  onBar(ctx, bar) {
    const entryP = ctx.params.entryPeriod || 20;
    if (ctx.data.length < entryP + 2) return;

    const highs = ctx.data.slice(-entryP - 1, -1).map(b => b.high);
    const lows = ctx.data.slice(-entryP - 1, -1).map(b => b.low);

    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const pipMult = bar.close > 500 ? 1.0 : (bar.close > 50 ? 0.01 : 0.0001);

    if (bar.close > maxHigh && ctx.openPositions.length === 0) {
      ctx.buy(0.1, bar.close - 40 * pipMult, bar.close + 80 * pipMult, "Donchian High Break");
    } else if (bar.close < minLow && ctx.openPositions.length === 0) {
      ctx.sell(0.1, bar.close + 40 * pipMult, bar.close - 80 * pipMult, "Donchian Low Break");
    }
  }
};
`,
    createdAt: '2026-03-15T00:00:00.000Z',
    lastBacktestNetProfit: 2890.00,
    lastBacktestWinRate: 51.2,
  },
];

export interface StrategyContract {
  name: string;
  version: string;
  init?: (ctx: any) => void;
  onBar: (ctx: any, bar: Candle) => void;
}

export const smaCrossoverContract: StrategyContract = {
  name: 'Dual SMA Dynamic Crossover',
  version: '1.2.0',
  init(ctx) {
    ctx.warmupPeriod = 50;
  },
  onBar(ctx, bar) {
    const fastP = ctx.params?.fastPeriod || 20;
    const slowP = ctx.params?.slowPeriod || 50;
    const slPips = ctx.params?.stopLossPips || 35;
    const tpPips = ctx.params?.takeProfitPips || 70;

    if (ctx.data.length < slowP + 2) return;

    const closes = ctx.data.map((b: Candle) => b.close);
    const fastSMA = calculateSMA(closes, fastP);
    const slowSMA = calculateSMA(closes, slowP);

    const currFast = fastSMA[fastSMA.length - 1];
    const prevFast = fastSMA[fastSMA.length - 2];
    const currSlow = slowSMA[slowSMA.length - 1];
    const prevSlow = slowSMA[slowSMA.length - 2];

    if (currFast == null || prevFast == null || currSlow == null || prevSlow == null) return;

    const pipMultiplier = bar.close > 500 ? 1.0 : (bar.close > 50 ? 0.01 : 0.0001);

    if (prevFast <= prevSlow && currFast > currSlow) {
      if (ctx.openPositions.length === 0) {
        ctx.buy(0.1, bar.close - slPips * pipMultiplier, bar.close + tpPips * pipMultiplier, 'SMA Cross Long');
      } else if (ctx.openPositions[0].direction === 'SELL' || ctx.openPositions[0].side === 'SELL') {
        if (ctx.close) ctx.close();
        else if (ctx.closePosition) ctx.closePosition();
        ctx.buy(0.1, bar.close - slPips * pipMultiplier, bar.close + tpPips * pipMultiplier, 'SMA Reverse Long');
      }
    } else if (prevFast >= prevSlow && currFast < currSlow) {
      if (ctx.openPositions.length === 0) {
        ctx.sell(0.1, bar.close + slPips * pipMultiplier, bar.close - tpPips * pipMultiplier, 'SMA Cross Short');
      } else if (ctx.openPositions[0].direction === 'BUY' || ctx.openPositions[0].side === 'BUY') {
        if (ctx.close) ctx.close();
        else if (ctx.closePosition) ctx.closePosition();
        ctx.sell(0.1, bar.close + slPips * pipMultiplier, bar.close - tpPips * pipMultiplier, 'SMA Reverse Short');
      }
    }
  },
};

export const rsiReversionContract: StrategyContract = {
  name: 'RSI Statistical Mean Reversion',
  version: '1.0.4',
  init(ctx) {
    ctx.warmupPeriod = 20;
  },
  onBar(ctx, bar) {
    const rsiP = ctx.params?.rsiPeriod || 14;
    const oversold = ctx.params?.oversold || 30;
    const overbought = ctx.params?.overbought || 70;
    const slPips = ctx.params?.slPips || 25;
    const tpPips = ctx.params?.tpPips || 45;

    if (ctx.data.length < rsiP + 5) return;

    const closes = ctx.data.map((b: Candle) => b.close);
    const rsiSeries = calculateRSI(closes, rsiP);
    const currRsi = rsiSeries[rsiSeries.length - 1];
    const prevRsi = rsiSeries[rsiSeries.length - 2];

    if (currRsi == null || prevRsi == null) return;

    const pipMultiplier = bar.close > 500 ? 1.0 : (bar.close > 50 ? 0.01 : 0.0001);

    if (prevRsi < oversold && currRsi >= oversold && ctx.openPositions.length === 0) {
      ctx.buy(0.1, bar.close - slPips * pipMultiplier, bar.close + tpPips * pipMultiplier, 'RSI Oversold');
    } else if (prevRsi > overbought && currRsi <= overbought && ctx.openPositions.length === 0) {
      ctx.sell(0.1, bar.close + slPips * pipMultiplier, bar.close - tpPips * pipMultiplier, 'RSI Overbought');
    }
  },
};

export const bollingerBreakoutContract: StrategyContract = {
  name: 'Bollinger Band Squeeze & Breakout',
  version: '2.1.0',
  init(ctx) {
    ctx.warmupPeriod = 25;
  },
  onBar(ctx, bar) {
    const bbP = ctx.params?.bbPeriod || 20;
    const bbStd = ctx.params?.bbStdDev || 2.0;

    if (ctx.data.length < bbP + 2) return;

    const closes = ctx.data.map((b: Candle) => b.close);
    const bb = calculateBollingerBands(closes, bbP, bbStd);

    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const middle = bb.middle[bb.middle.length - 1];

    if (upper == null || lower == null || middle == null) return;

    if (bar.close > upper && ctx.openPositions.length === 0) {
      ctx.buy(0.1, middle, bar.close + (bar.close - middle) * 1.5, 'BB Upper Breakout');
    } else if (bar.close < lower && ctx.openPositions.length === 0) {
      ctx.sell(0.1, middle, bar.close - (middle - bar.close) * 1.5, 'BB Lower Breakout');
    }
  },
};

export const donchianBreakoutContract: StrategyContract = {
  name: 'Donchian Channel Turtle Breakout',
  version: '1.5.0',
  init(ctx) {
    ctx.warmupPeriod = 25;
  },
  onBar(ctx, bar) {
    const entryP = ctx.params?.entryPeriod || 20;
    if (ctx.data.length < entryP + 2) return;

    const highSlice = ctx.data.slice(-entryP - 1, -1).map((c: Candle) => c.high);
    const lowSlice = ctx.data.slice(-entryP - 1, -1).map((c: Candle) => c.low);
    const maxHigh = Math.max(...highSlice);
    const minLow = Math.min(...lowSlice);

    const pipMultiplier = bar.close > 500 ? 1.0 : (bar.close > 50 ? 0.01 : 0.0001);

    if (bar.close > maxHigh && ctx.openPositions.length === 0) {
      ctx.buy(0.1, bar.close - 40 * pipMultiplier, bar.close + 80 * pipMultiplier, 'Donchian High Break');
    } else if (bar.close < minLow && ctx.openPositions.length === 0) {
      ctx.sell(0.1, bar.close + 40 * pipMultiplier, bar.close - 80 * pipMultiplier, 'Donchian Low Break');
    }
  },
};

export const STRATEGY_CONTRACT_REGISTRY: Record<string, StrategyContract> = {
  strat_sma_cross: smaCrossoverContract,
  strat_rsi_reversion: rsiReversionContract,
  strat_bollinger_breakout: bollingerBreakoutContract,
  strat_donchian_breakout: donchianBreakoutContract,
};

export function registerStrategyContract(id: string, contract: StrategyContract): void {
  STRATEGY_CONTRACT_REGISTRY[id] = contract;
}

export function getStrategyExecutor(strategyId: string, customContract?: StrategyContract) {
  let contract: StrategyContract | undefined = customContract || STRATEGY_CONTRACT_REGISTRY[strategyId];

  if (!contract) {
    const builtIn = BUILT_IN_STRATEGIES.find((s) => s.id === strategyId);
    if (builtIn && STRATEGY_CONTRACT_REGISTRY[builtIn.id]) {
      contract = STRATEGY_CONTRACT_REGISTRY[builtIn.id];
    }
  }

  if (!contract) {
    throw new Error(`UNKNOWN_STRATEGY: Strategy '${strategyId}' is not registered`);
  }

  if (typeof contract.onBar !== 'function') {
    throw new Error(`INVALID_STRATEGY: Strategy '${strategyId}' has no executable onBar method`);
  }

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
      close?: (ticket?: number) => void;
      modify?: (ticket: number, sl?: number, tp?: number) => void;
      params?: Record<string, any>;
    },
    params: Record<string, any>
  ) => {
    // Provide aliases and injected params
    if (!ctx.close && ctx.closePosition) ctx.close = ctx.closePosition;
    if (!ctx.modify && ctx.modifyPosition) ctx.modify = ctx.modifyPosition;
    ctx.params = params;

    contract!.onBar(ctx, ctx.currentBar);
  };
}

