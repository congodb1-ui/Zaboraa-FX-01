import { SymbolName, SymbolSpec, Candle, Timeframe } from '../types/forex';

export const SYMBOL_SPECS: Record<SymbolName, SymbolSpec> = {
  EURUSD: {
    symbol: 'EURUSD',
    displayName: 'EUR/USD (Euro / US Dollar)',
    digits: 5,
    point: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    stepVolume: 0.01,
    spreadPips: 0.8,
    bid: 1.08452,
    ask: 1.08460,
    swapLong: -3.2,
    swapShort: 0.8,
    currency: 'USD',
    pipValuePerLotUSD: 10.0,
    tripleSwapDay: 3, // Wednesday triple swap
  },
  GBPUSD: {
    symbol: 'GBPUSD',
    displayName: 'GBP/USD (British Pound / US Dollar)',
    digits: 5,
    point: 0.00001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    stepVolume: 0.01,
    spreadPips: 1.2,
    bid: 1.29845,
    ask: 1.29857,
    swapLong: -2.8,
    swapShort: 0.5,
    currency: 'USD',
    pipValuePerLotUSD: 10.0,
    tripleSwapDay: 3, // Wednesday triple swap
  },
  USDJPY: {
    symbol: 'USDJPY',
    displayName: 'USD/JPY (US Dollar / Japanese Yen)',
    digits: 3,
    point: 0.001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100.0,
    stepVolume: 0.01,
    spreadPips: 1.0,
    bid: 152.348,
    ask: 152.358,
    swapLong: 4.5,
    swapShort: -8.2,
    currency: 'JPY',
    pipValuePerLotUSD: 6.56, // 1000 JPY / 152.35 ≈ $6.56
    tripleSwapDay: 3, // Wednesday triple swap
  },
  XAUUSD: {
    symbol: 'XAUUSD',
    displayName: 'XAU/USD (Gold / US Dollar)',
    digits: 2,
    point: 0.01,
    contractSize: 100, // 100 troy ounces
    minVolume: 0.01,
    maxVolume: 50.0,
    stepVolume: 0.01,
    spreadPips: 18.0, // approx 0.18 USD spread on Gold
    bid: 2734.25,
    ask: 2734.43,
    swapLong: -14.5,
    swapShort: 2.1,
    currency: 'USD',
    pipValuePerLotUSD: 100.0, // $1 move per oz * 100 oz = $100 per 1.00 USD move
    tripleSwapDay: 3, // Wednesday triple swap
  },
};

/**
 * Single authoritative pip value calculation derived exclusively from SYMBOL_SPECS.
 * For USD base or quote, or Gold: returns pipValuePerLotUSD from SYMBOL_SPECS.
 * For USDJPY: computes exact dynamic pip value based on the current market price.
 */
export function calculatePipValue(symbol: SymbolName, currentPrice?: number): number {
  const spec = SYMBOL_SPECS[symbol];
  if (!spec) return 10.0;
  if (symbol === 'USDJPY' && currentPrice && currentPrice > 0) {
    return (spec.contractSize * spec.point) / currentPrice;
  }
  return spec.pipValuePerLotUSD;
}

// Seeded pseudo-random generator for reproducible deterministic datasets
function createPRNG(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateHistoricalCandles(
  symbol: SymbolName,
  timeframe: Timeframe,
  count = 600
): Candle[] {
  const spec = SYMBOL_SPECS[symbol];
  const rand = createPRNG(symbol.charCodeAt(0) * 1000 + timeframe.charCodeAt(0));

  let basePrice = spec.bid;
  let volatility = 0.0008;
  let intervalSec = 3600; // H1

  if (timeframe === 'M1') intervalSec = 60;
  else if (timeframe === 'M5') intervalSec = 300;
  else if (timeframe === 'M15') intervalSec = 900;
  else if (timeframe === 'H1') intervalSec = 3600;
  else if (timeframe === 'H4') intervalSec = 14400;
  else if (timeframe === 'D1') intervalSec = 86400;

  if (symbol === 'XAUUSD') {
    volatility = 4.5;
  } else if (symbol === 'USDJPY') {
    volatility = 0.25;
  } else {
    volatility = 0.0009;
  }

  const candles: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - count * intervalSec;

  let currentPrice = basePrice;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSec;
    // Skip weekend hours for realistic forex gaps
    const date = new Date(time * 1000);
    const day = date.getUTCDay();
    if (day === 6 || (day === 0 && date.getUTCHours() < 21)) {
      continue;
    }

    const drift = (rand() - 0.495) * volatility;
    const open = currentPrice;
    const close = Number((open + drift).toFixed(spec.digits));
    
    const highDrift = Math.abs(rand() * volatility * 0.9);
    const lowDrift = Math.abs(rand() * volatility * 0.9);
    const high = Number((Math.max(open, close) + highDrift).toFixed(spec.digits));
    const low = Number((Math.min(open, close) - lowDrift).toFixed(spec.digits));

    const tickVolume = Math.floor(rand() * 850 + 150);
    const spread = Number((spec.spreadPips + (rand() - 0.5) * 0.4).toFixed(1));

    candles.push({
      time,
      open,
      high,
      low,
      close,
      tickVolume,
      spread: Math.max(0.1, spread),
    });

    currentPrice = close;
  }

  return candles;
}

// Indicator computations
export function calculateSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

export function calculateEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prevEma: number | null = null;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // First EMA is simple average
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j];
      }
      prevEma = sum / period;
      result.push(prevEma);
    } else {
      prevEma = data[i] * k + (prevEma as number) * (1 - k);
      result.push(prevEma);
    }
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      result.push(null);
      continue;
    }

    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    if (i < period) {
      avgGain += gain;
      avgLoss += loss;
      result.push(null);
    } else if (i === period) {
      avgGain /= period;
      avgLoss /= period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = calculateSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    const ma = middle[i];
    if (ma === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let varianceSum = 0;
      for (let j = 0; j < period; j++) {
        varianceSum += Math.pow(closes[i - j] - ma, 2);
      }
      const stdDev = Math.sqrt(varianceSum / period);
      upper.push(ma + stdDevMultiplier * stdDev);
      lower.push(ma - stdDevMultiplier * stdDev);
    }
  }

  return { upper, middle, lower };
}

export function calculateATR(candles: Candle[], period = 14): (number | null)[] {
  const trueRanges: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trueRanges.push(candles[i].high - candles[i].low);
    } else {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      trueRanges.push(Math.max(hl, hc, lc));
    }
  }

  return calculateEMA(trueRanges, period);
}

// Parquet Data Quality Checker
export interface QualityReport {
  symbol: SymbolName;
  timeframe: Timeframe;
  totalCandles: number;
  duplicateTimestamps: number;
  invertedOHLC: number;
  gapsDetected: number;
  zeroVolumeCandles: number;
  startDate: string;
  endDate: string;
  isCompliant: boolean;
  scorePct: number;
}

export function auditDataQuality(candles: Candle[], symbol: SymbolName, tf: Timeframe): QualityReport {
  let duplicates = 0;
  let inverted = 0;
  let gaps = 0;
  let zeroVol = 0;

  const seen = new Set<number>();
  let intervalSec = 3600;
  if (tf === 'M1') intervalSec = 60;
  else if (tf === 'M5') intervalSec = 300;
  else if (tf === 'M15') intervalSec = 900;
  else if (tf === 'H1') intervalSec = 3600;
  else if (tf === 'H4') intervalSec = 14400;
  else if (tf === 'D1') intervalSec = 86400;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (seen.has(c.time)) duplicates++;
    seen.add(c.time);

    if (c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      inverted++;
    }

    if (c.tickVolume <= 0) zeroVol++;

    if (i > 0) {
      const diff = c.time - candles[i - 1].time;
      // Greater than expected interval and not a weekend
      if (diff > intervalSec * 1.5) {
        const d = new Date(c.time * 1000);
        const day = d.getUTCDay();
        // Ignore weekend gaps (Fri night to Sun night)
        if (day !== 0 && day !== 1) {
          gaps++;
        }
      }
    }
  }

  const total = candles.length;
  const anomalies = duplicates + inverted + zeroVol;
  const score = total > 0 ? Math.max(0, Math.round(((total - anomalies) / total) * 100)) : 100;

  return {
    symbol,
    timeframe: tf,
    totalCandles: total,
    duplicateTimestamps: duplicates,
    invertedOHLC: inverted,
    gapsDetected: gaps,
    zeroVolumeCandles: zeroVol,
    startDate: total > 0 ? new Date(candles[0].time * 1000).toISOString().split('T')[0] : 'N/A',
    endDate: total > 0 ? new Date(candles[total - 1].time * 1000).toISOString().split('T')[0] : 'N/A',
    isCompliant: anomalies === 0,
    scorePct: score,
  };
}
