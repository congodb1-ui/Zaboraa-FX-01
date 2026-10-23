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
} from './types/forex';
import { generateHistoricalCandles, SYMBOL_SPECS } from './services/marketData';
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

  // Pre-generate rich candle history for the 4 core pairs
  const [candlesMap, setCandlesMap] = useState<Record<string, Candle[]>>(() => {
    return {
      EURUSD_H1: generateHistoricalCandles('EURUSD', 'H1', 400),
      EURUSD_M15: generateHistoricalCandles('EURUSD', 'M15', 300),
      GBPUSD_H1: generateHistoricalCandles('GBPUSD', 'H1', 400),
      GBPUSD_M15: generateHistoricalCandles('GBPUSD', 'M15', 300),
      USDJPY_H1: generateHistoricalCandles('USDJPY', 'H1', 400),
      USDJPY_M15: generateHistoricalCandles('USDJPY', 'M15', 300),
      XAUUSD_H1: generateHistoricalCandles('XAUUSD', 'H1', 400),
      XAUUSD_M15: generateHistoricalCandles('XAUUSD', 'M15', 300),
    };
  });

  // Account State
  const [account, setAccount] = useState<BrokerAccount>({
    id: 'acc_exness_1',
    label: 'Exness MetaTrader 5 Primary',
    broker: 'Exness',
    server: 'Exness-Real21',
    login: '88419204',
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
    {
      id: 'pos_3',
      ticket: 10484,
      symbol: 'USDJPY',
      side: 'SELL',
      volume: 0.15,
      openPrice: 152.420,
      currentPrice: 152.348,
      sl: 152.800,
      tp: 151.800,
      pnl: 7.08,
      pips: 7.2,
      openTime: Math.floor(Date.now() / 1000) - 3600,
      swap: 0.67,
      commission: -1.05,
      comment: 'RSI Reversion Signal',
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
      comment: 'Support pullback limit',
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
      accountId: '88419204',
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
    {
      id: 'bot_gold_breakout',
      name: 'Gold Turtle Momentum',
      strategyId: 'strat_donchian_breakout',
      strategyName: 'Donchian Channel Turtle Breakout',
      accountId: '88419204',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      mode: 'DEMO_LIVE',
      status: 'RUNNING',
      params: { entryPeriod: 20, exitPeriod: 10 },
      riskLimits: {
        maxRiskPctPerTrade: 1.5,
        maxLotSize: 0.2,
        maxOpenPositions: 1,
        maxDailyLossUSD: 300,
        stopLossPips: 50,
        takeProfitPips: 100,
        maxSpreadPips: 35.0,
      },
      todayPnl: 157.50,
      totalPnl: 1280.00,
      tradesCount: 22,
      lastSignal: { action: 'BUY', time: '10:15 UTC', price: 2718.50, reason: 'Breakout above 20-bar Donchian high' },
      lastHeartbeat: new Date().toISOString(),
      logs: [
        { time: '10:15:01', level: 'INFO', message: 'Donchian upper band break detected on XAUUSD' },
        { time: '10:15:02', level: 'INFO', message: 'Order #10483 filled at 2718.50 with broker-side SL/TP' },
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
    { id: 'aud_2', timestamp: new Date(Date.now() - 7200000).toISOString(), actor: 'Trader', action: 'LOGIN_EXNESS', entity: 'Exness-Real21', details: 'Authorized session for MT5 account 88419204.', status: 'SUCCESS' },
    { id: 'aud_3', timestamp: new Date(Date.now() - 10800000).toISOString(), actor: 'Risk Firewall', action: 'SPREAD_FILTER', entity: 'GBPUSD', details: 'Signal blocked due to spread widening during news event.', status: 'WARNING' },
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
    {
      id: 'j_2',
      tradeTicket: 10483,
      symbol: 'XAUUSD',
      pnl: 157.50,
      tags: ['Gold Breakout', 'US Open Volatility'],
      notes: 'Strong expansion out of Donchian channel. High conviction hold into NY session.',
      rating: 5,
      createdAt: '2026-10-23T11:00:00.000Z',
    },
  ]);

  // Live Price Tick Simulator to keep terminal feeling active and realistic
  useEffect(() => {
    const timer = setInterval(() => {
      // Micro-tick price update
      setPositions((prevPositions) =>
        prevPositions.map((pos) => {
          const spec = SYMBOL_SPECS[pos.symbol];
          const delta = (Math.random() - 0.495) * (spec.point * 3);
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
    setAuditLogs((prev) => [
      {
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Trader',
        action: 'ORDER_MODIFY',
        entity: `Position #${ticket}`,
        details: `Updated SL: ${sl || 'None'}, TP: ${tp || 'None'}.`,
        status: 'SUCCESS',
      },
      ...prev,
    ]);
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

    setAuditLogs((prev) => [
      {
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Trader',
        action: 'ORDER_OPEN',
        entity: `${order.symbol} #${ticket}`,
        details: `Executed ${order.side} ${order.volume} lots at ${price}. Attached SL: ${order.sl}, TP: ${order.tp}.`,
        status: 'SUCCESS',
      },
      ...prev,
    ]);
  };

  const handleExecuteKillSwitch = () => {
    // 1. Close all positions
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

    // 2. Halt all bots
    setBots((prev) => prev.map((b) => ({ ...b, status: 'STOPPED' })));

    // 3. Log audit
    setAuditLogs((prev) => [
      {
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'KILL_SWITCH',
        action: 'EMERGENCY_HALT',
        entity: 'All Accounts & Bots',
        details: `Global kill switch liquidated ${positions.length} position(s). Total P&L impact: $${realized.toFixed(2)}.`,
        status: 'CRITICAL',
      },
      ...prev,
    ]);
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

  const handleCreateBot = (newBot: Bot) => {
    setBots((prev) => [newBot, ...prev]);
    setAuditLogs((prev) => [
      {
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Trader',
        action: 'BOT_DEPLOY',
        entity: newBot.name,
        details: `Deployed on ${newBot.symbol} ${newBot.timeframe} in ${newBot.mode} mode.`,
        status: 'SUCCESS',
      },
      ...prev,
    ]);
  };

  const handleUpdateBotStatus = (botId: string, newStatus: 'RUNNING' | 'PAUSED' | 'STOPPED') => {
    setBots((prev) =>
      prev.map((b) => (b.id === botId ? { ...b, status: newStatus } : b))
    );
  };

  const activeCandlesKey = `${currentSymbol}_${currentTimeframe}`;
  const currentCandles = candlesMap[activeCandlesKey] || candlesMap[`${currentSymbol}_H1`] || [];

  return (
    <div className="min-h-screen bg-[#090D16] flex flex-col font-sans">
      {/* Persistent Navigation Top Bar */}
      <Navbar
        account={account}
        onToggleAccountMode={handleToggleAccountMode}
        activeBotsCount={bots.filter((b) => b.status === 'RUNNING').length}
        onOpenKillSwitch={() => setIsKillSwitchOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar (240px) */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          openPositionsCount={positions.length}
        />

        {/* Main Content Viewport */}
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
              candles={currentCandles}
              onSelectSymbol={setCurrentSymbol}
              onSelectTimeframe={setCurrentTimeframe}
              onPlaceOrder={handlePlaceOrder}
            />
          )}

          {activeTab === 'data' && (
            <DataManagerView
              candlesMap={candlesMap}
              onTriggerDownload={(sym, tf) => {
                const newCandles = generateHistoricalCandles(sym, tf, 500);
                setCandlesMap((prev) => ({ ...prev, [`${sym}_${tf}`]: newCandles }));
              }}
              onAutoFixAnomalies={(sym, tf) => {
                // Ensure unique monotonic timestamps
                const key = `${sym}_${tf}`;
                const raw = candlesMap[key] || [];
                const deduped = raw.filter((c, i, a) => i === 0 || c.time > a[i - 1].time);
                setCandlesMap((prev) => ({ ...prev, [key]: deduped }));
              }}
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
              candlesMap={candlesMap}
              currentSymbol={currentSymbol}
              currentTimeframe={currentTimeframe}
            />
          )}

          {activeTab === 'bots' && (
            <BotsView
              bots={bots}
              strategies={strategies}
              account={account}
              onUpdateBotStatus={handleUpdateBotStatus}
              onCreateBot={handleCreateBot}
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
            />
          )}
        </main>
      </div>

      {/* Emergency Kill Switch Modal */}
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
