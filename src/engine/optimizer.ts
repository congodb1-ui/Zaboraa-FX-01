import { Candle, OptimizationConfig, OptimizationReport, OptimizationTrial } from '../types/forex';
import { runBacktest } from './backtester';
import { getStrategyExecutor } from '../services/builtInStrategies';
import { calculateHeuristicOverfittingScore } from './overfittingHeuristic';
import { createMulberry32 } from './monteCarlo';

export interface OptimizationOptions {
  isCancelled?: () => boolean;
}

/**
 * Executes a parameter optimization sweep (Grid or seeded Random)
 * with In-Sample / Out-of-Sample split and deterministic result ordering.
 */
export async function runOptimizationSweep(
  candles: Candle[],
  config: OptimizationConfig,
  onProgress?: (progressPct: number, currentTrial: number, totalTrials: number) => void,
  options?: OptimizationOptions
): Promise<OptimizationReport> {
  const seed = config.seed ?? 987654321;
  const rng = createMulberry32(seed);

  // Split candles into In-Sample and Out-of-Sample
  const splitRatio = Math.max(0.3, Math.min(0.9, config.inSamplePct / 100));
  const splitIdx = Math.floor(candles.length * splitRatio);
  const isCandles = candles.slice(0, splitIdx);
  const oosCandles = candles.slice(splitIdx);

  // Generate parameter combinations
  const paramCombinations: Record<string, any>[] = [];
  const ranges = config.paramRanges;

  if (config.searchType === 'grid') {
    function generateGrid(idx: number, current: Record<string, any>) {
      if (idx >= ranges.length) {
        paramCombinations.push({ ...current });
        return;
      }
      const r = ranges[idx];
      const step = r.step || 1;
      for (let val = r.min; val <= r.max; val += step) {
        current[r.name] = Number(val.toFixed(4));
        generateGrid(idx + 1, current);
      }
    }
    generateGrid(0, {});
  } else {
    // Seeded Random Search
    const trialCount = Math.max(5, Math.min(200, config.randomTrials || 25));
    for (let t = 0; t < trialCount; t++) {
      const p: Record<string, any> = {};
      for (const r of ranges) {
        const step = r.step || 1;
        const steps = Math.floor((r.max - r.min) / step);
        const randStep = Math.floor(rng() * (steps + 1));
        p[r.name] = Number((r.min + randStep * step).toFixed(4));
      }
      paramCombinations.push(p);
    }
  }

  // Obtain strategy executor (throws UNKNOWN_STRATEGY if invalid/unknown)
  const executor = getStrategyExecutor(config.strategyId);

  const trials: OptimizationTrial[] = [];
  const totalTrials = paramCombinations.length;

  for (let idx = 0; idx < totalTrials; idx++) {
    // Check cancellation
    if (options?.isCancelled && options.isCancelled()) {
      throw new Error('OPTIMIZATION_CANCELLED');
    }

    const params = paramCombinations[idx];

    // 1. Run In-Sample
    const isRes = runBacktest(
      isCandles,
      {
        strategyId: config.strategyId,
        symbol: config.symbol,
        timeframe: config.timeframe,
        startDate: config.startDate,
        endDate: config.endDate,
        initialBalance: config.initialBalance,
        leverage: 200,
        lotSize: 0.1,
        positionSizing: 'fixed_lot',
        riskPctPerTrade: 1.5,
        costModel: config.costModel,
        params,
        provenance: {
          source: 'SIMULATED',
          label: 'SIMULATED',
          details: 'In-Sample Optimization Partition',
          utcOffsetHours: 0,
          isResearchEligible: true,
        },
      },
      executor
    );

    // 2. Run Out-of-Sample
    const oosRes = runBacktest(
      oosCandles,
      {
        strategyId: config.strategyId,
        symbol: config.symbol,
        timeframe: config.timeframe,
        startDate: config.startDate,
        endDate: config.endDate,
        initialBalance: config.initialBalance,
        leverage: 200,
        lotSize: 0.1,
        positionSizing: 'fixed_lot',
        riskPctPerTrade: 1.5,
        costModel: config.costModel,
        params,
        provenance: {
          source: 'SIMULATED',
          label: 'SIMULATED',
          details: 'Out-of-Sample Verification Partition',
          utcOffsetHours: 0,
          isResearchEligible: true,
        },
      },
      executor
    );

    // 3. Overfitting heuristic evaluation
    const scoreObj = calculateHeuristicOverfittingScore({
      isSharpe: isRes.sharpeRatio,
      oosSharpe: oosRes.sharpeRatio,
      isTrades: isRes.totalTrades,
      oosTrades: oosRes.totalTrades,
      paramCount: Object.keys(params).length,
      totalTrialsTested: totalTrials,
    });

    trials.push({
      id: `trial_${idx + 1}`,
      params,
      isSharpe: isRes.sharpeRatio,
      oosSharpe: oosRes.sharpeRatio,
      isNetProfit: isRes.netProfit,
      oosNetProfit: oosRes.netProfit,
      isTrades: isRes.totalTrades,
      oosTrades: oosRes.totalTrades,
      isWinRate: isRes.winRate,
      oosWinRate: oosRes.winRate,
      maxDrawdownPct: Math.max(isRes.maxDrawdownPct, oosRes.maxDrawdownPct),
      overfittingScore: scoreObj.totalScore,
      overfittingLabel: scoreObj.label,
      overfittingNotes: scoreObj.explanations,
    });

    if (onProgress) {
      onProgress(Math.round(((idx + 1) / totalTrials) * 100), idx + 1, totalTrials);
    }
  }

  // Deterministic sorting: sort primarily by oosSharpe descending, then by id
  trials.sort((a, b) => b.oosSharpe - a.oosSharpe || a.id.localeCompare(b.id));

  const bestTrial = trials[0];
  const avgIsSharpe = trials.reduce((s, t) => s + t.isSharpe, 0) / Math.max(1, trials.length);
  const avgOosSharpe = trials.reduce((s, t) => s + t.oosSharpe, 0) / Math.max(1, trials.length);
  const degradationRatio = avgIsSharpe > 0 ? Math.max(0, (avgIsSharpe - avgOosSharpe) / avgIsSharpe) : 0;

  // 2D Heatmap matrix for first two parameters
  const paramXName = ranges[0]?.name || 'param1';
  const paramYName = ranges[1]?.name || 'param2';
  const heatmapMatrix: { x: number; y: number; value: number }[] = trials.map(t => ({
    x: t.params[paramXName] ?? 0,
    y: t.params[paramYName] ?? 0,
    value: t.oosSharpe,
  }));

  return {
    id: `opt_${Date.now()}`,
    strategyId: config.strategyId,
    symbol: config.symbol,
    timeframe: config.timeframe,
    totalTrials,
    trials,
    bestTrial,
    walkForwardDegradationRatio: Number(degradationRatio.toFixed(3)),
    overallOverfittingScore: bestTrial ? bestTrial.overfittingScore : 0,
    paramXName,
    paramYName,
    metric: 'oosSharpe',
    heatmapMatrix,
    seed,
    createdAt: new Date().toISOString(),
  };
}
