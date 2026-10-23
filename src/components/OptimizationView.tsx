import React, { useState } from 'react';
import {
  Play,
  RotateCw,
  Sliders,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Activity,
  Layers,
  Flame,
} from 'lucide-react';
import {
  Strategy,
  SymbolName,
  Timeframe,
  OptimizationConfig,
  OptimizationReport,
  OptimizationTrial,
  Candle,
} from '../types/forex';
import { runOptimizationSweep } from '../engine/optimizer';
import { generateHistoricalCandles } from '../services/marketData';

interface OptimizationViewProps {
  strategies: Strategy[];
  currentSymbol: SymbolName;
  currentTimeframe: Timeframe;
  historicalCandles?: Candle[];
}

export const OptimizationView: React.FC<OptimizationViewProps> = ({
  strategies,
  currentSymbol,
  currentTimeframe,
  historicalCandles,
}) => {
  const [selectedStrategyId, setSelectedStrategyId] = useState(strategies[0]?.id || '');
  const [searchType, setSearchType] = useState<'grid' | 'random'>('grid');
  const [inSamplePct, setInSamplePct] = useState(70);
  const [randomTrials, setRandomTrials] = useState(25);
  const [mcSeed, setMcSeed] = useState(987654321);

  // Parameter ranges
  const [param1Min, setParam1Min] = useState(10);
  const [param1Max, setParam1Max] = useState(30);
  const [param1Step, setParam1Step] = useState(5);

  const [param2Min, setParam2Min] = useState(30);
  const [param2Max, setParam2Max] = useState(70);
  const [param2Step, setParam2Step] = useState(10);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<OptimizationReport | null>(null);

  const handleRunOptimization = async () => {
    setIsRunning(true);
    setProgress(0);

    const config: OptimizationConfig = {
      strategyId: selectedStrategyId,
      symbol: currentSymbol,
      timeframe: currentTimeframe,
      startDate: '2026-01-01',
      endDate: '2026-10-23',
      inSamplePct,
      searchType,
      randomTrials,
      seed: mcSeed,
      paramRanges: [
        { name: 'fastPeriod', min: param1Min, max: param1Max, step: param1Step },
        { name: 'slowPeriod', min: param2Min, max: param2Max, step: param2Step },
      ],
      initialBalance: 10000,
      costModel: {
        spreadMode: 'historical',
        fixedSpreadPips: 1.0,
        commissionPerLotRoundTurn: 7.0,
        slippagePips: 0.5,
        includeSwap: true,
      },
    };

    try {
      const candlesToUse =
        historicalCandles && historicalCandles.length >= 100
          ? historicalCandles
          : generateHistoricalCandles(currentSymbol, currentTimeframe, 500);

      const result = await runOptimizationSweep(candlesToUse, config, (pct) => {
        setProgress(pct);
      });
      setReport(result);
    } catch (err) {
      console.error('Optimization sweep failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  // Group heatmap by X and Y coordinates
  const uniqueX = Array.from(new Set(report?.heatmapMatrix.map(m => m.x) || [])).sort((a, b) => a - b);
  const uniqueY = Array.from(new Set(report?.heatmapMatrix.map(m => m.y) || [])).sort((a, b) => a - b);

  const getHeatmapVal = (x: number, y: number) => {
    return report?.heatmapMatrix.find(m => m.x === x && m.y === y)?.value ?? null;
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-[#0F172A] border border-slate-800 rounded-xl">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-400" />
            Parameter Optimization & Walk-Forward Suite
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Grid & seeded random parameter search with in-sample / out-of-sample partitions and 2D sensitivity heatmaps.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunOptimization}
            disabled={isRunning}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${
              isRunning
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-950 cursor-pointer'
            }`}
          >
            {isRunning ? (
              <>
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                Optimizing ({progress}%)...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Run Optimization Sweep
              </>
            )}
          </button>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Strategy & Search Type */}
        <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl space-y-3">
          <label className="text-xs font-semibold text-slate-300">Target Strategy</label>
          <select
            value={selectedStrategyId}
            onChange={(e) => setSelectedStrategyId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold text-slate-300 block pt-1">Search Type</label>
          <div className="flex gap-2">
            <button
              onClick={() => setSearchType('grid')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg border ${
                searchType === 'grid'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              Grid Search
            </button>
            <button
              onClick={() => setSearchType('random')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg border ${
                searchType === 'random'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              Random
            </button>
          </div>
        </div>

        {/* Partition & Seed */}
        <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-slate-300">In-Sample Ratio</label>
            <span className="text-xs font-mono text-blue-400">{inSamplePct}% / {100 - inSamplePct}% OOS</span>
          </div>
          <input
            type="range"
            min="40"
            max="85"
            step="5"
            value={inSamplePct}
            onChange={(e) => setInSamplePct(parseInt(e.target.value, 10))}
            className="w-full accent-blue-500"
          />

          <div className="pt-1">
            <label className="text-xs font-semibold text-slate-300">RNG Seed (Reproducibility)</label>
            <input
              type="number"
              value={mcSeed}
              onChange={(e) => setMcSeed(parseInt(e.target.value, 10))}
              className="w-full mt-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
            />
          </div>
        </div>

        {/* Parameter 1 Range (Fast Period) */}
        <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl space-y-2">
          <label className="text-xs font-semibold text-slate-300">Param 1: Fast Period</label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-slate-400">Min</span>
              <input
                type="number"
                value={param1Min}
                onChange={(e) => setParam1Min(Number(e.target.value))}
                className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Max</span>
              <input
                type="number"
                value={param1Max}
                onChange={(e) => setParam1Max(Number(e.target.value))}
                className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Step</span>
              <input
                type="number"
                value={param1Step}
                onChange={(e) => setParam1Step(Number(e.target.value))}
                className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* Parameter 2 Range (Slow Period) */}
        <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl space-y-2">
          <label className="text-xs font-semibold text-slate-300">Param 2: Slow Period</label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-slate-400">Min</span>
              <input
                type="number"
                value={param2Min}
                onChange={(e) => setParam2Min(Number(e.target.value))}
                className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Max</span>
              <input
                type="number"
                value={param2Max}
                onChange={(e) => setParam2Max(Number(e.target.value))}
                className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Step</span>
              <input
                type="number"
                value={param2Step}
                onChange={(e) => setParam2Step(Number(e.target.value))}
                className="w-full p-1.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Optimization Results */}
      {report && (
        <div className="space-y-6 animate-fadeIn">
          {/* Executive Diagnostic Ribbon */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider">Total Sweep Trials</span>
              <div className="text-xl font-bold font-mono text-white mt-1">{report.totalTrials}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Evaluated without ceiling</div>
            </div>

            <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider">Best Out-of-Sample Sharpe</span>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {report.bestTrial?.oosSharpe.toFixed(2) || '0.00'}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                IS Sharpe: {report.bestTrial?.isSharpe.toFixed(2)}
              </div>
            </div>

            <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider">Walk-Forward Degradation</span>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                {(report.walkForwardDegradationRatio * 100).toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">IS to OOS performance drop</div>
            </div>

            <div className="p-4 bg-[#0F172A] border border-slate-800 rounded-xl">
              <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider">Heuristic Overfitting Score</span>
              <div className={`text-xl font-bold font-mono mt-1 ${
                report.overallOverfittingScore < 25 ? 'text-emerald-400' : report.overallOverfittingScore <= 50 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {report.overallOverfittingScore} / 100
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-medium truncate">
                {report.bestTrial?.overfittingLabel}
              </div>
            </div>
          </div>

          {/* 2D Heatmap Matrix */}
          {uniqueX.length > 1 && uniqueY.length > 1 && (
            <div className="p-5 bg-[#0F172A] border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  2D Parameter Sensitivity Heatmap (OOS Sharpe)
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  X: {report.paramXName} · Y: {report.paramYName}
                </span>
              </div>

              <div className="overflow-x-auto pt-2">
                <div className="inline-block min-w-full">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] text-slate-400 w-16 text-right">Slow \ Fast</span>
                    {uniqueX.map(x => (
                      <span key={x} className="w-16 text-center font-mono text-xs text-slate-400 font-semibold">
                        {x}
                      </span>
                    ))}
                  </div>

                  {uniqueY.map(y => (
                    <div key={y} className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-mono text-slate-400 w-16 text-right font-semibold">{y}</span>
                      {uniqueX.map(x => {
                        const val = getHeatmapVal(x, y);
                        const isPositive = val !== null && val > 0;
                        const opacity = val !== null ? Math.min(1, Math.max(0.15, Math.abs(val) / 2)) : 0;
                        return (
                          <div
                            key={`${x}_${y}`}
                            className="w-16 h-10 rounded flex items-center justify-center font-mono text-xs border border-slate-800 transition-transform hover:scale-105"
                            style={{
                              backgroundColor:
                                val === null
                                  ? '#1E293B'
                                  : isPositive
                                  ? `rgba(22, 163, 74, ${opacity})`
                                  : `rgba(220, 38, 38, ${opacity})`,
                              color: '#FFFFFF',
                            }}
                            title={`Fast: ${x}, Slow: ${y} -> OOS Sharpe: ${val !== null ? val.toFixed(2) : 'N/A'}`}
                          >
                            {val !== null ? val.toFixed(2) : '-'}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trials Table */}
          <div className="p-5 bg-[#0F172A] border border-slate-800 rounded-xl space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              Deterministically Ordered Parameter Trials
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-mono">
                  <tr>
                    <th className="py-2.5 px-3">Trial ID</th>
                    <th className="py-2.5 px-3">Parameters</th>
                    <th className="py-2.5 px-3 text-right">IS Sharpe</th>
                    <th className="py-2.5 px-3 text-right">OOS Sharpe</th>
                    <th className="py-2.5 px-3 text-right">IS Net ($)</th>
                    <th className="py-2.5 px-3 text-right">OOS Net ($)</th>
                    <th className="py-2.5 px-3 text-right">Total Trades</th>
                    <th className="py-2.5 px-3 text-right">Max DD (%)</th>
                    <th className="py-2.5 px-3 text-center">Overfitting Label</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {report.trials.slice(0, 50).map((t) => (
                    <tr key={t.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-semibold text-slate-300">{t.id}</td>
                      <td className="py-2 px-3 text-slate-300">
                        {Object.entries(t.params).map(([k, v]) => `${k}:${v}`).join(', ')}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">{t.isSharpe.toFixed(2)}</td>
                      <td className={`py-2 px-3 text-right font-bold ${t.oosSharpe >= 1.0 ? 'text-emerald-400' : t.oosSharpe > 0 ? 'text-slate-300' : 'text-rose-400'}`}>
                        {t.oosSharpe.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">${t.isNetProfit.toFixed(0)}</td>
                      <td className={`py-2 px-3 text-right font-bold ${t.oosNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${t.oosNetProfit.toFixed(0)}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">{t.isTrades + t.oosTrades}</td>
                      <td className="py-2 px-3 text-right text-rose-400">{t.maxDrawdownPct.toFixed(1)}%</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-[10px] font-sans font-medium px-2 py-0.5 rounded ${
                          t.overfittingScore < 25
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                            : t.overfittingScore <= 50
                            ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                            : 'bg-rose-950/60 text-rose-400 border border-rose-500/30'
                        }`}>
                          {t.overfittingLabel} ({t.overfittingScore})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
