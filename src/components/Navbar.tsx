import React, { useState } from 'react';
import {
  ShieldAlert,
  Wifi,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  PlayCircle
} from 'lucide-react';
import { BrokerAccount } from '../types/forex';

interface NavbarProps {
  account: BrokerAccount;
  onToggleAccountMode: (newMode: 'DEMO' | 'LIVE') => void;
  activeBotsCount: number;
  onOpenKillSwitch: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  account,
  onToggleAccountMode,
  activeBotsCount,
  onOpenKillSwitch,
}) => {
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showLiveWarning, setShowLiveWarning] = useState(false);

  const handleSelectMode = (mode: 'DEMO' | 'LIVE') => {
    setShowAccountDropdown(false);
    if (mode === 'LIVE' && account.mode === 'DEMO') {
      setShowLiveWarning(true);
    } else {
      onToggleAccountMode(mode);
    }
  };

  return (
    <>
      <header className="h-14 border-b border-slate-800/80 bg-[#0B101D] px-4 flex items-center justify-between gap-8 select-none z-30 sticky top-0">
        {/* Zone 1: Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-black text-sm tracking-tighter">
            ZB
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5 font-sans">
              Zaboraa <span className="text-blue-400 font-extrabold">FX</span>
            </span>
          </div>
        </div>

        {/* Zone 2: Account Status & Central Telemetry */}
        <div className="hidden md:flex items-center gap-6 text-xs text-slate-400">
          {/* Connection status */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${account.isConnected ? 'bg-emerald-400' : 'bg-rose-400'} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${account.isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
            </span>
            <span className="text-slate-300 font-medium">Exness MT5</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-400">{account.server}</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Account Balance & Equity */}
          <div className="flex items-center gap-3 font-mono">
            <div>
              <span className="text-slate-500 text-[11px] mr-1">Bal:</span>
              <span className="text-slate-200 font-semibold tabular-nums">
                ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[11px] mr-1">Eq:</span>
              <span className={`font-semibold tabular-nums ${account.equity >= account.balance ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Active Bots */}
          <div className="flex items-center gap-1.5 text-slate-300">
            <PlayCircle className="w-3.5 h-3.5 text-blue-400" />
            <span>Bots: <strong className="font-mono text-white">{activeBotsCount}</strong> active</span>
          </div>
        </div>

        {/* Zone 3: Actions & Kill Switch */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Account Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-all ${
                account.mode === 'LIVE'
                  ? 'bg-rose-950/40 border-rose-600/50 text-rose-300 hover:bg-rose-900/50'
                  : 'bg-emerald-950/30 border-emerald-600/40 text-emerald-300 hover:bg-emerald-900/40'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              <span>{account.mode === 'LIVE' ? 'LIVE ACCOUNT' : 'DEMO ACCOUNT'}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {showAccountDropdown && (
              <div className="absolute right-0 mt-1.5 w-60 bg-[#0F172A] border border-slate-700/80 rounded-lg shadow-2xl py-1 z-50 text-xs">
                <div className="px-3 py-2 border-b border-slate-800 text-[11px] text-slate-400">
                  Switch Active Trading Mode
                </div>
                <button
                  onClick={() => handleSelectMode('DEMO')}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-800/60 transition-colors text-slate-200"
                >
                  <div>
                    <div className="font-semibold text-emerald-400">Demo Environment</div>
                    <div className="text-[10px] text-slate-400">Safe simulation & test fills</div>
                  </div>
                  {account.mode === 'DEMO' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                </button>
                <button
                  onClick={() => handleSelectMode('LIVE')}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-800/60 transition-colors text-slate-200"
                >
                  <div>
                    <div className="font-semibold text-rose-400">Exness Live Trading</div>
                    <div className="text-[10px] text-slate-400">Real capital & real broker orders</div>
                  </div>
                  {account.mode === 'LIVE' && <CheckCircle2 className="w-4 h-4 text-rose-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Emergency Kill Switch Button */}
          <button
            onClick={onOpenKillSwitch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-md shadow-rose-950 hover:shadow-rose-900 active:scale-95 whitespace-nowrap"
            title="Emergency halt all bots and close all open market positions"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Kill Switch</span>
          </button>
        </div>
      </header>

      {/* Confirmation modal before switching to LIVE */}
      {showLiveWarning && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F172A] border border-rose-500/40 rounded-xl p-5 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Enable Exness Live Trading Mode?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Switching to <strong>LIVE</strong> mode routes orders directly to your Exness real account. Real capital will be subjected to market risks and margin requirements.
            </p>
            <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 mb-4 text-xs font-mono space-y-1 text-slate-400">
              <div>Account: <span className="text-white">{account.login}</span></div>
              <div>Server: <span className="text-white">{account.server}</span></div>
              <div>Suffix: <span className="text-white">{account.symbolSuffix || 'none'}</span></div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowLiveWarning(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLiveWarning(false);
                  onToggleAccountMode('LIVE');
                }}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Confirm Live Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
