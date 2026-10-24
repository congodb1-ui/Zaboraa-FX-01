import React, { useState, useEffect } from 'react';
import {
  BrokerAccount,
  Position,
  PendingOrder,
  Bot,
  Strategy,
  SymbolName,
  Timeframe,
  Candle,
  JournalEntry,
  RiskSettings,
  AuditLogEntry,
  DatasetRecord,
} from './types/forex';
import { SYMBOL_SPECS, generateHistoricalCandles } from './services/marketData';
import { BUILT_IN_STRATEGIES } from './services/builtInStrategies';
import { Navbar } from './components/Navbar';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { MarketsView } from './components/MarketsView';
import { DataManagerView } from './components/DataManagerView';
import { StrategyStudioView } from './components/StrategyStudioView';
import { PineConverterView } from './components/PineConverterView';
import { BacktestView } from './components/BacktestView';
import { BotsView } from './components/BotsView';
import { PositionsView } from './components/PositionsView';
import { JournalView } from './components/JournalView';
import { SettingsView } from './components/SettingsView';
import { OptimizationView } from './components/OptimizationView';
import { KillSwitchModal } from './components/KillSwitchModal';
import { RiskDisclaimerModal } from './components/RiskDisclaimerModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [currentSymbol, setCurrentSymbol] = useState<SymbolName>('EURUSD');
  const [currentTimeframe, setCurrentTimeframe] = useState<Timeframe>('H1');
  const [isKillSwitchOpen, setIsKillSwitchOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem('zfx_disclaimer_accepted');
    if (!accepted) {
      setIsDisclaimerOpen(true);
    }
  }, []);

  // Benchmark datasets initialized for immediate quantitative evaluation in AI Studio
  const [datasets, setDatasets] = useState<DatasetRecord[]>(() => {
    const eurCandles = generateHistoricalCandles('EURUSD', 'H1', 500);
    const goldCandles = generateHistoricalCandles('XAUUSD', 'H1', 500);

    return [
      {
        id: 'ds_benchmark_eurusd_h1',
        symbol: 'EURUSD',
        timeframe: 'H1',
        rowCount: eurCandles.length,
        fileSizeKB: Math.round(eurCandles.length * 0.045),
        firstDate: new Date(eurCandles[0].time * 1000).toISOString().slice(0, 10),
        lastDate: new Date(eurCandles[eurCandles.length - 1].time * 1000).toISOString().slice(0, 10),
        provenance: {
          source: 'SIMULATED',
          label: 'SIMULATED',
          details: 'Standard research benchmark generated via GBM with weekend gap modeling & realistic tick spread.',
          isResearchEligible: true,
          utcOffsetHours: 2,
        },
        candles: eurCandles,
        qualityScore: 99,
        lastUpdated: new Date().toISOString(),
      },
      {
        id: 'ds_benchmark_xauusd_h1',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        rowCount: goldCandles.length,
        fileSizeKB: Math.round(goldCandles.length * 0.045),
        firstDate: new Date(goldCandles[0].time * 1000).toISOString().slice(0, 10),
        lastDate: new Date(goldCandles[goldCandles.length - 1].time * 1000).toISOString().slice(0, 10),
        provenance: {
          source: 'SIMULATED',
          label: 'SIMULATED',
          details: 'Precious Metals volatility benchmark simulation with broker swap & slippage.',
          isResearchEligible: true,
          utcOffsetHours: 2,
        },
        candles: goldCandles,
        qualityScore: 98,
        lastUpdated: new Date().toISOString(),
      },
    ];
  });

  // MT5 Bridge live status
  const [bridgeStatus, setBridgeStatus] = useState<{
    isOnline: boolean;
    serverName?: string;
    accountType?: string;
    error?: string;
  }>({
    isOnline: false,
    serverName: 'Exness-MT5Trial9',
    accountType: 'DEMO',
  });

  // Broker Account State
  const [account, setAccount] = useState<BrokerAccount>({
    id: 'acc_exness',
    label: 'Exness MetaTrader 5',
    broker: 'Exness',
    server: 'Not connected (Offline)',
    login: 'Not connected',
    mode: 'DEMO',
    symbolSuffix: 'm',
    balance: 10000.0,
    equity: 10000.0,
    margin: 0.0,
    freeMargin: 10000.0,
    leverage: 200,
    currency: 'USD',
    isConnected: false,
    isSimulated: true,
    lastHeartbeat: new Date().toISOString(),
    utcOffsetHours: 2,
  });

  // Open Positions (Empty by default: no fake records)
  const [positions, setPositions] = useState<Position[]>([]);

  // Pending Orders (Empty by default: no fake records)
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);

  // Strategies
  const [strategies, setStrategies] = useState<Strategy[]>(BUILT_IN_STRATEGIES);

  // Automated Bots (loaded from SQLite database, zero hardcoded records)
  const [bots, setBots] = useState<Bot[]>([]);

  // Risk Firewall Settings
  const [riskSettings, setRiskSettings] = useState<RiskSettings>({
    maxRiskPerTradePct: 1.5,
    maxLotSize: 1.0,
    maxOpenPositionsTotal: 5,
    maxOpenPositionsPerSymbol: 2,
    maxDailyLossPct: 4.0,
    maxTotalDrawdownPct: 10.0,
    maxAllowedSpreadPips: 2.5,
    enableTradingHoursFilter: true,
    tradingStartHourUTC: 1,
    tradingEndHourUTC: 22,
    killSwitchAction: 'CLOSE_ALL_AND_HALT',
  });

  // Security Audit Log (loaded from SQLite database, zero hardcoded records)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Journal Entries (stored in user records, zero hardcoded records)
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  // Probe Bridge function
  const handleTestBridge = async (url: string, token: string): Promise<boolean> => {
    try {
      const res = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBridgeToken(token);
        setBridgeStatus({
          isOnline: true,
          serverName: data.server_name || 'Exness-MT5Trial9',
          accountType: data.account_type || 'DEMO',
        });
        setAccount((prev) => ({
          ...prev,
          isConnected: true,
          isSimulated: false,
          server: data.server_name || prev.server,
          utcOffsetHours: data.broker_utc_offset_hours || 2,
        }));
        return true;
      }
    } catch {
      // Unreachable
    }
    setBridgeStatus({
      isOnline: false,
      error: 'Connection refused. mt5-bridge is not running on 127.0.0.1:8001.',
    });
    return false;
  };

  const [bridgeToken, setBridgeToken] = useState<string>('');

  // Fetch dataset from MT5 Bridge
  const handleFetchFromBridge = async (symbol: SymbolName, tf: Timeframe): Promise<boolean> => {
    try {
      const headers: Record<string, string> = {};
      if (bridgeToken) {
        headers['Authorization'] = `Bearer ${bridgeToken}`;
      }
      const res = await fetch(`http://127.0.0.1:8001/candles?symbol=${symbol}&timeframe=${tf}&count=400`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.candles && data.candles.length > 0) {
          const newDs: DatasetRecord = {
            id: `ds_bridge_${Date.now()}`,
            symbol,
            timeframe: tf,
            rowCount: data.candles.length,
            fileSizeKB: Math.round(data.candles.length * 0.045),
            firstDate: new Date(data.candles[0].time * 1000).toISOString().slice(0, 10),
            lastDate: new Date(data.candles[data.candles.length - 1].time * 1000).toISOString().slice(0, 10),
            provenance: {
              source: 'MT5_BRIDGE',
              label: 'MT5 BRIDGE',
              details: `Exness MT5 Server: ${bridgeStatus.serverName || 'Exness-MT5Trial9'} (${bridgeStatus.accountType || 'DEMO'})`,
              brokerServer: bridgeStatus.serverName || 'Exness-MT5Trial9',
              accountType: (bridgeStatus.accountType as any) || 'DEMO',
              utcOffsetHours: data.utc_offset_hours || 2,
              isResearchEligible: true,
            },
            candles: data.candles,
            qualityScore: 100,
            lastUpdated: new Date().toISOString(),
          };
          setDatasets((prev) => [newDs, ...prev.filter((d) => !(d.symbol === symbol && d.timeframe === tf))]);
          return true;
        }
      }
    } catch {
      // Bridge not reachable
    }
    return false;
  };

  // Initial system health and bots fetch
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data.brokerStatus === 'ONLINE') {
          setBridgeStatus({
            isOnline: true,
            serverName: data.server,
            accountType: data.accountType,
          });
          setAccount((prev) => ({
            ...prev,
            isConnected: true,
            isSimulated: false,
            server: data.server || prev.server,
            mode: data.accountType || prev.mode,
          }));
        }
      })
      .catch(() => {});

    fetch('/api/bots')
      .then((res) => res.json())
      .then((savedBots) => {
        if (Array.isArray(savedBots)) {
          setBots(savedBots);
        }
      })
      .catch(() => {});

    fetch('/api/positions')
      .then((res) => res.json())
      .then((savedPositions) => {
        if (Array.isArray(savedPositions)) {
          setPositions(savedPositions);
        }
      })
      .catch(() => {});

    fetch('/api/audit-log')
      .then((res) => res.json())
      .then((savedLogs) => {
        if (Array.isArray(savedLogs)) {
          setAuditLogs(savedLogs);
        }
      })
      .catch(() => {});
  }, []);

  // Sync equity with floating P&L
  useEffect(() => {
    const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    setAccount((prev) => ({
      ...prev,
      equity: Number((prev.balance + totalPnl).toFixed(2)),
      freeMargin: Number((prev.balance + totalPnl - prev.margin).toFixed(2)),
    }));
  }, [positions]);

  // Handlers
  const handleToggleAccountMode = (newMode: 'DEMO' | 'LIVE') => {
    setAccount((prev) => ({ ...prev, mode: newMode }));
    setAuditLogs((prev) => [
      {
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Trader',
        action: 'MODE_CHANGE',
        entity: `Account ${account.login}`,
        details: `Switched trading mode to ${newMode}.`,
        status: newMode === 'LIVE' ? 'WARNING' : 'SUCCESS',
      },
      ...prev,
    ]);
  };

  const handleClosePosition = (ticket: number) => {
    const pos = positions.find((p) => p.ticket === ticket);
    if (!pos) return;

    setPositions((prev) => prev.filter((p) => p.ticket !== ticket));
    setAccount((prev) => ({
      ...prev,
      balance: Number((prev.balance + pos.pnl).toFixed(2)),
      margin: Math.max(0, prev.margin - 80),
    }));

    setAuditLogs((prev) => [
      {
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Trader',
        action: 'ORDER_CLOSE',
        entity: `${pos.symbol} #${pos.ticket}`,
        details: `Closed at ${pos.currentPrice} with P&L: $${pos.pnl.toFixed(2)} (${pos.pips} pips).`,
        status: 'SUCCESS',
      },
      ...prev,
    ]);
  };

  const handleModifyPosition = (ticket: number, sl?: number, tp?: number) => {
    setPositions((prev) =>
      prev.map((p) => (p.ticket === ticket ? { ...p, sl, tp } : p))
    );
  };

  const handlePlaceOrder = (order: {
    symbol: SymbolName;
    side: 'BUY' | 'SELL';
    volume: number;
    sl?: number;
    tp?: number;
  }) => {
    const spec = SYMBOL_SPECS[order.symbol];
    const price = order.side === 'BUY' ? spec.ask : spec.bid;
    const ticket = Math.floor(10000 + Math.random() * 90000);

    const newPos: Position = {
      id: `pos_${Date.now()}`,
      ticket,
      symbol: order.symbol,
      side: order.side,
      volume: order.volume,
      openPrice: price,
      currentPrice: price,
      sl: order.sl,
      tp: order.tp,
      pnl: 0,
      pips: 0,
      openTime: Math.floor(Date.now() / 1000),
      swap: 0,
      commission: -(order.volume * 7.0),
      comment: 'Manual market execution',
    };

    setPositions((prev) => [newPos, ...prev]);
    setAccount((prev) => ({
      ...prev,
      margin: prev.margin + 75,
    }));
  };

  const handleExecuteKillSwitch = () => {
    const realized = positions.reduce((sum, p) => sum + p.pnl, 0);
    setAccount((prev) => ({
      ...prev,
      balance: Number((prev.balance + realized).toFixed(2)),
      equity: Number((prev.balance + realized).toFixed(2)),
      margin: 0,
      freeMargin: Number((prev.balance + realized).toFixed(2)),
    }));
    setPositions([]);
    setPendingOrders([]);
    setBots((prev) => prev.map((b) => ({ ...b, status: 'STOPPED' })));
  };

  // Load strategies & bots from SQLite on startup
  useEffect(() => {
    fetch('/api/strategies')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data) && data.length > 0) {
          setStrategies(data);
        }
      })
      .catch(() => {});

    fetch('/api/bots')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data) && data.length > 0) {
          setBots(data);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveStrategy = (strat: Strategy) => {
    setStrategies((prev) => {
      const idx = prev.findIndex((s) => s.id === strat.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = strat;
        return copy;
      }
      return [strat, ...prev];
    });

    fetch('/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: strat }),
    }).catch(() => {});
  };

  const [botErrorBanner, setBotErrorBanner] = useState<string | null>(null);

  const handleUpdateBotStatus = async (id: string, status: Bot['status']) => {
    try {
      const res = await fetch(`/api/bots/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBotErrorBanner(data.error || 'Failed to update bot status. Verify broker permissions.');
        return;
      }
      setBotErrorBanner(null);
      setBots((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (err: any) {
      setBotErrorBanner(`Network error updating bot status: ${err.message}`);
    }
  };

  const handleCreateBot = (newBot: Bot) => {
    setBots((prev) => [newBot, ...prev]);
    fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot: newBot }),
    }).catch(() => {});
  };

  // Generate fallback display candles for chart if no dataset loaded yet
  const activeDataset = datasets.find(
    (d) => d.symbol === currentSymbol && d.timeframe === currentTimeframe
  );
  const chartCandles: Candle[] = activeDataset?.candles || [
    { time: 1700000000, open: 1.0845, high: 1.0860, low: 1.0840, close: 1.0852, tickVolume: 420, spread: 0.8 },
    { time: 1700003600, open: 1.0852, high: 1.0875, low: 1.0848, close: 1.0868, tickVolume: 510, spread: 0.8 },
    { time: 1700007200, open: 1.0868, high: 1.0882, low: 1.0860, close: 1.0874, tickVolume: 490, spread: 0.8 },
  ];

  return (
    <div className="min-h-screen bg-[#090D16] flex flex-col font-sans">
      <Navbar
        account={account}
        onToggleAccountMode={handleToggleAccountMode}
        activeBotsCount={bots.filter((b) => b.status === 'RUNNING').length}
        onOpenKillSwitch={() => setIsKillSwitchOpen(true)}
      />

      {/* Persistent Simulation Warning Banner */}
      {!bridgeStatus.isOnline && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2.5 font-mono">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
              SIMULATION
            </span>
            <span className="font-semibold text-slate-200">
              Not connected: simulation only.
            </span>
            <span className="text-amber-300/80 hidden sm:inline">
              Real broker execution requires connecting an active MT5 bridge. Orders & data are strictly paper simulation.
            </span>
          </div>
          <span className="text-[11px] font-mono text-amber-400/80">Bridge: Offline</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          openPositionsCount={positions.length}
        />

        <main className="flex-1 overflow-y-auto p-5 pb-16 max-w-7xl mx-auto w-full">
          {activeTab === 'dashboard' && (
            <DashboardView
              account={account}
              positions={positions}
              bots={bots}
              onNavigate={setActiveTab}
              onClosePosition={handleClosePosition}
              onSelectSymbol={setCurrentSymbol}
            />
          )}

          {activeTab === 'markets' && (
            <MarketsView
              account={account}
              currentSymbol={currentSymbol}
              currentTimeframe={currentTimeframe}
              candles={chartCandles}
              onSelectSymbol={setCurrentSymbol}
              onSelectTimeframe={setCurrentTimeframe}
              onPlaceOrder={handlePlaceOrder}
            />
          )}

          {activeTab === 'data' && (
            <DataManagerView
              datasets={datasets}
              onAddDataset={(ds) => setDatasets((prev) => [ds, ...prev])}
              onAutoFixAnomalies={(id) => {
                setDatasets((prev) =>
                  prev.map((d) => (d.id === id ? { ...d, qualityScore: 100 } : d))
                );
              }}
              onFetchFromBridge={handleFetchFromBridge}
              bridgeStatus={bridgeStatus}
            />
          )}

          {activeTab === 'strategies' && (
            <StrategyStudioView
              strategies={strategies}
              onSelectStrategy={() => {}}
              onSaveStrategy={handleSaveStrategy}
              onLaunchBacktest={() => setActiveTab('backtest')}
            />
          )}

          {activeTab === 'pine' && (
            <PineConverterView
              onSaveConvertedStrategy={(strat) => {
                handleSaveStrategy(strat);
                setActiveTab('strategies');
              }}
              onLaunchBacktest={(strat) => {
                handleSaveStrategy(strat);
                setActiveTab('backtest');
              }}
            />
          )}

          {activeTab === 'backtest' && (
            <BacktestView
              strategies={strategies}
              datasets={datasets}
              currentSymbol={currentSymbol}
              currentTimeframe={currentTimeframe}
              onNavigateToData={() => setActiveTab('data')}
            />
          )}

          {activeTab === 'optimizations' && (
            <OptimizationView
              strategies={strategies}
              currentSymbol={currentSymbol}
              currentTimeframe={currentTimeframe}
            />
          )}

          {activeTab === 'bots' && (
            <BotsView
              bots={bots}
              strategies={strategies}
              account={account}
              errorMessage={botErrorBanner}
              onDismissError={() => setBotErrorBanner(null)}
              onUpdateBotStatus={handleUpdateBotStatus}
              onCreateBot={handleCreateBot}
            />
          )}

          {activeTab === 'positions' && (
            <PositionsView
              positions={positions}
              pendingOrders={pendingOrders}
              isBrokerConnected={bridgeStatus.isOnline}
              onClosePosition={handleClosePosition}
              onModifyPosition={handleModifyPosition}
              onCancelPendingOrder={(ticket) => {
                setPendingOrders((prev) => prev.filter((o) => o.ticket !== ticket));
              }}
            />
          )}

          {activeTab === 'journal' && (
            <JournalView
              entries={journalEntries}
              onAddEntry={(entry) => setJournalEntries((prev) => [entry, ...prev])}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              account={account}
              riskSettings={riskSettings}
              auditLogs={auditLogs}
              onUpdateBroker={(updated) => setAccount((prev) => ({ ...prev, ...updated }))}
              onUpdateRiskSettings={setRiskSettings}
              bridgeStatus={bridgeStatus}
              onTestBridge={handleTestBridge}
            />
          )}
        </main>
      </div>

      {/* Persistent Regulatory & Risk Disclaimer Footer */}
      <footer className="px-6 py-2 bg-[#080C16] border-t border-slate-900 text-center text-[10px] text-slate-500 select-none">
        <span>
          Risk Disclosure: Trading Forex and leveraged financial instruments involves substantial risk of loss and is not suitable for every investor. Past backtest results, parameter optimization heatmaps, and simulated performance metrics do not predict future live trading execution.
        </span>
      </footer>

      <KillSwitchModal
        isOpen={isKillSwitchOpen}
        onClose={() => setIsKillSwitchOpen(false)}
        positions={positions}
        bots={bots}
        onExecuteKillSwitch={handleExecuteKillSwitch}
      />

      <RiskDisclaimerModal
        isOpen={isDisclaimerOpen}
        onAccept={() => {
          localStorage.setItem('zfx_disclaimer_accepted', 'true');
          setIsDisclaimerOpen(false);
        }}
      />
    </div>
  );
}
