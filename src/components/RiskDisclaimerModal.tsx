import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

interface RiskDisclaimerModalProps {
  isOpen: boolean;
  onAccept: () => void;
}

export const RiskDisclaimerModal: React.FC<RiskDisclaimerModalProps> = ({ isOpen, onAccept }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0F172A] border border-slate-700 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4">
        <div className="flex items-center gap-3 text-amber-400">
          <div className="p-2.5 rounded-lg bg-amber-500/20 border border-amber-500/30">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">
              IMPORTANT FINANCIAL & RISK DISCLOSURE
            </h3>
            <p className="text-xs text-slate-400">Please review before utilizing Zaboraa FX</p>
          </div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 space-y-2.5 leading-relaxed max-h-72 overflow-y-auto">
          <p>
            <strong>1. Leveraged Forex & Precious Metals Trading:</strong> Off-exchange foreign currency and precious metals trading on margin carries a high level of risk and may not be suitable for all investors. High leverage can work against you as well as for you.
          </p>
          <p>
            <strong>2. Hypothetical & Backtested Results:</strong> Backtest results are simulated and constructed with the benefit of hindsight. They do not account for financial risk or real-world execution anomalies such as broker latency, liquidity voids, and slippage. Past results provide no guarantee of future returns.
          </p>
          <p>
            <strong>3. Algorithmic Automation:</strong> Automated trading bots execute programmed logic deterministically. Network disconnections, broker maintenance windows, or volatile economic releases can result in substantial losses exceeding initial margin.
          </p>
          <p>
            <strong>4. Research Honesty:</strong> Zaboraa FX provides isolated WebAssembly sandboxing, heuristic overfitting scores, and empirical TradingView verification to assist quantitative evaluation, not to guarantee financial profitability.
          </p>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onAccept}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            I Understand & Acknowledge the Risks
          </button>
        </div>
      </div>
    </div>
  );
};
