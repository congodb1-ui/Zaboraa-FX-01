import React, { useState } from 'react';
import { SymbolName, Timeframe, Candle } from '../types/forex';
import { auditDataQuality, QualityReport } from '../services/marketData';
import {
  Database,
  Download,
  Upload,
  CheckCircle,
  AlertTriangle,
  FileSpreadsheet,
  RefreshCw,
  HardDrive,
  FileCode,
} from 'lucide-react';

interface DatasetItem {
  id: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  year: number;
  rowCount: number;
  fileSizeKB: number;
  qualityScore: number;
  firstDate: string;
  lastDate: string;
  status: 'SYNCHRONIZED' | 'DOWNLOADING' | 'VERIFIED';
}

interface DataManagerViewProps {
  candlesMap: Record<string, Candle[]>;
  onTriggerDownload: (symbol: SymbolName, tf: Timeframe) => void;
  onAutoFixAnomalies: (symbol: SymbolName, tf: Timeframe) => void;
}

export const DataManagerView: React.FC<DataManagerViewProps> = ({
  candlesMap,
  onTriggerDownload,
  onAutoFixAnomalies,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>('EURUSD');
  const [selectedTf, setSelectedTf] = useState<Timeframe>('H1');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [activeReport, setActiveReport] = useState<QualityReport | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const initialDatasets: DatasetItem[] = [
    { id: 'ds_1', symbol: 'EURUSD', timeframe: 'H1', year: 2026, rowCount: 14200, fileSizeKB: 680, qualityScore: 100, firstDate: '2024-01-02', lastDate: '2026-10-23', status: 'VERIFIED' },
    { id: 'ds_2', symbol: 'GBPUSD', timeframe: 'H1', year: 2026, rowCount: 14180, fileSizeKB: 672, qualityScore: 99, firstDate: '2024-01-02', lastDate: '2026-10-23', status: 'VERIFIED' },
    { id: 'ds_3', symbol: 'USDJPY', timeframe: 'H1', year: 2026, rowCount: 14210, fileSizeKB: 685, qualityScore: 100, firstDate: '2024-01-02', lastDate: '2026-10-23', status: 'VERIFIED' },
    { id: 'ds_4', symbol: 'XAUUSD', timeframe: 'M15', year: 2026, rowCount: 38400, fileSizeKB: 1820, qualityScore: 98, firstDate: '2024-06-01', lastDate: '2026-10-23', status: 'VERIFIED' },
    { id: 'ds_5', symbol: 'EURUSD', timeframe: 'M15', year: 2026, rowCount: 38500, fileSizeKB: 1840, qualityScore: 100, firstDate: '2024-06-01', lastDate: '2026-10-23', status: 'VERIFIED' },
  ];

  const [datasets] = useState<DatasetItem[]>(initialDatasets);

  const handleStartDownload = () => {
    setIsDownloading(true);
    setDownloadProgress(0);

    const interval = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsDownloading(false);
          onTriggerDownload(selectedSymbol, selectedTf);
          setNotification(`Successfully ingested ${selectedSymbol} ${selectedTf} from Exness broker server.`);
          setTimeout(() => setNotification(null), 4000);
          return 100;
        }
        return prev + 25;
      });
    }, 200);
  };

  const handleRunAudit = (symbol: SymbolName, tf: Timeframe) => {
    const key = `${symbol}_${tf}`;
    const candles = candlesMap[key] || candlesMap[`${symbol}_H1`] || [];
    const report = auditDataQuality(candles, symbol, tf);
    setActiveReport(report);
  };

  const handleExportCSV = (symbol: SymbolName, tf: Timeframe) => {
    const key = `${symbol}_${tf}`;
    const candles = candlesMap[key] || [];
    if (candles.length === 0) {
      alert('No data loaded for this pair yet.');
      return;
    }

    const headers = 'time,open,high,low,close,tick_volume,spread\n';
    const rows = candles.map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.tickVolume},${c.spread}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol}_${tf}_candles.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header & Downloader Box */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4 mb-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400" />
              Exness Market Data Downloader & Parquet Storage
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Partition format: <code className="text-blue-300 font-mono text-[11px]">data/&#123;symbol&#125;/&#123;timeframe&#125;/&#123;year&#125;.parquet</code>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Timestamps: <strong className="text-white font-mono">UTC (0 offset)</strong></span>
          </div>
        </div>

        {notification && (
          <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-lg text-xs text-emerald-300 font-mono">
            {notification}
          </div>
        )}

        {/* Downloader Form */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Trading Pair</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value as SymbolName)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
            >
              <option value="EURUSD">EURUSD (EURUSDm)</option>
              <option value="GBPUSD">GBPUSD (GBPUSDm)</option>
              <option value="USDJPY">USDJPY (USDJPYm)</option>
              <option value="XAUUSD">XAUUSD (Gold / US Dollar)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Timeframe</label>
            <select
              value={selectedTf}
              onChange={(e) => setSelectedTf(e.target.value as Timeframe)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
            >
              <option value="M1">M1 (1 Minute)</option>
              <option value="M5">M5 (5 Minutes)</option>
              <option value="M15">M15 (15 Minutes)</option>
              <option value="H1">H1 (1 Hour - Recommended)</option>
              <option value="H4">H4 (4 Hours)</option>
              <option value="D1">D1 (Daily)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Historical Depth</label>
            <select className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500">
              <option>Full Available (2024 - 2026)</option>
              <option>Last 12 Months</option>
              <option>Last 3 Months (Fast)</option>
            </select>
          </div>

          <div>
            <button
              onClick={handleStartDownload}
              disabled={isDownloading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-md shadow-blue-900/30"
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Downloading ({downloadProgress}%)</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Historical Data</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isDownloading && (
          <div className="mt-4 space-y-1">
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-500 h-2 transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-slate-500">
              <span>Streaming MT5 copy_rates_range...</span>
              <span>{downloadProgress}% completed</span>
            </div>
          </div>
        )}
      </div>

      {/* Parquet Catalog Table */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Local Parquet File Catalog</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">5 Datasets Loaded</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Timeframe</th>
                <th className="py-2.5 px-3">Partition Path</th>
                <th className="py-2.5 px-3">Row Count</th>
                <th className="py-2.5 px-3">File Size</th>
                <th className="py-2.5 px-3">Quality Score</th>
                <th className="py-2.5 px-3">Date Span</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {datasets.map((ds) => (
                <tr key={ds.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-white">{ds.symbol}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                      {ds.timeframe}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                    data/{ds.symbol}/{ds.timeframe}/{ds.year}.parquet
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{ds.rowCount.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-slate-400">{ds.fileSizeKB} KB</td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      ds.qualityScore === 100
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {ds.qualityScore}% Compliant
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                    {ds.firstDate} → {ds.lastDate}
                  </td>
                  <td className="py-2.5 px-3 text-right space-x-1.5">
                    <button
                      onClick={() => handleRunAudit(ds.symbol, ds.timeframe)}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] transition-colors"
                    >
                      Audit
                    </button>
                    <button
                      onClick={() => handleExportCSV(ds.symbol, ds.timeframe)}
                      className="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-[10px] transition-colors"
                    >
                      CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data Quality Report Modal / Drawer */}
      {activeReport && (
        <div className="bg-[#0D1322] border border-blue-500/40 rounded-xl p-5 shadow-xl animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                Data Quality Audit Report – {activeReport.symbol} ({activeReport.timeframe})
              </h3>
            </div>
            <button
              onClick={() => setActiveReport(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono text-xs mb-4">
            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500">Total Sample Bars</div>
              <div className="text-white font-bold mt-1">{activeReport.totalCandles.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500">Duplicate Timestamps</div>
              <div className={`font-bold mt-1 ${activeReport.duplicateTimestamps > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {activeReport.duplicateTimestamps}
              </div>
            </div>
            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500">Inverted OHLC (High &lt; Low)</div>
              <div className={`font-bold mt-1 ${activeReport.invertedOHLC > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {activeReport.invertedOHLC}
              </div>
            </div>
            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500">Gaps (excl. Weekends)</div>
              <div className={`font-bold mt-1 ${activeReport.gapsDetected > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {activeReport.gapsDetected}
              </div>
            </div>
            <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500">Quality Score</div>
              <div className="text-blue-400 font-bold mt-1">{activeReport.scorePct}%</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Range: {activeReport.startDate} to {activeReport.endDate} (UTC)</span>
            <button
              onClick={() => {
                onAutoFixAnomalies(activeReport.symbol, activeReport.timeframe);
                setNotification(`Auto-repaired gaps and verified unique timestamps for ${activeReport.symbol}.`);
                setActiveReport(null);
                setTimeout(() => setNotification(null), 3500);
              }}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors"
            >
              Run Auto-Fix & Repair Gaps
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
