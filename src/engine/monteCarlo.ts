import { BacktestTrade, MonteCarloAnalysis } from '../types/forex';

/**
 * Deterministic Mulberry32 Pseudo-Random Number Generator
 */
export function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarloOptions {
  iterations?: number;
  initialBalance?: number;
  seed?: number;
  ruinDrawdownThresholdPct?: number; // e.g. 50%
}

/**
 * Runs deterministic Monte Carlo analysis using both reshuffling and bootstrapping
 */
export function runMonteCarloAnalysis(
  trades: BacktestTrade[],
  options?: MonteCarloOptions
): MonteCarloAnalysis {
  const iterations = options?.iterations ?? 1000;
  const initialBalance = options?.initialBalance ?? 10000;
  const seed = options?.seed ?? 123456789;
  const ruinThreshold = options?.ruinDrawdownThresholdPct ?? 50;

  const rng = createMulberry32(seed);

  if (trades.length === 0) {
    return {
      seed,
      trialsCount: 0,
      medianMaxDrawdownPct: 0,
      percentile95MaxDrawdownPct: 0,
      medianFinalEquity: initialBalance,
      percentile5FinalEquity: initialBalance,
      ruinProbabilityPct: 0,
      reshuffledCurves: [],
      bootstrappedCurves: [],
    };
  }

  const tradePnls = trades.map(t => t.pnl);
  const nTrades = tradePnls.length;

  const reshuffledDrawdowns: number[] = [];
  const bootstrappedFinalEquities: number[] = [];
  let ruinCount = 0;

  const sampleReshuffledCurves: { timeIndex: number; equity: number }[][] = [];
  const sampleBootstrappedCurves: { timeIndex: number; equity: number }[][] = [];

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Reshuffling without replacement (Fisher-Yates)
    const shuffled = [...tradePnls];
    for (let i = nTrades - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    let equity = initialBalance;
    let peak = initialBalance;
    let maxDd = 0;
    const curvePoints: { timeIndex: number; equity: number }[] = [{ timeIndex: 0, equity: initialBalance }];

    for (let k = 0; k < nTrades; k++) {
      equity += shuffled[k];
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDd) maxDd = dd;

      if (iter < 10 && (k % Math.max(1, Math.floor(nTrades / 20)) === 0 || k === nTrades - 1)) {
        curvePoints.push({ timeIndex: k + 1, equity: Math.round(equity * 100) / 100 });
      }
    }
    reshuffledDrawdowns.push(maxDd);
    if (maxDd >= ruinThreshold) {
      ruinCount++;
    }
    if (iter < 10) {
      sampleReshuffledCurves.push(curvePoints);
    }

    // 2. Bootstrapping with replacement
    let bEquity = initialBalance;
    const bCurvePoints: { timeIndex: number; equity: number }[] = [{ timeIndex: 0, equity: initialBalance }];

    for (let k = 0; k < nTrades; k++) {
      const randIdx = Math.floor(rng() * nTrades);
      bEquity += tradePnls[randIdx];
      if (iter < 10 && (k % Math.max(1, Math.floor(nTrades / 20)) === 0 || k === nTrades - 1)) {
        bCurvePoints.push({ timeIndex: k + 1, equity: Math.round(bEquity * 100) / 100 });
      }
    }
    bootstrappedFinalEquities.push(bEquity);
    if (iter < 10) {
      sampleBootstrappedCurves.push(bCurvePoints);
    }
  }

  // Sort metrics to extract percentiles
  reshuffledDrawdowns.sort((a, b) => a - b);
  bootstrappedFinalEquities.sort((a, b) => a - b);

  const p50Idx = Math.floor(iterations * 0.5);
  const p95Idx = Math.min(iterations - 1, Math.floor(iterations * 0.95));
  const p5Idx = Math.max(0, Math.floor(iterations * 0.05));

  const medianMaxDrawdownPct = Math.round(reshuffledDrawdowns[p50Idx] * 100) / 100;
  const percentile95MaxDrawdownPct = Math.round(reshuffledDrawdowns[p95Idx] * 100) / 100;
  const medianFinalEquity = Math.round(bootstrappedFinalEquities[p50Idx] * 100) / 100;
  const percentile5FinalEquity = Math.round(bootstrappedFinalEquities[p5Idx] * 100) / 100;
  const ruinProbabilityPct = Math.round((ruinCount / iterations) * 10000) / 100;

  return {
    seed,
    trialsCount: iterations,
    medianMaxDrawdownPct,
    percentile95MaxDrawdownPct,
    medianFinalEquity,
    percentile5FinalEquity,
    ruinProbabilityPct,
    reshuffledCurves: sampleReshuffledCurves,
    bootstrappedCurves: sampleBootstrappedCurves,
  };
}
