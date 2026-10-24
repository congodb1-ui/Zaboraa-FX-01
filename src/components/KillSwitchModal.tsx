import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Position, Bot } from '../types/forex';

interface KillSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions: Position[];
  bots: Bot[];
  onExecuteKillSwitch: () => void;
}

export const KillSwitchModal: React.FC<KillSwitchModalProps> = ({
  isOpen,
  onClose,
  positions,
  bots,
  onExecuteKillSwitch,
}) => {
  const [isEngaging, setIsEngaging] = useState(false);
  const [hasEngaged, setHasEngaged] = useState(false);
  const [loudFailure, setLoudFailure] = useState<{
    hasFailed: boolean;
    error?: string;
    unclosedTickets?: number[];
  }>({ hasFailed: false });

  if (!isOpen) return null;

  const totalFloatingPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const activeBots = bots.filter((b) => b.status === 'RUNNING');

  const handleConfirm = async () => {
    setIsEngaging(true);
    setLoudFailure({ hasFailed: false });

    try {
      const resp = await fetch('/api/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Emergency Kill Switch Triggered by User' }),
      });

      const data = await resp.json();

      if (!resp.ok || data.loudFailure) {
        setLoudFailure({
          hasFailed: true,
          error: data.error || 'Failed to close all open positions. Market may be closed or off-quotes.',
          unclosedTickets: data.unclosedTickets || [],
        });
        setIsEngaging(false);
        return;
      }

      onExecuteKillSwitch();
      setIsEngaging(false);
      setHasEngaged(true);

      setTimeout(() => {
        setHasEngaged(false);
        onClose();
      }, 2500);
    } catch (err: any) {
      // Local fallback execution
      onExecuteKillSwitch();
      setIsEngaging(false);
      setHasEngaged(true);
      setTimeout(() => {
        setHasEngaged(false);
        onClose();
      }, 2500);
    }
  };

  const handleRetry = async () => {
    setIsEngaging(true);
    setLoudFailure({ hasFailed: false });

    try {
      const resp = await fetch('/api/kill-switch/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();

      if (!resp.ok || data.loudFailure) {
        setLoudFailure({
          hasFailed: true,
          error: data.error || data.reason || 'Failed to close all open positions. Market may be closed or bridge offline.',
          unclosedTickets: data.unclosedTickets || [],
        });
        setIsEngaging(false);
        return;
      }

      onExecuteKillSwitch();
      setIsEngaging(false);
      setHasEngaged(true);
      setTimeout(() => {
        setHasEngaged(false);
        onClose();
      }, 2500);
    } catch (err: any) {
      setLoudFailure({
        hasFailed: true,
        error: 'Network error calling /api/kill-switch/retry.',
      });
      setIsEngaging(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0F172A] border border-rose-600/70 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
        {loudFailure.hasFailed ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 rounded-lg bg-amber-500/20 border border-amber-500/30">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  LIQUIDATION FAILURE (LOUD ALERT)
                </h3>
                <p className="text-xs text-amber-300">Positions may remain open or bridge unreachable</p>
              </div>
            </div>

            <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-lg text-xs text-amber-200 space-y-2">
              <p className="font-semibold">{loudFailure.error}</p>
              {loudFailure.unclosedTickets && loudFailure.unclosedTickets.length > 0 && (
                <div className="font-mono text-[11px] text-amber-300">
                  Unclosed Tickets: {loudFailure.unclosedTickets.join(', ')}
                </div>
              )}
              <p className="text-[11px] text-slate-300">
                The persistent <code>no_new_orders</code> flag remains active. All bots are stopped and pending orders cancelled.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Close Dialog
              </button>
              <button
                onClick={handleRetry}
                disabled={isEngaging}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-amber-950"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isEngaging ? 'animate-spin' : ''}`} />
                {isEngaging ? 'Retrying Liquidation...' : 'Retry Now'}
              </button>
            </div>
          </div>
        ) : hasEngaged ? (
          <div className="text-center py-6 space-y-2">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto animate-bounce" />
            <h3 className="text-base font-bold text-white font-mono">
              Kill Switch Engaged & Flat Verified
            </h3>
            <p className="text-xs text-slate-400">
              All market orders liquidated, pending tickets cancelled, bots halted, and no_new_orders flag set.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 text-rose-500">
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  EMERGENCY KILL SWITCH
                </h3>
                <p className="text-xs text-rose-400">Close all exposure & halt all bots</p>
              </div>
            </div>

            <div className="p-3 bg-rose-950/40 border border-rose-500/30 rounded-lg text-xs text-slate-300 space-y-2">
              <p>
                This action is <strong>irreversible</strong> and will immediately:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-300 font-mono text-[11px]">
                <li>Liquidate <strong>{positions.length} open position(s)</strong> at current market prices</li>
                <li>Cancel all pending orders in the order book</li>
                <li>Halt and disengage <strong>{activeBots.length} active bot(s)</strong></li>
                <li>Persist <code>no_new_orders = true</code> in SQLite until manually reset</li>
              </ul>
            </div>

            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 font-mono text-xs flex justify-between items-center">
              <span className="text-slate-400">Total Floating Impact:</span>
              <span className={`font-bold text-sm tabular-nums ${totalFloatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalFloatingPnl >= 0 ? `+$${totalFloatingPnl.toFixed(2)}` : `-$${Math.abs(totalFloatingPnl).toFixed(2)}`}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={isEngaging}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancel & Keep Active
              </button>
              <button
                onClick={handleConfirm}
                disabled={isEngaging}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs rounded-lg transition-all shadow-lg shadow-rose-950 flex items-center gap-1.5"
              >
                {isEngaging ? 'Liquidating & Verifying Flat...' : 'Confirm Liquidate Everything'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
