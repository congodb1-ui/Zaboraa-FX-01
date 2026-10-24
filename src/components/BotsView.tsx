import React, { useState } from 'react';
import { Bot, Strategy, SymbolName, Timeframe, BrokerAccount } from '../types/forex';
import { LiveConfirmationModal } from './LiveConfirmationModal';
import {
  Bot as BotIcon,
  Play,
  Pause,
  Square,
  Plus,
  Shield,
  Activity,
  Terminal,
  AlertTriangle,
  CheckCircle,
  Key,
} from 'lucide-react';

interface BotsViewProps {
  bots: Bot[];
  strategies: Strategy[];
  account: BrokerAccount;
  errorMessage?: string | null;
  onDismissError?: () => void;
  onUpdateBotStatus: (botId: string, newStatus: 'RUNNING' | 'PAUSED' | 'STOPPED') => void;
  onCreateBot: (newBot: Bot) => void;
}

export const BotsView: React.FC<BotsViewProps> = ({
  bots,
  strategies,
  account,
  errorMessage,
  onDismissError,
  onUpdateBotStatus,
  onCreateBot,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedBotLogs, setSelectedBotLogs] = useState<Bot | null>(null);
  const [liveConfirmBot, setLiveConfirmBot] = useState<Bot | null>(null);

  // New Bot Form State
  const [botName, setBotName] = useState('EURUSD Trend Bot');
  const [strategyId, setStrategyId] = useState(strategies[0]?.id || '');
  const [symbol, setSymbol] = useState<SymbolName>('EURUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [mode, setMode] = useState<'PAPER' | 'DEMO_LIVE' | 'LIVE'>('DEMO_LIVE');
  const [maxRiskPct, setMaxRiskPct] = useState(1.5);
  const [maxLotSize, setMaxLotSize] = useState(0.5);
  const [maxOpenPositions, setMaxOpenPositions] = useState(2);
  const [maxSpreadPips, setMaxSpreadPips] = useState(2.0);

  const [pendingLiveBot, setPendingLiveBot] = useState<Bot | null>(null);

  const handleCreate = () => {
    const strat = strategies.find((s) => s.id === strategyId) || strategies[0];
    const candidateBot: Bot = {
      id: `bot_${Date.now()}`,
      name: botName,
      strategyId: strat.id,
      strategyName: strat.name,
      accountId: account.login,
      symbol,
      timeframe,
      mode,
      status: 'RUNNING',
      params: strat.params || {},
      riskLimits: {
        maxRiskPctPerTrade: maxRiskPct,
        maxLotSize,
        maxOpenPositions,
        maxDailyLossUSD: 200,
        stopLossPips: 30,
        takeProfitPips: 60,
        maxSpreadPips,
      },
      todayPnl: 0,
      totalPnl: 0,
      tradesCount: 0,
      lastHeartbeat: new Date().toISOString(),
      lastSignal: {
        action: 'HOLD',
        time: new Date().toLocaleTimeString(),
        price: symbol === 'XAUUSD' ? 2734.25 : 1.0845,
        reason: 'Waiting for next bar close',
      },
      logs: [
        { time: new Date().toLocaleTimeString(), level: 'INFO', message: `Bot initialized on ${symbol} ${timeframe} (${mode} mode)` },
        { time: new Date().toLocaleTimeString(), level: 'INFO', message: 'Risk manager attached. Heartbeat active.' },
      ],
    };

    if (mode === 'LIVE') {
      setPendingLiveBot(candidateBot);
      setShowCreateModal(false);
      return;
    }

    onCreateBot(candidateBot);
    setShowCreateModal(false);
  };

  const handleConfirmLiveToken = (liveToken: string) => {
    if (pendingLiveBot) {
      const activeBot: Bot = {
        ...pendingLiveBot,
        mode: 'LIVE',
        logs: [
          ...pendingLiveBot.logs,
          {
            time: new Date().toLocaleTimeString(),
            level: 'WARN',
            message: `LIVE trading gate cleared. Single-use token acquired: ${liveToken.slice(0, 8)}... (60s TTL)`,
          },
        ],
      };
      onCreateBot(activeBot);
      setPendingLiveBot(null);
    } else if (liveConfirmBot) {
      onUpdateBotStatus(liveConfirmBot.id, 'RUNNING');
      setLiveConfirmBot(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Trading Disabled / Action Error Banner */}
      {errorMessage && (
        <div className="bg-rose-500/15 border border-rose-500/40 rounded-xl p-4 flex items-center justify-between text-xs text-rose-300 font-mono shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="text-slate-400 hover:text-white text-[11px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Simulation Notice Banner */}
      {(!account.isConnected || account.isSimulated) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 px-4 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2 font-mono">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
              SIMULATED
            </span>
            <span>SIMULATION: no broker connected. Bots run in simulated environment. Real execution requires an active MT5 bridge.</span>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <BotIcon className="w-4 h-4 text-emerald-400" />
            Automated Strategy Bot Runner
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time closed bar evaluation with strict risk firewalls & Exness MT5 order routing
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/30"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Deploy New Bot</span>
        </button>
      </div>

      {/* Bots Grid */}
      {bots.length === 0 ? (
        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-12 text-center shadow-sm">
          <BotIcon className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-300">No Automated Trading Bots</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Zero bots are currently deployed. Bots run with strict risk controls, closed-bar signals, and simulated paper or broker order routing.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg inline-flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Deploy First Bot</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map((bot) => {
            const isRunning = bot.status === 'RUNNING';
            const isPaused = bot.status === 'PAUSED';

          return (
            <div
              key={bot.id}
              className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-lg space-y-4"
            >
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">{bot.name}</h3>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {bot.symbol} · {bot.timeframe} · {bot.strategyName}
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    bot.mode === 'LIVE'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : bot.mode === 'DEMO_LIVE'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {bot.mode}
                  </span>
                </div>

                {/* Telemetry Strip */}
                <div className="grid grid-cols-3 gap-2 font-mono text-xs mb-3">
                  <div className="bg-slate-900 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500">Status</div>
                    <div className={`font-bold mt-0.5 ${
                      isRunning ? 'text-emerald-400' : isPaused ? 'text-amber-400' : 'text-slate-500'
                    }`}>
                      {bot.status}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500">Today P&L</div>
                    <div className={`font-bold mt-0.5 ${bot.todayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {bot.todayPnl >= 0 ? `+$${bot.todayPnl.toFixed(2)}` : `-$${Math.abs(bot.todayPnl).toFixed(2)}`}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800/60">
                    <div className="text-[10px] text-slate-500">Trades</div>
                    <div className="text-white font-bold mt-0.5">{bot.tradesCount}</div>
                  </div>
                </div>

                {/* Risk Constraints Summary */}
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-[11px] font-mono text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Risk / Trade:</span>
                    <span className="text-slate-200">{bot.riskLimits.maxRiskPctPerTrade}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Max Lot Size:</span>
                    <span className="text-slate-200">{bot.riskLimits.maxLotSize} lots</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Max Spread Cutoff:</span>
                    <span className="text-slate-200">{bot.riskLimits.maxSpreadPips} pips</span>
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {isRunning ? (
                    <button
                      onClick={() => onUpdateBotStatus(bot.id, 'PAUSED')}
                      className="p-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded transition-colors"
                      title="Pause Bot"
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onUpdateBotStatus(bot.id, 'RUNNING')}
                      className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded transition-colors"
                      title="Start Bot"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => onUpdateBotStatus(bot.id, 'STOPPED')}
                    className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded transition-colors"
                    title="Stop & Disengage"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  onClick={() => setSelectedBotLogs(bot)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono rounded flex items-center gap-1 transition-colors"
                >
                  <Terminal className="w-3 h-3 text-blue-400" />
                  <span>Logs</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Bot Logs Modal */}
      {selectedBotLogs && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 max-w-lg w-full shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white font-mono">
                  {selectedBotLogs.name} Execution Log
                </h3>
              </div>
              <button
                onClick={() => setSelectedBotLogs(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 max-h-60 overflow-y-auto space-y-1.5">
              {selectedBotLogs.logs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-slate-500 text-[10px] shrink-0">{log.time}</span>
                  <span className={`px-1 rounded text-[9px] font-bold shrink-0 ${
                    log.level === 'WARN' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {log.level}
                  </span>
                  <span className="text-slate-300 leading-tight">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Deploy Bot Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F172A] border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Deploy Automated Strategy Bot</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-xs text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Bot Name</label>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Strategy</label>
                  <select
                    value={strategyId}
                    onChange={(e) => setStrategyId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  >
                    {strategies.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Symbol</label>
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value as SymbolName)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  >
                    <option value="EURUSD">EURUSD</option>
                    <option value="GBPUSD">GBPUSD</option>
                    <option value="USDJPY">USDJPY</option>
                    <option value="XAUUSD">XAUUSD</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Execution Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  >
                    <option value="PAPER">Paper Trading (Simulated)</option>
                    <option value="DEMO_LIVE">Demo-Live (Exness Demo)</option>
                    <option value="LIVE">Live Trading (Real Account)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Timeframe</label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  >
                    <option value="M5">M5</option>
                    <option value="M15">M15</option>
                    <option value="H1">H1</option>
                    <option value="H4">H4</option>
                  </select>
                </div>
              </div>

              {/* Risk Controls */}
              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-2">
                <div className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" /> Risk Firewall Limits
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <div>
                    <label className="text-[10px] text-slate-500">Max Risk % / Trade</label>
                    <input
                      type="number"
                      step="0.5"
                      value={maxRiskPct}
                      onChange={(e) => setMaxRiskPct(parseFloat(e.target.value) || 1)}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Max Lot Size</label>
                    <input
                      type="number"
                      step="0.1"
                      value={maxLotSize}
                      onChange={(e) => setMaxLotSize(parseFloat(e.target.value) || 0.1)}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Explicit Live Opt-in */}
              {mode === 'LIVE' && (
                <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-lg space-y-1.5">
                  <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                    <AlertTriangle className="w-4 h-4" /> Real Capital Safeguard Gate
                  </div>
                  <p className="text-[11px] text-rose-200">
                    A cryptographic gate will require you to confirm account login <strong>#{account.login}</strong> and review risk thresholds before single-use broker access is granted.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors shadow-md shadow-emerald-950/40"
              >
                {mode === 'LIVE' ? 'Proceed to Live Gate' : 'Launch Bot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Confirmation Modal */}
      {(pendingLiveBot || liveConfirmBot) && (
        <LiveConfirmationModal
          isOpen={Boolean(pendingLiveBot || liveConfirmBot)}
          onClose={() => {
            setPendingLiveBot(null);
            setLiveConfirmBot(null);
          }}
          bot={(pendingLiveBot || liveConfirmBot)!}
          account={account}
          onConfirmLive={handleConfirmLiveToken}
        />
      )}
    </div>
  );
};
