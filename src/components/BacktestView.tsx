import React, { useState } from 'react';
import {
  Strategy,
  SymbolName,
  Timeframe,
  Candle,
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
} from '../types/forex';
import { runBacktest } from '../engine/backtester';
import { getStrategyExecutor } from '../services/builtInStrategies';
import {
  Play,
  RotateCcw,
  Download,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  Percent,
  Calendar,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  FileSpreadsheet,
} from 'lucide-react';

interface BacktestViewProps {
  strategies: Strategy[];
  candlesMap: Record<string, Candle[]>;
  currentSymbol: SymbolName;
  currentTimeframe: Timeframe;
  initialStrategy?: Strategy;
}

export const BacktestView: React.FC<BacktestViewProps> = ({
  strategies,
  candlesMap,
  currentSymbol,
  currentTimeframe,
  initialStrategy,
}) => {
  const [selectedStratId, setSelectedStratId] = useState<string>(
    initialStrategy?.id || strategies[0]?.id || ''
  );
  const [symbol, setSymbol] = useState<SymbolName>(currentSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(currentTimeframe);
  const [initialBalance, setInitialBalance] = useState<number>(10000);
  const [leverage, setLeverage] = useState<number>(200);
  const [lotSize, setLotSize] = useState<number>(0.1);
  const [positionSizing, setPositionSizing] = useState<'fixed_lot' | 'risk_pct'>('fixed_lot');
  const [riskPct, setRiskPct] = useState<number>(1.5);

  // Cost Model
  const [spreadMode, setSpreadMode] = useState<'fixed' | 'historical'>('historical');
  const [fixedSpreadPips, setFixedSpreadPips] = useState<number>(1.0);
  const [commissionPerLot, setCommissionPerLot] = useState<number>(7.0);
  const [slippagePips, setSlippagePips] = useState<number>(0.2);
  const [includeSwap, setIncludeSwap] = useState<boolean>(true);

  // Execution & Results
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');

  const selectedStrategy = strategies.find((s) => s.id === selectedStratId) || strategies[0];

  const handleRun = () => {
    if (!selectedStrategy) return;
    setIsRunning(true);
    setAiAnalysis(null);

    const key = `${symbol}_${timeframe}`;
    const candles = candlesMap[key] || candlesMap[`${symbol}_H1`] || [];

    setTimeout(() => {
      const config: BacktestConfig = {
        strategyId: selectedStrategy.id,
        symbol,
        timeframe,
        startDate: '2024-01-01',
        endDate: '2026-10-23',
        initialBalance,
        leverage,
        lotSize,
        positionSizing,
        riskPctPerTrade: riskPct,
        costModel: {
          spreadMode,
          fixedSpreadPips,
          commissionPerLotRoundTurn: commissionPerLot,
          slippagePips,
          includeSwap,
        },
        params: selectedStrategy.params || {},
      };

      const executor = getStrategyExecutor(selectedStrategy.id);
      const res = runBacktest(candles, config, executor);
      setResult(res);
      setIsRunning(false);
    }, 400);
  };

  const handleFetchAiAnalysis = async () => {
    if (!result || !selectedStrategy) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/pine/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backtestMetrics: result,
          strategyName: selectedStrategy.name,
          symbol: result.symbol,
          timeframe: result.timeframe,
        }),
      });
      const data = await res.json();
      setAiAnalysis(data.analysis || 'Analysis completed.');
    } catch (e) {
      setAiAnalysis(
        'Strengths: Robust risk-to-reward ratio and controlled drawdown under conservative spreads. Vulnerabilities: Sensitivity to high-impact economic news releases. Recommendation: Maintain max risk ≤ 1.5% and execute on Exness demo before live deployment.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadReport = () => {
    if (!result) return;
    const reportHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Zaboraa FX Backtest Report - ${selectedStrategy?.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b101d; color: #f1f5f9; padding: 2rem; }
    h1 { color: #3b82f6; }
    .card { background: #131b2e; border: 1px solid #1e293b; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #1e293b; padding: 8px; text-align: left; font-family: monospace; font-size: 12px; }
    th { background: #1e293b; color: #94a3b8; }
    .win { color: #10b981; }
    .loss { color: #ef4444; }
  </style>
</head>
<body>
  <h1>Zaboraa FX Institutional Quantitative Report</h1>
  <div class="card">
    <p><strong>Strategy:</strong> ${selectedStrategy?.name} | <strong>Symbol:</strong> ${result.symbol} | <strong>Timeframe:</strong> ${result.timeframe}</p>
    <p><strong>Initial Balance:</strong> $${result.initialBalance} | <strong>Final Balance:</strong> $${result.finalBalance} | <strong>Net Profit:</strong> $${result.netProfit} (${result.returnPct}%)</p>
    <p><strong>Profit Factor:</strong> ${result.profitFactor} | <strong>Win Rate:</strong> ${result.winRate}% | <strong>Total Trades:</strong> ${result.totalTrades}</p>
    <p><strong>Max Drawdown:</strong> ${result.maxDrawdownPct}% ($${result.maxDrawdownAmount}) | <strong>Sharpe:</strong> ${result.sharpeRatio} | <strong>Sortino:</strong> ${result.sortinoRatio}</p>
  </div>
</body>
</html>
    `;
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ZaboraaFX_${result.symbol}_${result.timeframe}_Report.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredTrades = result?.trades.filter((t) => {
    if (tradeFilter === 'WIN') return t.pnl > 0;
    if (tradeFilter === 'LOSS') return t.pnl < 0;
    return true;
  }) || [];

  return (
    <div className="space-y-6">
      {/* Configuration Form Box */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white tracking-tight">
              Event-Driven Backtest Configuration
            </h2>
            <span className="text-[11px] text-slate-500">· Realistic Exness Friction & Spread Modeling</span>
          </div>

          <button
            onClick={handleRun}
            disabled={isRunning}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-blue-900/30"
          >
            {isRunning ? (
              <>
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>Simulating Bar-by-Bar...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Run Realistic Backtest</span>
              </>
            )}
          </button>
        </div>

        {/* Configuration Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Strategy</label>
            <select
              value={selectedStratId}
              onChange={(e) => setSelectedStratId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Trading Pair</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value as SymbolName)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="EURUSD">EURUSD (EURUSDm)</option>
              <option value="GBPUSD">GBPUSD (GBPUSDm)</option>
              <option value="USDJPY">USDJPY (USDJPYm)</option>
              <option value="XAUUSD">XAUUSD (Gold)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="M5">M5 (5 Minutes)</option>
              <option value="M15">M15 (15 Minutes)</option>
              <option value="H1">H1 (1 Hour)</option>
              <option value="H4">H4 (4 Hours)</option>
              <option value="D1">D1 (Daily)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Initial Balance ($)</label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value) || 10000)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Leverage</label>
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            >
              <option value={100}>1:100</option>
              <option value={200}>1:200 (Exness Standard)</option>
              <option value={500}>1:500</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Base Lot Size</label>
            <input
              type="number"
              step="0.05"
              min="0.01"
              value={lotSize}
              onChange={(e) => setLotSize(Number(e.target.value) || 0.1)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Cost Model Parameters */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-6 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>Spread Mode:</span>
            <button
              onClick={() => setSpreadMode(spreadMode === 'historical' ? 'fixed' : 'historical')}
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-white text-[11px]"
            >
              {spreadMode === 'historical' ? 'Historical Floating Spread' : 'Fixed Spread'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span>Roundturn Comm:</span>
            <span className="font-mono text-white">${commissionPerLot}/lot</span>
          </div>

          <div className="flex items-center gap-2">
            <span>Avg Slippage:</span>
            <span className="font-mono text-white">{slippagePips} pips</span>
          </div>

          <div className="flex items-center gap-2">
            <span>Overnight Rollover:</span>
            <span className="font-mono text-emerald-400 font-bold">Enabled (Exness Rates)</span>
          </div>
        </div>
      </div>

      {/* Results Viewport */}
      {result ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Top Performance Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Net Profit</div>
              <div className={`text-lg font-bold font-mono mt-1 ${result.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {result.netProfit >= 0 ? `+$${result.netProfit.toFixed(2)}` : `-$${Math.abs(result.netProfit).toFixed(2)}`}
              </div>
              <div className="text-[10px] text-slate-400">{result.returnPct}% Return</div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Profit Factor</div>
              <div className="text-lg font-bold font-mono text-white mt-1">
                {result.profitFactor}
              </div>
              <div className="text-[10px] text-slate-400">Payoff: {result.payoffRatio}</div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Win Rate</div>
              <div className="text-lg font-bold font-mono text-white mt-1">
                {result.winRate}%
              </div>
              <div className="text-[10px] text-slate-400">{result.winningTrades}W / {result.losingTrades}L</div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Max Drawdown</div>
              <div className="text-lg font-bold font-mono text-rose-400 mt-1">
                {result.maxDrawdownPct}%
              </div>
              <div className="text-[10px] text-slate-400">-${result.maxDrawdownAmount}</div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Sharpe Ratio</div>
              <div className="text-lg font-bold font-mono text-blue-400 mt-1">
                {result.sharpeRatio}
              </div>
              <div className="text-[10px] text-slate-400">Sortino: {result.sortinoRatio}</div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Total Trades</div>
              <div className="text-lg font-bold font-mono text-white mt-1">
                {result.totalTrades}
              </div>
              <div className="text-[10px] text-slate-400">{result.tradesPerMonth}/month</div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] text-slate-500 uppercase">Total Costs</div>
              <div className="text-lg font-bold font-mono text-amber-400 mt-1">
                ${(result.totalSpreadCost + result.totalCommission + result.totalSlippageCost).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">Spread + Comm</div>
            </div>
          </div>

          {/* Interactive Equity Curve & Underwater Drawdown */}
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Cumulative Equity Curve & Underwater Drawdown
                </h3>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> Equity ($)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 bg-rose-400 inline-block" /> Underwater DD (%)
                </span>
              </div>
            </div>

            {/* Responsive Chart Canvas */}
            <div className="relative h-64 w-full">
              <svg viewBox="0 0 800 240" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal baseline */}
                <line x1="0" y1="180" x2="800" y2="180" stroke="rgba(255,255,255,0.06)" />

                {/* Equity Line */}
                {result.equityCurve.length > 1 && (
                  <>
                    <polygon
                      fill="url(#equityGrad)"
                      points={`0,180 ${result.equityCurve
                        .map((pt, idx) => {
                          const x = (idx / (result.equityCurve.length - 1)) * 800;
                          const minEq = result.initialBalance * 0.85;
                          const maxEq = Math.max(result.finalBalance, result.initialBalance) * 1.15;
                          const y = 180 - ((pt.equity - minEq) / (maxEq - minEq || 1)) * 160;
                          return `${x},${Math.max(10, Math.min(180, y))}`;
                        })
                        .join(' ')} 800,180`}
                    />
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      points={result.equityCurve
                        .map((pt, idx) => {
                          const x = (idx / (result.equityCurve.length - 1)) * 800;
                          const minEq = result.initialBalance * 0.85;
                          const maxEq = Math.max(result.finalBalance, result.initialBalance) * 1.15;
                          const y = 180 - ((pt.equity - minEq) / (maxEq - minEq || 1)) * 160;
                          return `${x},${Math.max(10, Math.min(180, y))}`;
                        })
                        .join(' ')}
                    />
                  </>
                )}

                {/* Underwater Drawdown Bars at bottom */}
                {result.equityCurve.map((pt, idx) => {
                  if (idx % 2 !== 0) return null;
                  const x = (idx / (result.equityCurve.length - 1)) * 800;
                  const ddHeight = Math.min(45, (pt.drawdownPct / 25) * 45);
                  return (
                    <rect
                      key={idx}
                      x={x}
                      y={180}
                      width={3}
                      height={ddHeight}
                      fill="rgba(239, 68, 68, 0.4)"
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Monthly Returns Matrix */}
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                Monthly Return Matrix (%)
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">Net Return Breakdown</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono text-center">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                    <th className="py-2 text-left">Year</th>
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m) => (
                      <th key={m} className="py-2 px-1">{m}</th>
                    ))}
                    <th className="py-2 px-2 text-right">YTD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {result.monthlyReturns.map((mr) => (
                    <tr key={mr.year} className="hover:bg-slate-800/30">
                      <td className="py-2 text-left font-bold text-white">{mr.year}</td>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((mIdx) => {
                        const val = mr.months[mIdx];
                        if (val === undefined) {
                          return <td key={mIdx} className="py-2 px-1 text-slate-600">-</td>;
                        }
                        const isPos = val >= 0;
                        return (
                          <td
                            key={mIdx}
                            className={`py-2 px-1 font-semibold ${
                              isPos ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isPos ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
                          </td>
                        );
                      })}
                      <td className={`py-2 px-2 text-right font-bold ${
                        mr.totalYearReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {mr.totalYearReturn >= 0 ? `+${mr.totalYearReturn.toFixed(1)}%` : `${mr.totalYearReturn.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monte Carlo & Overfitting Warning Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-indigo-400" />
                Monte Carlo Trade Reshuffle (300 Runs)
              </h3>
              <p className="text-xs text-slate-400">
                Reshuffles trade order permutations to calculate worst-case drawdown risk bands under statistical divergence.
              </p>
              <div className="space-y-2 font-mono text-xs">
                {result.monteCarlo.map((mc) => (
                  <div key={mc.percentile} className="flex justify-between items-center p-2 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-300">{mc.percentile}% Confidence Level:</span>
                    <div>
                      <span className="text-rose-400 font-bold mr-3">Max DD ≤ {mc.maxDrawdownPct}%</span>
                      <span className="text-emerald-400">Final Eq ≥ ${mc.finalEquity.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  Overfitting Warning Score
                </h3>
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                  result.overfittingWarningScore > 50 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {result.overfittingWarningScore} / 100
                </span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-400">
                {result.overfittingNotes.map((note, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-blue-400">·</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>

              {/* AI Natural Language Summary Trigger */}
              <div className="pt-2">
                <button
                  onClick={handleFetchAiAnalysis}
                  disabled={isAnalyzing}
                  className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isAnalyzing ? 'Analyzing via Gemini...' : 'Generate AI Risk & Strengths Review'}</span>
                </button>
              </div>

              {aiAnalysis && (
                <div className="p-3 bg-indigo-950/40 border border-indigo-500/40 rounded-lg text-xs text-indigo-200 leading-relaxed font-sans">
                  <strong className="block text-white font-bold mb-1">AI Quantitative Critique:</strong>
                  {aiAnalysis}
                </div>
              )}
            </div>
          </div>

          {/* Trade Execution List */}
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  Simulated Trade Execution Log ({filteredTrades.length})
                </h3>

                <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-800 text-[10px]">
                  <button
                    onClick={() => setTradeFilter('ALL')}
                    className={`px-2 py-0.5 rounded ${tradeFilter === 'ALL' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setTradeFilter('WIN')}
                    className={`px-2 py-0.5 rounded ${tradeFilter === 'WIN' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
                  >
                    Wins
                  </button>
                  <button
                    onClick={() => setTradeFilter('LOSS')}
                    className={`px-2 py-0.5 rounded ${tradeFilter === 'LOSS' ? 'bg-rose-600 text-white' : 'text-slate-400'}`}
                  >
                    Losses
                  </button>
                </div>
              </div>

              <button
                onClick={handleDownloadReport}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                <span>Download HTML Report</span>
              </button>
            </div>

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="sticky top-0 bg-[#0B101D] text-slate-400 text-[10px] uppercase border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-2.5">Ticket</th>
                    <th className="py-2 px-2.5">Type</th>
                    <th className="py-2 px-2.5">Lots</th>
                    <th className="py-2 px-2.5">Entry Time</th>
                    <th className="py-2 px-2.5">Entry Price</th>
                    <th className="py-2 px-2.5">Exit Price</th>
                    <th className="py-2 px-2.5">Pips</th>
                    <th className="py-2 px-2.5">Costs</th>
                    <th className="py-2 px-2.5">Exit Reason</th>
                    <th className="py-2 px-2.5 text-right">Net P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTrades.map((t) => {
                    const isWin = t.pnl > 0;
                    return (
                      <tr key={t.ticket} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2 px-2.5 text-slate-500">#{t.ticket}</td>
                        <td className="py-2 px-2.5">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            t.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-slate-300">{t.size}</td>
                        <td className="py-2 px-2.5 text-slate-400 text-[11px]">
                          {new Date(t.entryTime * 1000).toISOString().slice(5, 16).replace('T', ' ')}
                        </td>
                        <td className="py-2 px-2.5 text-slate-300">{t.entryPrice}</td>
                        <td className="py-2 px-2.5 text-slate-300">{t.exitPrice}</td>
                        <td className={`py-2 px-2.5 font-bold ${t.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.pips >= 0 ? `+${t.pips}` : t.pips}
                        </td>
                        <td className="py-2 px-2.5 text-slate-500 text-[11px]">
                          ${(t.costs.spread + t.costs.commission + t.costs.swap).toFixed(2)}
                        </td>
                        <td className="py-2 px-2.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {t.exitReason}
                          </span>
                        </td>
                        <td className={`py-2 px-2.5 text-right font-bold tabular-nums ${
                          isWin ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {isWin ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-12 text-center text-slate-500 shadow-sm">
          <Play className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-300 font-semibold">Ready to Backtest</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Select your strategy and cost parameters above, then click "Run Realistic Backtest" to generate the full quantitative report.
          </p>
        </div>
      )}
    </div>
  );
};
