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
import { SYMBOL_SPECS } from './services/marketData';
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
import { KillSwitchModal } from './components/KillSwitchModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [currentSymbol, setCurrentSymbol] = useState<SymbolName>('EURUSD');
  const [currentTimeframe, setCurrentTimeframe] = useState<Timeframe>('H1');
  const [isKillSwitchOpen, setIsKillSwitchOpen] = useState(false);

  // Datasets initialized EMPTY by default to enforce research honesty
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

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

  // Demo Account State
  const [account, setAccount] = useState<BrokerAccount>({
    id: 'acc_exness_demo',
    label: 'Exness MetaTrader 5 Demo',
    broker: 'Exness',
    server: 'Exness-MT5Trial9',
    login: '50192834',
    mode: 'DEMO',
    symbolSuffix: 'm',
    balance: 10000.0,
    equity: 10185.5,
    margin: 245.0,
    freeMargin: 9940.5,
    leverage: 200,
    currency: 'USD',
    isConnected: true,
    isSimulated: true,
    lastHeartbeat: new Date().toISOString(),
    utcOffsetHours: 2,
  });

  // Open Positions
  const [positions, setPositions] = useState<Position[]>([
    {
      id: 'pos_1',
      ticket: 10482,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.2,
      openPrice: 1.08340,
      currentPrice: 1.08452,
      sl: 1.08050,
      tp: 1.08900,
      pnl: 22.40,
      pips: 11.2,
      openTime: Math.floor(Date.now() / 1000) - 7200,
      swap: -0.64,
      commission: -1.40,
      comment: 'Dual SMA Crossover Signal',
    },
    {
      id: 'pos_2',
      ticket: 10483,
      symbol: 'XAUUSD',
      side: 'BUY',
      volume: 0.1,
      openPrice: 2718.50,
      currentPrice: 2734.25,
      sl: 2695.00,
      tp: 2760.00,
      pnl: 157.50,
      pips: 157.5,
      openTime: Math.floor(Date.now() / 1000) - 18000,
      swap: -1.45,
      commission: -0.70,
      comment: 'Gold ATR Breakout',
    },
  ]);

  // Pending Orders
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([
    {
      id: 'ord_1',
      ticket: 20101,
      symbol: 'GBPUSD',
      type: 'BUY_LIMIT',
      volume: 0.2,
      price: 1.29500,
      sl: 1.29150,
      tp: 1.30200,
      placedTime: Math.floor(Date.now() / 1000) - 1200,
      comment: 'Pullback limit order',
    },
  ]);

  // Strategies
  const [strategies, setStrategies] = useState<Strategy[]>(BUILT_IN_STRATEGIES);

  // Active Automated Bots
  const [bots, setBots] = useState<Bot[]>([
    {
      id: 'bot_eur_sma',
      name: 'EURUSD Trend Follower',
      strategyId: 'strat_sma_cross',
      strategyName: 'Dual SMA Dynamic Crossover',
      accountId: '50192834',
      symbol: 'EURUSD',
      timeframe: 'H1',
      mode: 'DEMO_LIVE',
      status: 'RUNNING',
      params: { fastPeriod: 20, slowPeriod: 50, stopLossPips: 35, takeProfitPips: 70 },
      riskLimits: {
        maxRiskPctPerTrade: 1.5,
        maxLotSize: 0.5,
        maxOpenPositions: 2,
        maxDailyLossUSD: 200,
        stopLossPips: 35,
        takeProfitPips: 70,
        maxSpreadPips: 2.0,
      },
      todayPnl: 45.20,
      totalPnl: 640.80,
      tradesCount: 14,
      lastSignal: { action: 'BUY', time: '14:00 UTC', price: 1.0834, reason: 'Fast SMA crossed Slow SMA upward' },
      lastHeartbeat: new Date().toISOString(),
      logs: [
        { time: '14:00:02', level: 'INFO', message: 'H1 bar closed. Signal: BUY EURUSD 0.20 lots' },
        { time: '14:00:03', level: 'INFO', message: 'Order #10482 filled at 1.08340. SL: 1.08050, TP: 1.08900' },
      ],
    },
  ]);

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

  // Security Audit Log
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([
    { id: 'aud_1', timestamp: new Date(Date.now() - 3600000).toISOString(), actor: 'Bot Engine', action: 'ORDER_OPEN', entity: 'EURUSD #10482', details: 'BUY 0.2 lots at 1.08340. Risk check passed.', status: 'SUCCESS' },
    { id: 'aud_2', timestamp: new Date(Date.now() - 7200000).toISOString(), actor: 'Trader', action: 'LOGIN_EXNESS', entity: 'Exness-MT5Trial9', details: 'Authorized session for MT5 demo account 50192834.', status: 'SUCCESS' },
  ]);

  // Journal Entries
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([
    {
      id: 'j_1',
      tradeTicket: 10482,
      symbol: 'EURUSD',
      pnl: 22.40,
      tags: ['Trend Following', 'London Session', 'Disciplined'],
      notes: 'Entry conformed to dual SMA crossover. Respected 1.5% max risk limit and set trailing stop.',
      rating: 5,
      createdAt: '2026-10-23T14:15:00.000Z',
    },
  ]);

  // Probe Bridge function
  const handleTestBridge = async (url: string, token: string): Promise<boolean> => {
    try {
      const res = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
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

  // Fetch dataset from MT5 Bridge
  const handleFetchFromBridge = async (symbol: SymbolName, tf: Timeframe): Promise<boolean> => {
    try {
      const res = await fetch(`http://127.0.0.1:8001/candles?symbol=${symbol}&timeframe=${tf}&count=400`, {
        headers: { Authorization: `Bearer zaboraa_local_bridge_token_9872` },
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

  // Live price ticker simulator for active open positions
  useEffect(() => {
    const timer = setInterval(() => {
      setPositions((prevPositions) =>
        prevPositions.map((pos) => {
          const spec = SYMBOL_SPECS[pos.symbol];
          const delta = (Math.random() - 0.495) * (spec.point * 2);
          const newPrice = Number((pos.currentPrice + delta).toFixed(spec.digits));
          const pips = pos.side === 'BUY'
            ? (newPrice - pos.openPrice) / (spec.point * (spec.digits === 3 || spec.digits === 5 ? 10 : 1))
            : (pos.openPrice - newPrice) / (spec.point * (spec.digits === 3 || spec.digits === 5 ? 10 : 1));

          const grossPnl = pips * spec.pipValuePerLotUSD * pos.volume;
          const netPnl = grossPnl + pos.swap + pos.commission;

          return {
            ...pos,
            currentPrice: newPrice,
            pips: Number(pips.toFixed(1)),
            pnl: Number(netPnl.toFixed(2)),
          };
        })
      );
    }, 2500);

    return () => clearInterval(timer);
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

          {activeTab === 'bots' && (
            <BotsView
              bots={bots}
              strategies={strategies}
              account={account}
              onUpdateBotStatus={(id, st) =>
                setBots((prev) => prev.map((b) => (b.id === id ? { ...b, status: st } : b)))
              }
              onCreateBot={(bot) => setBots((prev) => [bot, ...prev])}
            />
          )}

          {activeTab === 'positions' && (
            <PositionsView
              positions={positions}
              pendingOrders={pendingOrders}
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

      <KillSwitchModal
        isOpen={isKillSwitchOpen}
        onClose={() => setIsKillSwitchOpen(false)}
        positions={positions}
        bots={bots}
        onExecuteKillSwitch={handleExecuteKillSwitch}
      />
    </div>
  );
}
