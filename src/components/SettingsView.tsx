import React, { useState } from 'react';
import { BrokerAccount, RiskSettings, AuditLogEntry } from '../types/forex';
import { runKnownAnswerSelfTests, TestResultItem } from '../engine/knownAnswerTests';
import {
  Sliders,
  Shield,
  Server,
  RefreshCw,
  CheckCircle2,
  FileText,
  AlertTriangle,
  Terminal,
  Activity,
  Check,
  X,
  ExternalLink,
} from 'lucide-react';

interface SettingsViewProps {
  account: BrokerAccount;
  riskSettings: RiskSettings;
  auditLogs: AuditLogEntry[];
  onUpdateBroker: (updated: Partial<BrokerAccount>) => void;
  onUpdateRiskSettings: (updated: RiskSettings) => void;
  bridgeStatus: { isOnline: boolean; serverName?: string; accountType?: string; error?: string };
  onTestBridge: (url: string, token: string) => Promise<boolean>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  account,
  riskSettings,
  auditLogs,
  onUpdateBroker,
  onUpdateRiskSettings,
  bridgeStatus,
  onTestBridge,
}) => {
  // Bridge connection state
  const [bridgeUrl, setBridgeUrl] = useState('http://127.0.0.1:8001');
  const [bridgeToken, setBridgeToken] = useState('');
  const [isTestingBridge, setIsTestingBridge] = useState(false);
  const [bridgeTestMessage, setBridgeTestMessage] = useState<{ text: string; success: boolean } | null>(null);

  // Self-test results
  const [selfTestResults, setSelfTestResults] = useState<TestResultItem[]>(() => runKnownAnswerSelfTests());
  const [isReRunningTests, setIsReRunningTests] = useState(false);

  // Risk settings state
  const [maxRisk, setMaxRisk] = useState(riskSettings.maxRiskPerTradePct);
  const [maxLot, setMaxLot] = useState(riskSettings.maxLotSize);
  const [maxOpen, setMaxOpen] = useState(riskSettings.maxOpenPositionsTotal);
  const [maxSpread, setMaxSpread] = useState(riskSettings.maxAllowedSpreadPips);
  const [dailyLoss, setDailyLoss] = useState(riskSettings.maxDailyLossPct);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const handleTestBridge = async () => {
    setIsTestingBridge(true);
    setBridgeTestMessage(null);

    const online = await onTestBridge(bridgeUrl, bridgeToken);
    setIsTestingBridge(false);

    if (online) {
      setBridgeTestMessage({
        text: `Successfully linked to Exness MT5 bridge on 127.0.0.1:8001 (${bridgeStatus.serverName || 'Exness-MT5Trial9'}, Account: DEMO).`,
        success: true,
      });
    } else {
      setBridgeTestMessage({
        text: `Bridge unreachable on ${bridgeUrl}. When running in cloud preview, browser localhost isolation prevents direct connection. Start mt5-bridge locally on Windows.`,
        success: false,
      });
    }
  };

  const handleReRunTests = () => {
    setIsReRunningTests(true);
    setTimeout(() => {
      setSelfTestResults(runKnownAnswerSelfTests());
      setIsReRunningTests(false);
    }, 200);
  };

  const allPassed = selfTestResults.every((t) => t.passed);

  return (
    <div className="space-y-6">
      {/* 1. Engine Mathematical Self-Test Card */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Engine Mathematical Self-Test
              </h2>
              <p className="text-[11px] text-slate-400">
                Known-answer unit test suite · Hand-calculated pip math, multi-day swaps, worst-case SL conflicts, and lookahead invariance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold flex items-center gap-1 ${
              allPassed
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            }`}>
              {allPassed ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              <span>Engine Status: {allPassed ? 'ALL TESTS PASS (10/10)' : 'FAILURES DETECTED'}</span>
            </span>

            <button
              onClick={handleReRunTests}
              disabled={isReRunningTests}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
            >
              <RefreshCw className={`w-3 h-3 ${isReRunningTests ? 'animate-spin' : ''}`} />
              <span>Re-run Tests</span>
            </button>
          </div>
        </div>

        {/* Tests Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                <th className="py-2 px-3">Test Name & Formula</th>
                <th className="py-2 px-3">Category</th>
                <th className="py-2 px-3">Expected Value</th>
                <th className="py-2 px-3">Actual Value</th>
                <th className="py-2 px-3 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {selfTestResults.map((t) => (
                <tr key={t.id} className="hover:bg-slate-800/30">
                  <td className="py-2 px-3">
                    <div className="font-semibold text-white">{t.name}</div>
                    <div className="text-[10px] text-slate-500 font-sans">{t.description}</div>
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      {t.category}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-300">{t.expected}</td>
                  <td className="py-2 px-3 text-blue-300 font-semibold">{t.actual}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      t.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {t.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Standalone MT5 Bridge Configuration & Diagnostics */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-400" />
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Exness MetaTrader 5 Bridge Link (/mt5-bridge)
              </h2>
              <p className="text-[11px] text-slate-400">
                Bound to 127.0.0.1:8001 on your Windows machine · Read-only safety enabled by default
              </p>
            </div>
          </div>

          <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
            bridgeStatus.isOnline
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-800 text-slate-400'
          }`}>
            {bridgeStatus.isOnline ? `BRIDGE ONLINE (${bridgeStatus.serverName || 'Exness-MT5Trial9'})` : 'BRIDGE OFFLINE'}
          </span>
        </div>

        {bridgeTestMessage && (
          <div className={`p-3 rounded-lg text-xs font-mono flex items-start gap-2 ${
            bridgeTestMessage.success
              ? 'bg-emerald-950/60 border border-emerald-500/50 text-emerald-300'
              : 'bg-amber-950/60 border border-amber-500/50 text-amber-300'
          }`}>
            {bridgeTestMessage.success ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
            <div>{bridgeTestMessage.text}</div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Bridge Gateway URL</label>
            <input
              type="text"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Bearer Auth Token</label>
            <input
              type="password"
              value={bridgeToken}
              onChange={(e) => setBridgeToken(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Configured Server Suffix</label>
            <input
              type="text"
              value={account.symbolSuffix}
              onChange={(e) => onUpdateBroker({ symbolSuffix: e.target.value })}
              placeholder='e.g. "m" for Standard'
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-slate-500 font-mono">
            Demo account: {account.server} · Login: {account.login}
          </span>
          <button
            onClick={handleTestBridge}
            disabled={isTestingBridge}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-blue-900/30"
          >
            {isTestingBridge && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>Test Bridge Connection</span>
          </button>
        </div>

        {/* Unreachable Troubleshooting Guide */}
        {!bridgeStatus.isOnline && (
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2.5 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <Terminal className="w-4 h-4" />
              <span>How to start the MT5 Bridge locally on Windows:</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              The bridge communicates with the MetaTrader 5 desktop terminal on Windows via IPC. Run these commands in Windows PowerShell:
            </p>
            <pre className="bg-[#090D16] border border-slate-800 p-3 rounded-lg font-mono text-[11px] text-emerald-300 overflow-x-auto leading-relaxed">
cd mt5-bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001
            </pre>
            <p className="text-[10px] text-slate-500">
              Note: Cloud-hosted previews cannot access localhost ports directly. To link with real MT5 candles, run Zaboraa FX on your local machine.
            </p>
          </div>
        )}
      </div>

      {/* 3. Institutional Risk Firewall Rules */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">
              Risk Firewall Global Rules
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Max Risk % / Trade</label>
            <input
              type="number"
              step="0.5"
              value={maxRisk}
              onChange={(e) => setMaxRisk(parseFloat(e.target.value) || 1)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Max Lot Size</label>
            <input
              type="number"
              step="0.1"
              value={maxLot}
              onChange={(e) => setMaxLot(parseFloat(e.target.value) || 0.1)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Max Open Positions</label>
            <input
              type="number"
              value={maxOpen}
              onChange={(e) => setMaxOpen(parseInt(e.target.value) || 1)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Spread Cutoff (Pips)</label>
            <input
              type="number"
              step="0.5"
              value={maxSpread}
              onChange={(e) => setMaxSpread(parseFloat(e.target.value) || 2)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Daily Stop Loss %</label>
            <input
              type="number"
              step="1.0"
              value={dailyLoss}
              onChange={(e) => setDailyLoss(parseFloat(e.target.value) || 5)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-white text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {savedFeedback && (
            <span className="text-xs font-semibold text-emerald-400">
              ✓ Risk firewall parameters saved.
            </span>
          )}
          <button
            onClick={() => {
              onUpdateRiskSettings({
                ...riskSettings,
                maxRiskPerTradePct: maxRisk,
                maxLotSize: maxLot,
                maxOpenPositionsTotal: maxOpen,
                maxAllowedSpreadPips: maxSpread,
                maxDailyLossPct: dailyLoss,
              });
              setSavedFeedback(true);
              setTimeout(() => setSavedFeedback(false), 4000);
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors"
          >
            Save Risk Firewall Defaults
          </button>
        </div>
      </div>
    </div>
  );
};
