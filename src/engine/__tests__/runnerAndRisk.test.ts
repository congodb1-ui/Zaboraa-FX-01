import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { evaluateOrderRisk, RiskEvaluationContext } from '../riskManager';
import { HeartbeatWatchdog } from '../watchdog';
import { BotRunner } from '../botRunner';
import { Bot, Candle, RiskSettings, SymbolName } from '../../types/forex';
import {
  getDb,
  saveBot,
  getAllBots,
  getBotById,
  updateBotStatusDb,
  setNoNewOrdersFlag,
  getNoNewOrdersFlag,
  getRecentRiskEvents,
} from '../../services/db';

describe('Stage 3B: Bot Runner, Risk Manager & Watchdog Tests', () => {
  const defaultRiskSettings: RiskSettings = {
    maxRiskPerTradePct: 1.5,
    maxLotSize: 1.0,
    maxOpenPositionsTotal: 4,
    maxOpenPositionsPerSymbol: 2,
    maxDailyLossPct: 3.0,
    maxTotalDrawdownPct: 8.0,
    maxAllowedSpreadPips: 2.0,
    enableTradingHoursFilter: true,
    tradingStartHourUTC: 1,
    tradingEndHourUTC: 22,
    killSwitchAction: 'CLOSE_ALL_AND_HALT',
  };

  const defaultContext: RiskEvaluationContext = {
    account: {
      balance: 10000,
      equity: 10000,
      peakEquity: 10000,
      login: '50192834',
      mode: 'DEMO',
    },
    currentSpreadPips: 1.0,
    openPositions: [],
    todayRealizedLossUSD: 0,
    evaluationTimeUtc: new Date('2026-10-23T14:00:00Z'),
  };

  beforeEach(() => {
    setNoNewOrdersFlag(false);
  });

  afterEach(() => {
    setNoNewOrdersFlag(false);
  });

  // =========================================================================
  // 1. Risk Manager: Rejection Test for EVERY Rule
  // =========================================================================

  describe('Risk Manager Firewall Rules', () => {
    it('Approves order when all risk firewall rules pass', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820, // 30 pips risk -> 30 * $10 * 0.1 = $30 risk on $10k equity = 0.3% (< 1.5%)
        tp: 1.0910,
        botId: 'bot_test_1',
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, defaultContext);
      expect(result.allowed).toBe(true);
      expect(result.reasonCode).toBe('RISK_CHECK_PASSED');
      expect(result.riskPct).toBeCloseTo(0.3, 1);
    });

    it('Rejects order when Emergency Kill Switch (no_new_orders) is active', () => {
      setNoNewOrdersFlag(true);

      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, defaultContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_KILL_SWITCH_ACTIVE');
    });

    it('Rejects order when Mandatory Stop-Loss is missing or non-positive', () => {
      const orderNoSl = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 0,
      };

      const result = evaluateOrderRisk(orderNoSl, defaultRiskSettings, defaultContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_NO_STOP_LOSS');
    });

    it('Rejects order when Stop-Loss is on the wrong side of the entry price', () => {
      // BUY with SL above entry price
      const buyWrongSl = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0870,
      };
      const buyRes = evaluateOrderRisk(buyWrongSl, defaultRiskSettings, defaultContext);
      expect(buyRes.allowed).toBe(false);
      expect(buyRes.reasonCode).toBe('RULE_INVALID_STOP_LOSS_SIDE');

      // SELL with SL below entry price
      const sellWrongSl = {
        symbol: 'EURUSD' as SymbolName,
        side: 'SELL' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0830,
      };
      const sellRes = evaluateOrderRisk(sellWrongSl, defaultRiskSettings, defaultContext);
      expect(sellRes.allowed).toBe(false);
      expect(sellRes.reasonCode).toBe('RULE_INVALID_STOP_LOSS_SIDE');
    });

    it('Rejects order when symbol is not in allowedSymbols universe', () => {
      const order = {
        symbol: 'USDJPY' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 152.00,
        sl: 151.50,
      };

      const contextRestricted = {
        ...defaultContext,
        allowedSymbols: ['EURUSD', 'GBPUSD'] as SymbolName[],
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, contextRestricted);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_SYMBOL_DISALLOWED');
    });

    it('Rejects order when volume exceeds maxLotSize', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 1.5, // maxLotSize is 1.0
        price: 1.0850,
        sl: 1.0845,
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, defaultContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_MAX_LOT_EXCEEDED');
    });

    it('Rejects order when current spread exceeds maxAllowedSpreadPips', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
      };

      const wideSpreadContext = {
        ...defaultContext,
        currentSpreadPips: 3.5, // maxAllowedSpreadPips is 2.0
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, wideSpreadContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_SPREAD_EXCEEDED');
    });

    it('Rejects order when current UTC hour is outside trading hours window', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
      };

      const nightContext = {
        ...defaultContext,
        evaluationTimeUtc: new Date('2026-10-23T23:30:00Z'), // 23:30 is outside 1:00 - 22:00 UTC
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, nightContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_TRADING_HOURS_BLOCKED');
    });

    it('Rejects order when maxOpenPositionsTotal is reached', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
      };

      const fullPositionsContext: RiskEvaluationContext = {
        ...defaultContext,
        openPositions: [
          { id: '1', ticket: 101, symbol: 'EURUSD', side: 'BUY', volume: 0.1, openPrice: 1.08, currentPrice: 1.085, sl: 1.075, pnl: 50, pips: 5, openTime: 1000, swap: 0, commission: 0 },
          { id: '2', ticket: 102, symbol: 'GBPUSD', side: 'BUY', volume: 0.1, openPrice: 1.29, currentPrice: 1.295, sl: 1.285, pnl: 50, pips: 5, openTime: 1000, swap: 0, commission: 0 },
          { id: '3', ticket: 103, symbol: 'USDJPY', side: 'BUY', volume: 0.1, openPrice: 152, currentPrice: 152.5, sl: 151, pnl: 50, pips: 5, openTime: 1000, swap: 0, commission: 0 },
          { id: '4', ticket: 104, symbol: 'XAUUSD', side: 'BUY', volume: 0.1, openPrice: 2700, currentPrice: 2710, sl: 2690, pnl: 100, pips: 10, openTime: 1000, swap: 0, commission: 0 },
        ], // 4 open positions reaches maxOpenPositionsTotal (4)
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, fullPositionsContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_MAX_POSITIONS_TOTAL_EXCEEDED');
    });

    it('Rejects order when maxOpenPositionsPerSymbol is reached', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
      };

      const symbolFullContext: RiskEvaluationContext = {
        ...defaultContext,
        openPositions: [
          { id: '1', ticket: 101, symbol: 'EURUSD', side: 'BUY', volume: 0.1, openPrice: 1.08, currentPrice: 1.085, sl: 1.075, pnl: 50, pips: 5, openTime: 1000, swap: 0, commission: 0 },
          { id: '2', ticket: 102, symbol: 'EURUSD', side: 'SELL', volume: 0.1, openPrice: 1.09, currentPrice: 1.085, sl: 1.095, pnl: 50, pips: 5, openTime: 1000, swap: 0, commission: 0 },
        ], // 2 EURUSD positions reaches maxOpenPositionsPerSymbol (2)
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, symbolFullContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_MAX_POSITIONS_SYMBOL_EXCEEDED');
    });

    it('Rejects order when calculated risk per trade exceeds maxRiskPerTradePct', () => {
      // 200 pips SL distance on 1.0 lot EURUSD = 200 * $10 * 1.0 = $2,000 risk on $10k = 20% (> 1.5%)
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 1.0,
        price: 1.0850,
        sl: 1.0650, // 200 pips
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, defaultContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_MAX_RISK_EXCEEDED');
    });

    it('Rejects order when cumulative daily loss exceeds maxDailyLossPct', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0830,
      };

      const heavyLossContext: RiskEvaluationContext = {
        ...defaultContext,
        account: { ...defaultContext.account, balance: 10000, equity: 9650 },
        todayRealizedLossUSD: 350, // $350 realized loss on $10k = 3.5% (> 3.0% maxDailyLossPct)
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, heavyLossContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_MAX_DAILY_LOSS_EXCEEDED');
    });

    it('Rejects order when account drawdown from peak equity exceeds maxTotalDrawdownPct', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0830,
      };

      const drawdownContext: RiskEvaluationContext = {
        ...defaultContext,
        account: {
          balance: 9100,
          equity: 9100,
          peakEquity: 10000, // Peak $10,000, current $9,100 -> 9% drawdown (> 8.0% limit)
          login: '50192834',
          mode: 'DEMO',
        },
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, drawdownContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_MAX_DRAWDOWN_EXCEEDED');
    });

    it('Rejects order when news blackout hook is active for the currency pair', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
      };

      const blackoutContext: RiskEvaluationContext = {
        ...defaultContext,
        newsBlackoutHook: (symbol, timestamp) => {
          return { isBlackout: true, eventTitle: 'US Non-Farm Payrolls (NFP)' };
        },
      };

      const result = evaluateOrderRisk(order, defaultRiskSettings, blackoutContext);
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('RULE_NEWS_BLACKOUT');
      expect(result.details).toContain('US Non-Farm Payrolls');
    });

    it('Every risk decision is written to risk_events table with clear reason', () => {
      const order = {
        symbol: 'EURUSD' as SymbolName,
        side: 'BUY' as const,
        volume: 0.1,
        price: 1.0850,
        sl: 1.0820,
        botId: 'audit_check_bot',
      };

      evaluateOrderRisk(order, defaultRiskSettings, defaultContext);
      const events = getRecentRiskEvents(20);
      const decisionEvent = events.find((e) => e.actor === 'RiskManager' && e.entity.includes('audit_check_bot'));
      expect(decisionEvent).toBeDefined();
      expect(decisionEvent?.action).toBe('ORDER_PERMITTED');
      expect(decisionEvent?.details).toContain('RISK_CHECK_PASSED');
    });
  });

  // =========================================================================
  // 2. Heartbeat Watchdog Tests
  // =========================================================================

  describe('Heartbeat Watchdog Auto-Pause & Confirmed Resume', () => {
    it('Auto-pauses all running bots and logs critical risk event on heartbeat timeout', () => {
      const watchdog = new HeartbeatWatchdog({ timeoutMs: 5000 });

      // Save a running bot in SQLite
      const testBot: Bot = {
        id: 'bot_watchdog_test',
        name: 'Watchdog Test Bot',
        strategyId: 'strat_sma_cross',
        strategyName: 'SMA Cross',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'DEMO_LIVE',
        status: 'RUNNING',
        params: {},
        riskLimits: {
          maxRiskPctPerTrade: 1.5,
          maxLotSize: 1.0,
          maxOpenPositions: 2,
          maxDailyLossUSD: 200,
          stopLossPips: 30,
          takeProfitPips: 60,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(testBot, 8881);

      // Verify bot is running initially
      expect(getBotById('bot_watchdog_test')?.status).toBe('RUNNING');

      // Simulate heartbeat timestamp 6 seconds ago (exceeding 5000ms timeout)
      watchdog._setLastHeartbeatForTest(Date.now() - 6000);

      // Trigger watchdog check
      const isHealthy = watchdog.checkHeartbeat();
      expect(isHealthy).toBe(false);

      // Verify status: watchdog tripped, bot was paused in SQLite
      const status = watchdog.getStatus();
      expect(status.isTripped).toBe(true);
      expect(status.bannerMessage).toContain('WATCHDOG PAUSE');
      expect(status.pausedBotIds).toContain('bot_watchdog_test');

      const botAfter = getBotById('bot_watchdog_test');
      expect(botAfter?.status).toBe('PAUSED');

      // Verify critical risk event logged
      const events = getRecentRiskEvents(5);
      const watchdogEvent = events.find((e) => e.action === 'WATCHDOG_HEARTBEAT_TIMEOUT');
      expect(watchdogEvent).toBeDefined();
      expect(watchdogEvent?.severity).toBe('CRITICAL');
      expect(watchdogEvent?.details).toContain('Broker-side stop-losses remain in place');
    });

    it('Refuses manual resume if bridge heartbeat is still expired', () => {
      const watchdog = new HeartbeatWatchdog({ timeoutMs: 5000 });
      watchdog._setLastHeartbeatForTest(Date.now() - 6000);
      watchdog.checkHeartbeat();

      // Attempt resume while bridge is still disconnected
      const resumeAttempt = watchdog.confirmManualResume();
      expect(resumeAttempt.success).toBe(false);
      expect(resumeAttempt.error).toContain('bridge heartbeat is still offline');
    });

    it('Allows confirmed manual resume only after heartbeat is restored', () => {
      const watchdog = new HeartbeatWatchdog({ timeoutMs: 5000 });

      // Save running bot
      const testBot: Bot = {
        id: 'bot_watchdog_test_2',
        name: 'Watchdog Test Bot 2',
        strategyId: 'strat_sma_cross',
        strategyName: 'SMA Cross',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'DEMO_LIVE',
        status: 'RUNNING',
        params: {},
        riskLimits: {
          maxRiskPctPerTrade: 1.5,
          maxLotSize: 1.0,
          maxOpenPositions: 2,
          maxDailyLossUSD: 200,
          stopLossPips: 30,
          takeProfitPips: 60,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(testBot, 8882);

      // Trip watchdog
      watchdog._setLastHeartbeatForTest(Date.now() - 6000);
      watchdog.checkHeartbeat();
      expect(getBotById('bot_watchdog_test_2')?.status).toBe('PAUSED');

      // Heartbeat restored from bridge
      watchdog.recordHeartbeat();

      // Confirmed manual resume
      const resume = watchdog.confirmManualResume();
      expect(resume.success).toBe(true);
      expect(resume.resumedBotIds).toContain('bot_watchdog_test_2');

      // Bot is restored to RUNNING in SQLite
      expect(getBotById('bot_watchdog_test_2')?.status).toBe('RUNNING');
      expect(watchdog.getStatus().isTripped).toBe(false);
    });
  });

  // =========================================================================
  // 3. Bot Runner: Closed-Bar Detection, Mode Routing & Isolation
  // =========================================================================

  describe('Bot Runner Closed-Bar Processing & Modes', () => {
    const mockCandles: Candle[] = [
      { time: 1700000000, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0840, tickVolume: 100, spread: 1.0 },
      { time: 1700003600, open: 1.0840, high: 1.0880, low: 1.0830, close: 1.0870, tickVolume: 120, spread: 1.0 },
      { time: 1700007200, open: 1.0870, high: 1.0890, low: 1.0850, close: 1.0860, tickVolume: 90, spread: 1.0 },
    ];

    it('Detects new closed bar and passes bar timestamp into idempotency key', async () => {
      const runner = new BotRunner({
        riskSettings: defaultRiskSettings,
        authoritativeAccountMode: 'DEMO',
        reconciliationExecuted: true,
        getAccountSnapshot: () => ({
          balance: 10000,
          equity: 10000,
          login: '50192834',
          mode: 'DEMO',
        }),
      });

      const paperBot: Bot = {
        id: 'bot_paper_idemp',
        name: 'Paper Idempotency Bot',
        strategyId: 'strat_sma_cross',
        strategyName: 'SMA Cross',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'PAPER',
        status: 'RUNNING',
        params: { fastPeriod: 2, slowPeriod: 3, stopLossPips: 20, takeProfitPips: 40 },
        riskLimits: {
          maxRiskPctPerTrade: 1.5,
          maxLotSize: 0.1,
          maxOpenPositions: 2,
          maxDailyLossUSD: 200,
          stopLossPips: 20,
          takeProfitPips: 40,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(paperBot, 9901);

      // First evaluation on bar 1700007200
      const res1 = await runner.evaluateBotOnClosedBar(paperBot, mockCandles);
      expect(res1.status).toBe('PROCESSED');
      expect(res1.newBarProcessed).toBe(true);
      expect(res1.barTime).toBe(1700007200);

      // Second evaluation on the SAME bar is skipped (no duplicate evaluation)
      const res2 = await runner.evaluateBotOnClosedBar(paperBot, mockCandles);
      expect(res2.status).toBe('SKIPPED');
      expect(res2.barTime).toBe(1700007200);
    });

    it('PAPER bot fills simulated orders locally and never calls bridge order endpoint', async () => {
      // Mock bridge client with spy
      const mockBridge = {
        sendOrder: vi.fn(),
        getHealth: vi.fn().mockResolvedValue({ status: 'ok', account_type: 'DEMO' }),
      } as any;

      const runner = new BotRunner({
        riskSettings: defaultRiskSettings,
        bridgeClient: mockBridge,
        authoritativeAccountMode: 'DEMO',
        reconciliationExecuted: true,
        getAccountSnapshot: () => ({
          balance: 10000,
          equity: 10000,
          login: '50192834',
          mode: 'DEMO',
        }),
      });

      const paperBot: Bot = {
        id: 'bot_paper_mock',
        name: 'Paper Bot',
        strategyId: 'strat_sma_cross',
        strategyName: 'SMA Cross',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'PAPER',
        status: 'RUNNING',
        params: { fastPeriod: 2, slowPeriod: 3, stopLossPips: 20, takeProfitPips: 40 },
        riskLimits: {
          maxRiskPctPerTrade: 1.5,
          maxLotSize: 0.1,
          maxOpenPositions: 2,
          maxDailyLossUSD: 200,
          stopLossPips: 20,
          takeProfitPips: 40,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(paperBot, 9902);

      const result = await runner.evaluateBotOnClosedBar(paperBot, [
        ...mockCandles,
        { time: 1700010800, open: 1.0860, high: 1.0920, low: 1.0850, close: 1.0910, tickVolume: 150, spread: 1.0 },
      ]);

      expect(result.status).toBe('PROCESSED');
      // Bridge sendOrder must NEVER have been called for PAPER mode
      expect(mockBridge.sendOrder).not.toHaveBeenCalled();
      if (result.orderResult) {
        expect(result.orderResult.status).toBe('SIMULATED');
      }
    });

    it('DEMO bot refuses order dispatch if authoritative broker account is non-demo (REAL or CONTEST)', async () => {
      const runner = new BotRunner({
        riskSettings: {
          ...defaultRiskSettings,
          maxRiskPerTradePct: 5.0,
          maxOpenPositionsPerSymbol: 10,
          maxOpenPositionsTotal: 10,
        },
        authoritativeAccountMode: 'REAL', // Broker is REAL account!
        reconciliationExecuted: true,
        getAccountSnapshot: () => ({
          balance: 10000,
          equity: 10000,
          login: '50192834',
          mode: 'REAL',
        }),
      });

      const demoBot: Bot = {
        id: 'bot_demo_refused',
        name: 'Demo Bot On Real Account',
        strategyId: 'strat_sma_cross',
        strategyName: 'SMA Cross',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'DEMO_LIVE',
        status: 'RUNNING',
        params: { fastPeriod: 2, slowPeriod: 3, stopLossPips: 20, takeProfitPips: 40 },
        riskLimits: {
          maxRiskPctPerTrade: 5.0,
          maxLotSize: 0.1,
          maxOpenPositions: 10,
          maxDailyLossUSD: 200,
          stopLossPips: 20,
          takeProfitPips: 40,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(demoBot, 9903);

      const crossoverCandles: Candle[] = [
        { time: 1700000000, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0800, tickVolume: 100, spread: 1.0 },
        { time: 1700003600, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0800, tickVolume: 100, spread: 1.0 },
        { time: 1700007200, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0800, tickVolume: 100, spread: 1.0 },
        { time: 1700010800, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0800, tickVolume: 100, spread: 1.0 },
        { time: 1700014400, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0800, tickVolume: 100, spread: 1.0 },
        { time: 1700018000, open: 1.0800, high: 1.0900, low: 1.0790, close: 1.0890, tickVolume: 150, spread: 1.0 },
      ];

      const result = await runner.evaluateBotOnClosedBar(demoBot, crossoverCandles);

      expect(result.orderResult?.status).toBe('REJECTED');
      expect(result.orderResult?.error).toContain('ACCOUNT_TYPE_MISMATCH');
    });

    it('One bot throwing an exception enters ERROR state while other bots continue running', async () => {
      const runner = new BotRunner({
        riskSettings: defaultRiskSettings,
        authoritativeAccountMode: 'DEMO',
        reconciliationExecuted: true,
        getAccountSnapshot: () => ({
          balance: 10000,
          equity: 10000,
          login: '50192834',
          mode: 'DEMO',
        }),
      });

      // Bot 1 has an invalid / crashing strategy ID
      const crashingBot: Bot = {
        id: 'bot_crasher',
        name: 'Crasher Bot',
        strategyId: 'strat_non_existent_exploding_id',
        strategyName: 'Invalid Strat',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'PAPER',
        status: 'RUNNING',
        params: {},
        riskLimits: {
          maxRiskPctPerTrade: 1.5,
          maxLotSize: 0.1,
          maxOpenPositions: 2,
          maxDailyLossUSD: 200,
          stopLossPips: 20,
          takeProfitPips: 40,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(crashingBot, 9904);

      // Bot 2 is a healthy bot
      const healthyBot: Bot = {
        id: 'bot_healthy',
        name: 'Healthy Bot',
        strategyId: 'strat_sma_cross',
        strategyName: 'SMA Cross',
        accountId: '50192834',
        symbol: 'EURUSD',
        timeframe: 'H1',
        mode: 'PAPER',
        status: 'RUNNING',
        params: { fastPeriod: 2, slowPeriod: 3, stopLossPips: 20, takeProfitPips: 40 },
        riskLimits: {
          maxRiskPctPerTrade: 1.5,
          maxLotSize: 0.1,
          maxOpenPositions: 2,
          maxDailyLossUSD: 200,
          stopLossPips: 20,
          takeProfitPips: 40,
          maxSpreadPips: 2.0,
        },
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      };
      saveBot(healthyBot, 9905);

      const candlesMap = new Map<string, Candle[]>();
      candlesMap.set('EURUSD:H1', [
        ...mockCandles,
        { time: 1700018000, open: 1.0940, high: 1.0980, low: 1.0930, close: 1.0970, tickVolume: 140, spread: 1.0 },
      ]);

      // Run execution cycle across all registered bots
      const cycleResults = await runner.runCycle(candlesMap);

      // Bot 1 enters ERROR state
      const crasherResult = cycleResults.find((r) => r.botId === 'bot_crasher');
      expect(crasherResult?.status).toBe('ERROR');
      expect(getBotById('bot_crasher')?.status).toBe('ERROR');

      // Bot 2 processed cleanly without being stopped by Bot 1's failure
      const healthyResult = cycleResults.find((r) => r.botId === 'bot_healthy');
      expect(healthyResult?.status).toBe('PROCESSED');
      expect(getBotById('bot_healthy')?.status).toBe('RUNNING');
    });

    it('Restart resumes bots ONLY after reconciliation has completed successfully', () => {
      const runner = new BotRunner({
        riskSettings: defaultRiskSettings,
        authoritativeAccountMode: 'DEMO',
        reconciliationExecuted: false,
        getAccountSnapshot: () => ({
          balance: 10000,
          equity: 10000,
          login: '50192834',
          mode: 'DEMO',
        }),
      });

      // If reconciliation has NOT completed, resume fails
      const failedResume = runner.resumeBotsAfterReconciliation(false);
      expect(failedResume.resumedCount).toBe(0);
      expect(failedResume.skippedReason).toContain('RECONCILIATION_NOT_COMPLETE');

      // When reconciliation completes successfully, resume proceeds
      const successResume = runner.resumeBotsAfterReconciliation(true);
      expect(successResume.resumedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
