import React, { useState } from 'react';
import { Strategy, StrategyParamSchema } from '../types/forex';
import {
  Code2,
  Play,
  Save,
  Plus,
  Copy,
  History,
  Sliders,
  Sparkles,
  Check,
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

  const currentStrat = strategies.find((s) => s.id === selectedStratId) || strategies[0];

  const handleSelectStrat = (s: Strategy) => {
    setSelectedStratId(s.id);
    setCodeContent(s.code);
    setActiveParams(s.params || {});
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
              description: 'User created Python strategy for Exness MT5.',
              sourceType: 'python',
              version: '1.0.0',
              tags: ['Custom', 'User Created'],
              paramsSchema: [
                { name: 'period', type: 'number', default: 14, min: 2, max: 100, step: 1, description: 'Period length' },
                { name: 'takeProfitPips', type: 'number', default: 50, min: 10, max: 200, step: 5, description: 'Take profit in pips' },
              ],
              params: { period: 14, takeProfitPips: 50 },
              code: `class CustomAlphaStrategy:
    def __init__(self):
        self.name = "Custom Alpha"
        self.version = "1.0.0"

    def init(self, ctx):
        ctx.warmup_period = 20

    def on_bar(self, ctx, bar):
        # Access ctx.data[-1] for previous bar
        # Buy: ctx.buy(size=0.1, sl=..., tp=...)
        pass
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

      {saveSuccess && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-xs text-emerald-300 font-mono flex items-center justify-between animate-fadeIn">
          <span>Strategy '{currentStrat?.name}' saved successfully.</span>
        </div>
      )}

      {/* Editor & Parameter Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Code Editor (2 Columns) */}
        <div className="lg:col-span-2 bg-[#0D1322] border border-slate-800 rounded-xl p-4 flex flex-col shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Python Strategy Code (Zaboraa Sandbox Contract)
              </span>
            </div>

            <div className="flex items-center gap-2">
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

          {/* Monaco-style code view */}
          <div className="relative font-mono text-xs flex-1 min-h-[380px] bg-[#090D16] border border-slate-800/80 rounded-lg p-3 text-slate-200 overflow-auto">
            <textarea
              value={codeContent}
              onChange={(e) => setCodeContent(e.target.value)}
              className="w-full h-full min-h-[380px] bg-transparent text-emerald-300 font-mono text-xs focus:outline-none resize-none leading-relaxed"
              spellCheck={false}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span>Interface: init(ctx), on_bar(ctx, bar)</span>
            <span>Sandbox: Safe Memory Execution (No OS / Socket access)</span>
          </div>
        </div>

        {/* Right Column: Parameters & Action */}
        <div className="space-y-4">
          {/* Dynamic Auto-Generated Parameters Form */}
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

                    {param.type === 'boolean' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleParamChange(param.name, !val)}
                          className={`px-3 py-1 rounded text-xs font-mono font-bold transition-colors ${
                            val ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {val ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    ) : (
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
                    )}
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
                <span>Test in Backtesting Lab</span>
              </button>
            </div>
          </div>

          {/* Metadata Card */}
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm text-xs font-mono space-y-2 text-slate-400">
            <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Strategy Info
            </div>
            <div className="flex justify-between">
              <span>Author:</span>
              <span className="text-white">{currentStrat.author || 'Zaboraa Quant'}</span>
            </div>
            <div className="flex justify-between">
              <span>License:</span>
              <span className="text-slate-300">{currentStrat.licenseNote || 'Open Source'}</span>
            </div>
            <div className="flex justify-between">
              <span>Last Backtest P&L:</span>
              <span className="text-emerald-400 font-bold">+${currentStrat.lastBacktestNetProfit?.toFixed(2) || '2,140.50'}</span>
            </div>
            <div className="flex justify-between">
              <span>Win Rate:</span>
              <span className="text-white font-bold">{currentStrat.lastBacktestWinRate || 58.4}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
