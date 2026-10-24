import React, { useState } from 'react';
import { Strategy, StrategyParamSchema } from '../types/forex';
import { runStrategySmokeTest, validateStrategyCode } from '../engine/workerSandbox';
import {
  Code2,
  Play,
  Save,
  Plus,
  Copy,
  Sliders,
  Check,
  AlertTriangle,
  ShieldCheck,
  Info,
} from 'lucide-react';

interface StrategyStudioViewProps {
  strategies: Strategy[];
  onSelectStrategy: (strat: Strategy) => void;
  onSaveStrategy: (strat: Strategy) => void;
  onLaunchBacktest: (strat: Strategy) => void;
}

export const StrategyStudioView: React.FC<StrategyStudioViewProps> = ({
  strategies,
  onSelectStrategy,
  onSaveStrategy,
  onLaunchBacktest,
}) => {
  const [selectedStratId, setSelectedStratId] = useState<string>(strategies[0]?.id || '');
  const [codeContent, setCodeContent] = useState<string>(strategies[0]?.code || '');
  const [activeParams, setActiveParams] = useState<Record<string, any>>(strategies[0]?.params || {});
  const [copied, setCopied] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [workerTestResult, setWorkerTestResult] = useState<{ passed: boolean; message: string } | null>(null);

  const currentStrat = strategies.find((s) => s.id === selectedStratId) || strategies[0];

  const handleSelectStrat = (s: Strategy) => {
    setSelectedStratId(s.id);
    setCodeContent(s.code);
    setActiveParams(s.params || {});
    setWorkerTestResult(null);
  };

  const handleParamChange = (name: string, value: any) => {
    setActiveParams((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = () => {
    if (!currentStrat) return;
    const updated: Strategy = {
      ...currentStrat,
      code: codeContent,
      params: activeParams,
    };
    onSaveStrategy(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(codeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWorkerSmokeTest = async () => {
    const validation = validateStrategyCode(codeContent);
    if (!validation.isValid) {
      setWorkerTestResult({
        passed: false,
        message: `Validation failed: ${validation.errors.join(' ')}`,
      });
      return;
    }

    const sampleCandles = Array.from({ length: 60 }, (_, idx) => ({
      time: 1700000000 + idx * 3600,
      open: 1.0850 + idx * 0.0001,
      high: 1.0860 + idx * 0.0001,
      low: 1.0840 + idx * 0.0001,
      close: 1.0855 + idx * 0.0001,
      tickVolume: 400,
      spread: 1.0,
    }));

    const res = await runStrategySmokeTest(codeContent, sampleCandles, activeParams);
    if (res.success) {
      setWorkerTestResult({
        passed: true,
        message: `QuickJS WASM sandbox test PASSED in ${res.durationMs}ms (${res.decisionsCount} decisions). Zero lookahead.`,
      });
    } else {
      setWorkerTestResult({
        passed: false,
        message: `QuickJS sandbox halted: ${res.error}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Strategy Selector Strip */}
      <div className="flex items-center justify-between bg-[#0B101D] border border-slate-800 p-2 rounded-xl">
        <div className="flex items-center gap-2 overflow-x-auto">
          {strategies.map((s) => {
            const isSelected = s.id === selectedStratId;
            return (
              <button
                key={s.id}
                onClick={() => handleSelectStrat(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <span>{s.name}</span>
                <span className="ml-1.5 text-[10px] opacity-75 font-mono">v{s.version}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => {
            const newStrat: Strategy = {
              id: `strat_custom_${Date.now()}`,
              name: 'Custom Alpha Strategy',
              description: 'TypeScript StrategyContract for Zaboraa FX.',
              sourceType: 'typescript',
              version: '1.0.0',
              tags: ['Custom', 'TypeScript'],
              paramsSchema: [
                { name: 'period', type: 'number', default: 14, min: 2, max: 100, step: 1, description: 'Period length' },
                { name: 'takeProfitPips', type: 'number', default: 50, min: 10, max: 200, step: 5, description: 'Take profit in pips' },
              ],
              params: { period: 14, takeProfitPips: 50 },
              code: `// Custom Alpha Strategy
// Implements Zaboraa FX TypeScript Strategy Contract

export const strategy = {
  name: "Custom Alpha",
  version: "1.0.0",
  init(ctx) {
    ctx.warmupPeriod = 20;
  },
  onBar(ctx, bar) {
    // Access closed bars via ctx.data
    // Execute: ctx.buy(0.1, sl, tp, "Comment")
  }
};
`,
              createdAt: new Date().toISOString(),
            };
            onSaveStrategy(newStrat);
            setSelectedStratId(newStrat.id);
            setCodeContent(newStrat.code);
            setActiveParams(newStrat.params);
          }}
          className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold shrink-0 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Strategy</span>
        </button>
      </div>

      {/* Limited Sandboxing Notice */}
      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Client-side Web Worker sandbox active. File, DOM, and network access are restricted.</span>
        </div>
        <span className="text-[10px] text-slate-500">TypeScript Native Execution</span>
      </div>

      {saveSuccess && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-xs text-emerald-300 font-mono flex items-center justify-between animate-fadeIn">
          <span>Strategy '{currentStrat?.name}' saved successfully.</span>
        </div>
      )}

      {/* Editor & Parameter Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Code Editor */}
        <div className="lg:col-span-2 bg-[#0D1322] border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                TypeScript StrategyContract
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleWorkerSmokeTest}
                className="px-2.5 py-1 text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded text-xs flex items-center gap-1 transition-colors"
              >
                <Play className="w-3 h-3" />
                <span>Test in Worker</span>
              </button>
              <button
                onClick={handleCopyCode}
                className="px-2.5 py-1 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded text-xs flex items-center gap-1 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold flex items-center gap-1 transition-colors shadow-sm"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>
            </div>
          </div>

          {workerTestResult && (
            <div className={`mb-3 p-2.5 rounded-lg border text-xs font-mono flex items-center gap-2 ${
              workerTestResult.passed
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
            }`}>
              {workerTestResult.passed ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{workerTestResult.message}</span>
            </div>
          )}

          {/* Code Textarea */}
          <div className="relative font-mono text-xs flex-1 min-h-[380px] bg-[#090D16] border border-slate-800/80 rounded-lg p-3 text-slate-200 overflow-auto">
            <textarea
              value={codeContent}
              onChange={(e) => setCodeContent(e.target.value)}
              className="w-full h-full min-h-[380px] bg-transparent text-emerald-300 font-mono text-xs focus:outline-none resize-none leading-relaxed"
              spellCheck={false}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span>Interface: init(ctx), onBar(ctx, bar)</span>
            <span>Single code path runs unchanged in Backtest, Paper, and Live modes</span>
          </div>
        </div>

        {/* Right Column: Parameters & Launch */}
        <div className="space-y-4">
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-lg">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2 mb-3">
              <Sliders className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Strategy Parameters
              </h3>
            </div>

            <div className="space-y-3">
              {currentStrat.paramsSchema.map((param) => {
                const val = activeParams[param.name] !== undefined ? activeParams[param.name] : param.default;
                return (
                  <div key={param.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-mono">{param.name}</span>
                      <span className="text-[10px] text-slate-500">{param.description}</span>
                    </div>

                    <input
                      type={param.type === 'number' ? 'number' : 'text'}
                      step={param.step || 1}
                      min={param.min}
                      max={param.max}
                      value={val}
                      onChange={(e) =>
                        handleParamChange(
                          param.name,
                          param.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80">
              <button
                onClick={() => onLaunchBacktest({ ...currentStrat, params: activeParams })}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-950/40"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Launch in Backtesting Lab</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
