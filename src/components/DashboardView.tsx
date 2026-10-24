import React from 'react';
import {
  BrokerAccount,
  Position,
  Bot,
  SymbolName,
} from '../types/forex';
import { SYMBOL_SPECS } from '../services/marketData';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Layers,
  Bot as BotIcon,
  Sparkles,
  FlaskConical,
  XCircle,
  ExternalLink,
} from 'lucide-react';

interface DashboardViewProps {
  account: BrokerAccount;
  positions: Position[];
  bots: Bot[];
  onNavigate: (tab: any) => void;
  onClosePosition: (ticket: number) => void;
  onSelectSymbol: (symbol: SymbolName) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  account,
  positions,
  bots,
  onNavigate,
  onClosePosition,
  onSelectSymbol,
}) => {
  const activeBots = bots.filter((b) => b.status === 'RUNNING');
  const openPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const todayPnl = bots.reduce((sum, b) => sum + b.todayPnl, 0) + openPnl;

  const symbolsList: SymbolName[] = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

  return (
    <div className="space-y-6">
      {/* Simulation Notice Banner */}
      {(!account.isConnected || account.isSimulated) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 px-4 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2 font-mono">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
              SIMULATED
            </span>
            <span>SIMULATION: no broker connected. Metrics and portfolio are operating in paper mode.</span>
          </div>
        </div>
      )}

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Account Balance</span>
            <DollarSign className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white tabular-nums">
            ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Leverage 1:{account.leverage} · Exness</div>
        </div>

        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Floating Equity</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${account.equity >= account.balance ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Free Margin: ${account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 0 })}</div>
        </div>

        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Open Floating P&L</span>
            {openPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> : <TrendingDown className="w-3.5 h-3.5 text-rose-400" />}
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${openPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {openPnl >= 0 ? `+$${openPnl.toFixed(2)}` : `-$${Math.abs(openPnl).toFixed(2)}`}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{positions.length} open position(s)</div>
        </div>

        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Active Automated Bots</span>
            <BotIcon className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white tabular-nums">
            {activeBots.length} <span className="text-xs text-slate-400 font-normal">/ {bots.length}</span>
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">Today Net: {todayPnl >= 0 ? `+$${todayPnl.toFixed(2)}` : `-$${Math.abs(todayPnl).toFixed(2)}`}</div>
        </div>
      </div>

      {/* Exness Live Price Ticker & Symbol Grid */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white tracking-tight">Exness Watchlist & Spreads</h2>
            <span className="text-[11px] text-slate-400">· Real-time pricing & contract specs</span>
          </div>
          <button
            onClick={() => onNavigate('markets')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
          >
            <span>Open Chart Terminal</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {symbolsList.map((sym) => {
            const spec = SYMBOL_SPECS[sym];
            return (
              <div
                key={sym}
                onClick={() => {
                  onSelectSymbol(sym);
                  onNavigate('markets');
                }}
                className="bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/50 rounded-lg p-3 cursor-pointer transition-all hover:bg-slate-800/40 group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono font-bold text-sm text-white group-hover:text-blue-400 transition-colors">
                    {sym}
                    <span className="text-[10px] text-slate-500 ml-1 font-normal">({sym}m)</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {spec.spreadPips} pips
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-slate-950/50 p-1.5 rounded border border-slate-800/50">
                    <div className="text-[10px] text-slate-500 uppercase">Bid</div>
                    <div className="text-slate-200 font-semibold tabular-nums">{spec.bid.toFixed(spec.digits)}</div>
                  </div>
                  <div className="bg-slate-950/50 p-1.5 rounded border border-slate-800/50">
                    <div className="text-[10px] text-slate-500 uppercase">Ask</div>
                    <div className="text-slate-200 font-semibold tabular-nums">{spec.ask.toFixed(spec.digits)}</div>
                  </div>
                </div>

                <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
                  <span>Contract: {spec.contractSize.toLocaleString()}</span>
                  <span>Swap: {spec.swapLong} / {spec.swapShort}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Launchpad & Workspaces */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <div
          onClick={() => onNavigate('pine')}
          className="bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/30 hover:border-indigo-500/60 rounded-xl p-4 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 group-hover:scale-110 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Pine Script AI Converter</h3>
              <p className="text-[11px] text-indigo-300/80">TradingView v4/v5 to Python with Gemini</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Paste any open-source Pine Script strategy. The AI translator validates look-ahead hazards, extracts parameter schemas, and generates runnable code.
          </p>
        </div>

        <div
          onClick={() => onNavigate('backtest')}
          className="bg-gradient-to-br from-blue-950/40 to-slate-900 border border-blue-500/30 hover:border-blue-500/60 rounded-xl p-4 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 group-hover:scale-110 transition-transform">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Event-Driven Backtest Lab</h3>
              <p className="text-[11px] text-blue-300/80">Spreads, slippage & Monte Carlo testing</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Run realistic simulations with Exness commission models, overnight swap rollover, intrabar stop-loss resolution, and underwater drawdowns.
          </p>
        </div>

        <div
          onClick={() => onNavigate('bots')}
          className="bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 hover:border-emerald-500/60 rounded-xl p-4 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
              <BotIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Automated Bot Execution</h3>
              <p className="text-[11px] text-emerald-300/80">Paper & Demo-live execution</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Deploy strategies with strict risk constraints: max risk % per trade, max open positions, spread cutoff, and one-click emergency kill switch.
          </p>
        </div>
      </div>

      {/* Open Positions Table */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-bold text-white">Live Open Positions ({positions.length})</h2>
          </div>
          <button
            onClick={() => onNavigate('positions')}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Manage Positions
          </button>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No open market positions at present. Start a bot or place an order via the Markets tab.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                  <th className="py-2 px-3">Ticket</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Lots</th>
                  <th className="py-2 px-3">Open Price</th>
                  <th className="py-2 px-3">Current</th>
                  <th className="py-2 px-3">SL</th>
                  <th className="py-2 px-3">TP</th>
                  <th className="py-2 px-3 text-right">Pips</th>
                  <th className="py-2 px-3 text-right">Floating P&L</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {positions.map((pos) => {
                  const isProfit = pos.pnl >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 px-3 text-slate-400">#{pos.ticket}</td>
                      <td className="py-2 px-3 font-bold text-white">{pos.symbol}</td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          pos.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {pos.side}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-300">{pos.volume}</td>
                      <td className="py-2 px-3 text-slate-300">{pos.openPrice}</td>
                      <td className="py-2 px-3 text-slate-300">{pos.currentPrice}</td>
                      <td className="py-2 px-3 text-slate-400">{pos.sl || '-'}</td>
                      <td className="py-2 px-3 text-slate-400">{pos.tp || '-'}</td>
                      <td className={`py-2 px-3 text-right font-semibold ${pos.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos.pips >= 0 ? `+${pos.pips}` : pos.pips}
                      </td>
                      <td className={`py-2 px-3 text-right font-bold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isProfit ? `+$${pos.pnl.toFixed(2)}` : `-$${Math.abs(pos.pnl).toFixed(2)}`}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => onClosePosition(pos.ticket)}
                          className="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded text-[10px] font-sans font-semibold transition-colors"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
