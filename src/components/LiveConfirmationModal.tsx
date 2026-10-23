import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Key } from 'lucide-react';
import { Bot, BrokerAccount } from '../types/forex';

interface LiveConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  bot: Bot;
  account: BrokerAccount;
  onConfirmLive: (liveToken: string) => void;
}

export const LiveConfirmationModal: React.FC<LiveConfirmationModalProps> = ({
  isOpen,
  onClose,
  bot,
  account,
  onConfirmLive,
}) => {
  const [typedLogin, setTypedLogin] = useState('');
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const [isRequestingToken, setIsRequestingToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isLoginMatching = typedLogin.trim() === account.login.trim();
  const canConfirm = isLoginMatching && isAcknowledged && !isRequestingToken;

  const handleProceed = async () => {
    setIsRequestingToken(true);
    setError(null);

    try {
      const resp = await fetch('/api/live/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: bot.id,
          accountLogin: account.login,
          riskLimits: bot.riskLimits,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to acquire live confirmation token');
      }

      onConfirmLive(data.token);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to generate live authorization token');
    } finally {
      setIsRequestingToken(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0F172A] border border-amber-500/70 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4">
        <div className="flex items-center gap-3 text-amber-400">
          <div className="p-2.5 rounded-lg bg-amber-500/20 border border-amber-500/30">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">
              LIVE REAL-CAPITAL DEPLOYMENT
            </h3>
            <p className="text-xs text-amber-300">Mandatory verification and risk acknowledgement</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-2">
          <div className="text-slate-300 font-medium">Verify Target Account & Risk Limits:</div>
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-300">
            <div>Bot: <span className="text-white font-bold">{bot.name}</span></div>
            <div>Symbol: <span className="text-white font-bold">{bot.symbol}</span></div>
            <div>Account Server: <span className="text-white">{account.server}</span></div>
            <div>Target Login: <span className="text-amber-400 font-bold">{account.login}</span></div>
            <div>Max Risk/Trade: <span className="text-rose-400">{bot.riskLimits.maxRiskPctPerTrade}%</span></div>
            <div>Max Lot Size: <span className="text-rose-400">{bot.riskLimits.maxLotSize} lots</span></div>
            <div>Stop-Loss (Broker): <span className="text-emerald-400">{bot.riskLimits.stopLossPips} pips (Mandatory)</span></div>
            <div>Take-Profit: <span className="text-emerald-400">{bot.riskLimits.takeProfitPips} pips</span></div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs text-slate-300">
            To prevent accidental activation, type the target account login number (<strong>{account.login}</strong>) below:
          </div>
          <input
            type="text"
            value={typedLogin}
            onChange={(e) => setTypedLogin(e.target.value)}
            placeholder={`Type ${account.login} to confirm`}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500 placeholder:text-slate-600"
          />

          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300 select-none pt-1">
            <input
              type="checkbox"
              checked={isAcknowledged}
              onChange={(e) => setIsAcknowledged(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
            />
            <span>
              I understand that live orders risk real capital, carry mandatory broker-side stop-losses, and will be reconciled directly with MetaTrader 5.
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleProceed}
            disabled={!canConfirm}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              canConfirm
                ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-950 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            {isRequestingToken ? 'Authorizing Token...' : 'Confirm Live Activation'}
          </button>
        </div>
      </div>
    </div>
  );
};
