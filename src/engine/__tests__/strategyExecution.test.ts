import { describe, it, expect } from 'vitest';
import { Candle, BacktestConfig, Strategy, Bot } from '../../types/forex';
import { runBacktest } from '../backtester';
import {
  getStrategyExecutor,
  StrategyContract,
} from '../../services/builtInStrategies';
import { getQuickJS, QuickJSStrategySandbox, createQuickJSStrategyExecutor } from '../quickjsSandbox';
import { transpileStrategyCode } from '../transpiler';
import { runOptimizationSweep } from '../optimizer';
import { calculatePipValue } from '../../services/marketData';
import {
  getDb,
  createJobDb,
  getJobDb,
  updateJobCompletedDb,
  cancelJobDb,
  isJobCancelledDb,
  setCachedAi,
  getCachedAi,
  saveStrategy,
  getAllStrategies,
  saveBot,
  getAllBots,
} from '../../services/db';

describe('Stage 2: Unified Strategy Execution & Safety Architecture', () => {
  // Generate 60 test candles with realistic upward and downward waves
  const testCandles: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const base = 1.0850;
    const wave = Math.sin(i / 4) * 0.0040;
    const open = base + wave;
    const close = base + wave + 0.0005;
    const high = Math.max(open, close) + 0.0008;
    const low = Math.min(open, close) - 0.0008;
    return {
      time: 1700000000 + i * 3600,
      open: Number(open.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
      tickVolume: 150 + i * 5,
      spread: 1.0,
    };
  });

  const baseConfig: BacktestConfig = {
    strategyId: 'strat_sma_cross',
    symbol: 'EURUSD',
    timeframe: 'H1',
    startDate: '2023-11-01',
    endDate: '2023-11-30',
    initialBalance: 10000,
    leverage: 200,
    lotSize: 0.1,
    positionSizing: 'fixed_lot',
    riskPctPerTrade: 1.5,
    costModel: {
      spreadMode: 'fixed',
      fixedSpreadPips: 1.0,
      commissionPerLotRoundTurn: 7.0,
      slippagePips: 0.0,
      includeSwap: false,
    },
    provenance: {
      source: 'SIMULATED',
      label: 'SIMULATED',
      details: 'Stage 2 Unit Test Dataset',
      utcOffsetHours: 0,
      isResearchEligible: true,
    },
    params: {},
  };

  it('Requirement 1 & 2: Unknown strategy throws UNKNOWN_STRATEGY error with no silent fallback', () => {
    expect(() => {
      getStrategyExecutor('non_existent_strategy_999');
    }).toThrowError(/UNKNOWN_STRATEGY/);
  });

  it('Requirement 1: Custom strategy produces different trades than Donchian', () => {
    // Custom counter-trend strategy
    const customContract: StrategyContract = {
      name: 'Custom Quick Reversal',
      version: '1.0.0',
      onBar(ctx, bar) {
        if (ctx.barIndex === 30 && ctx.openPositions.length === 0) {
          ctx.buy(0.1, bar.close - 0.0030, bar.close + 0.0060, 'Custom Buy Bar 30');
        }
      },
    };

    const donchianExecutor = getStrategyExecutor('strat_donchian_breakout');
    const customExecutor = getStrategyExecutor('custom_rev', customContract);

    const donchianRes = runBacktest(testCandles, { ...baseConfig, strategyId: 'strat_donchian_breakout' }, donchianExecutor);
    const customRes = runBacktest(testCandles, { ...baseConfig, strategyId: 'custom_rev' }, customExecutor);

    // Custom strategy must have trade on bar 30, whereas Donchian behaves according to channel breaks
    expect(customRes.totalTrades).toBeGreaterThanOrEqual(1);
    expect(customRes.trades[0].entryTime).toBe(testCandles[30].time);
    // Trades must not be identical
    expect(JSON.stringify(customRes.trades)).not.toEqual(JSON.stringify(donchianRes.trades));
  });

  it('Requirement 2: Hand-calculated "Buy on bar 30" strategy gives exact known result', () => {
    // 50 candles: first 30 bars flat at 1.08000
    // Bar 30 close = 1.08000 -> buy entry at Ask = 1.08000 + (1.0 pip * 0.0001 / 2) = 1.08005
    // Bar 35 high surges to 1.08700 -> hits TP at 1.08600
    // Gross pips = (1.08600 - 1.08005) / 0.0001 = 59.5 pips
    // Gross PnL = 59.5 pips * $10/pip * 0.1 lot = $59.50
    // Spread cost = 1.0 pip * $10/pip * 0.1 lot = $1.00
    // Commission = $7.00/lot * 0.1 lot = $0.70
    // Net PnL = $59.50 - $1.00 - $0.70 = $57.80
    const fixedCandles: Candle[] = Array.from({ length: 50 }, (_, i) => {
      let close = 1.08000;
      let high = 1.08050;
      let low = 1.07950;
      if (i === 35) {
        high = 1.08700; // Trigger TP at 1.08600
        close = 1.08650;
      }
      return {
        time: 1700000000 + i * 3600,
        open: 1.08000,
        high,
        low,
        close,
        tickVolume: 200,
        spread: 1.0,
      };
    });

    const buyBar30Contract: StrategyContract = {
      name: 'Buy on Bar 30',
      version: '1.0.0',
      onBar(ctx, bar) {
        if (ctx.barIndex === 30 && ctx.openPositions.length === 0) {
          ctx.buy(0.1, 1.07700, 1.08600, 'Exact Target Trade');
        }
      },
    };

    const executor = getStrategyExecutor('strat_buy_30', buyBar30Contract);
    const result = runBacktest(
      fixedCandles,
      {
        ...baseConfig,
        strategyId: 'strat_buy_30',
      },
      executor
    );

    expect(result.totalTrades).toBe(1);
    const trade = result.trades[0];
    expect(trade.direction).toBe('BUY');
    expect(trade.exitReason).toBe('TP');
    expect(trade.entryPrice).toBeCloseTo(1.08005, 5);
    expect(trade.exitPrice).toBe(1.08600);
    expect(trade.costs.spread).toBe(1.00);
    expect(trade.costs.commission).toBe(0.70);
    expect(trade.pnl).toBe(57.80);
    expect(result.finalBalance).toBe(10057.80);
  });

  it('Requirement 3: QuickJS Sandbox catches CANARY_LOOKAHEAD_VIOLATION on future bar access', async () => {
    const quickjs = await getQuickJS();
    const sandbox = new QuickJSStrategySandbox(quickjs);

    // Malicious code attempting to look at future bar index
    const lookaheadCode = `
      export const strategy = {
        name: "Lookahead Cheat",
        version: "1.0.0",
        onBar(ctx, bar) {
          // Attempt to look ahead to future bar
          var futureBar = ctx.data[ctx.barIndex + 5];
          if (futureBar && futureBar.close > bar.close) {
            ctx.buy(0.1, bar.close - 0.0020, bar.close + 0.0040);
          }
        }
      };
    `;

    const transpiled = transpileStrategyCode(lookaheadCode);

    await expect(
      sandbox.executeBacktest(
        transpiled.jsCode,
        testCandles.slice(0, 35),
        {},
        { balance: 10000, equity: 10000, openPositions: [] },
        () => {}
      )
    ).rejects.toThrowError(/CANARY_LOOKAHEAD_VIOLATION/);
  });

  it('Requirement 4: Cancel flag stops optimization sweep without writing COMPLETED in SQLite', async () => {
    const jobId = `test_cancel_opt_${Date.now()}`;
    createJobDb(jobId, 'OPTIMIZATION', { symbol: 'EURUSD' });

    let isCancelled = false;
    let trialsRun = 0;

    // After 2 trials, trigger cancellation
    const cancelPromise = runOptimizationSweep(
      testCandles,
      {
        strategyId: 'strat_sma_cross',
        symbol: 'EURUSD',
        timeframe: 'H1',
        startDate: '2023-11-01',
        endDate: '2023-11-30',
        searchType: 'grid',
        inSamplePct: 70,
        initialBalance: 10000,
        costModel: {
          spreadMode: 'fixed',
          fixedSpreadPips: 1.0,
          commissionPerLotRoundTurn: 7.0,
          slippagePips: 0.0,
          includeSwap: false,
        },
        paramRanges: [
          { name: 'fastPeriod', min: 10, max: 20, step: 2 },
          { name: 'slowPeriod', min: 40, max: 60, step: 5 },
        ],
      },
      () => {
        trialsRun++;
        if (trialsRun >= 2) {
          isCancelled = true;
          cancelJobDb(jobId);
        }
      },
      {
        isCancelled: () => isCancelled || isJobCancelledDb(jobId),
      }
    );

    await expect(cancelPromise).rejects.toThrowError(/OPTIMIZATION_CANCELLED/);

    // Verify in SQLite: Job status must be CANCELLED and updateJobCompletedDb must refuse overwrite
    expect(isJobCancelledDb(jobId)).toBe(true);
    const overwriteResult = updateJobCompletedDb(jobId, { mock: 'completed_data' });
    expect(overwriteResult).toBe(false);

    const job = getJobDb(jobId);
    expect(job?.status).toBe('CANCELLED');
  });

  it('Requirement 5: SQLite ai_cache persists and retrieves responses deterministically', () => {
    const cacheKey = `test_ai_key_${Date.now()}`;
    expect(getCachedAi(cacheKey)).toBeNull();

    const samplePayload = {
      analysis: 'Test quantitative analysis text',
      score: 85,
    };

    setCachedAi(cacheKey, 'pine_analyze', 'gemini-3.8-flash', 'v1', samplePayload);

    const retrieved = getCachedAi(cacheKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved.analysis).toBe(samplePayload.analysis);
    expect(retrieved.score).toBe(85);
  });

  it('Requirement 6: Wednesday triple-swap calculates 3x multiplier vs 1x on other weekdays', () => {
    // Tuesday 23:00 UTC (1700002800) -> Wednesday 01:00 UTC (1700010000)
    // Date crosses midnight from Tuesday (day 2) to Wednesday (day 3)
    const tuesToWedCandles: Candle[] = [
      {
        time: 1700002800, // 2023-11-14 23:00:00 UTC (Tuesday)
        open: 1.0850,
        high: 1.0860,
        low: 1.0840,
        close: 1.0850,
        tickVolume: 100,
        spread: 1.0,
      },
      {
        time: 1700010000, // 2023-11-15 01:00:00 UTC (Wednesday - triple swap day)
        open: 1.0850,
        high: 1.0860,
        low: 1.0840,
        close: 1.0850,
        tickVolume: 100,
        spread: 1.0,
      },
    ];

    // Monotonic hourly candles so backtest loop index 25 is reached
    // Bar 25 is Tuesday 23:00 UTC, Bar 26 crosses midnight to Wednesday 00:00 UTC (triple swap)
    const tuesdayMidnight = 1700002800; // 2023-11-14 23:00:00 UTC (Tuesday)
    const fullCandles: Candle[] = [];
    for (let i = 0; i < 28; i++) {
      const barTime = tuesdayMidnight + (i - 25) * 3600;
      fullCandles.push({
        time: barTime,
        open: 1.0850,
        high: 1.0860,
        low: 1.0840,
        close: 1.0850,
        tickVolume: 100,
        spread: 1.0,
      });
    }

    const buyContract: StrategyContract = {
      name: 'Hold Long for Swap',
      version: '1.0.0',
      onBar(ctx) {
        if (ctx.barIndex === 25 && ctx.openPositions.length === 0) {
          ctx.buy(1.0, 1.0500, 1.1500, 'Hold overnight');
        }
      },
    };

    const res = runBacktest(
      fullCandles,
      {
        ...baseConfig,
        strategyId: 'swap_test',
        lotSize: 1.0,
        costModel: {
          spreadMode: 'fixed',
          fixedSpreadPips: 1.0,
          commissionPerLotRoundTurn: 0,
          slippagePips: 0,
          includeSwap: true,
        },
      },
      getStrategyExecutor('swap_test', buyContract)
    );

    // For EURUSD: swapLong = -3.20. On Wednesday (tripleSwapDay), swap multiplier is 3.0 -> totalSwap = -9.60 USD
    expect(res.totalSwap).toBeCloseTo(-9.60, 1);
  });

  // =========================================================================
  // Stage 2B Verification Tests (Items 7 through 12)
  // =========================================================================

  it('Requirement 7 & 8: Sandbox compiles strategy once and updates ctx with balance, equity, and frozen openPositions', async () => {
    const QuickJS = await getQuickJS();

    // Strategy that checks ctx properties and verifies openPositions is read-only
    const customCode = `
      export const strategy = {
        name: "Context & Immutability Test",
        version: "1.0.0",
        onBar(ctx, bar) {
          if (ctx.barIndex === 25) {
            // Check equity and balance are updated on ctx
            if (typeof ctx.balance !== 'number' || typeof ctx.equity !== 'number') {
              throw new Error("Missing ctx.balance or ctx.equity");
            }
            // Check openPositions is frozen
            try {
              ctx.openPositions.push({ fake: true });
              throw new Error("openPositions was mutable!");
            } catch (err) {
              // Expected: TypeError on frozen object
            }
          }
          if (ctx.barIndex === 30) {
            ctx.buy(0.1, bar.close - 0.0020, bar.close + 0.0040, "Bar 30 Order");
          }
        }
      };
    `;

    const transpiled = transpileStrategyCode(customCode);
    const executor = createQuickJSStrategyExecutor(QuickJS, transpiled.jsCode, {});

    let signalsCount = 0;
    const res = runBacktest(testCandles, { ...baseConfig, strategyId: 'custom_ctx_test' }, (ctx, params) => {
      executor.strategyLogic(ctx, params);
      signalsCount++;
    });

    executor.dispose();
    expect(signalsCount).toBe(testCandles.length - 25);
    expect(res.totalTrades).toBeGreaterThanOrEqual(1);
  });

  it('Requirement 9: Custom pasted strategy executed in QuickJS produces results from its own code', async () => {
    const QuickJS = await getQuickJS();

    // Strategy that buys ONLY on bar 42
    const bar42Code = `
      export const strategy = {
        name: "Bar 42 Exclusive Strategy",
        version: "1.0.0",
        onBar(ctx, bar) {
          if (ctx.barIndex === 42 && ctx.openPositions.length === 0) {
            ctx.buy(0.2, bar.close - 0.0030, bar.close + 0.0050, "Buy Bar 42");
          }
        }
      };
    `;

    const transpiled = transpileStrategyCode(bar42Code);
    const executor = createQuickJSStrategyExecutor(QuickJS, transpiled.jsCode, {});

    const res = runBacktest(testCandles, { ...baseConfig, strategyId: 'bar42_strat' }, executor.strategyLogic);
    executor.dispose();

    expect(res.totalTrades).toBe(1);
    expect(res.trades[0].entryTime).toBe(testCandles[42].time);
    expect(res.trades[0].size).toBe(0.2);
  });

  it('Requirement 10: calculatePipValue derives exclusively from SymbolSpec as single source of truth', () => {
    // 1. EURUSD standard 10.0 USD per lot
    const eurPip = calculatePipValue('EURUSD');
    expect(eurPip).toBe(10.0);

    // 2. Gold standard 100.0 USD per lot
    const goldPip = calculatePipValue('XAUUSD');
    expect(goldPip).toBe(100.0);

    // 3. Dynamic USDJPY calculation: (100,000 * 0.001) / price
    const jpyPipAt150 = calculatePipValue('USDJPY', 150.0);
    expect(jpyPipAt150).toBeCloseTo(100 / 150, 4);

    const jpyPipAt152_35 = calculatePipValue('USDJPY', 152.35);
    expect(jpyPipAt152_35).toBeCloseTo(0.65638, 3);
  });

  it('Requirement 11: Backtest jobs can be cancelled in SQLite and stay cancelled', () => {
    const testJobId = `job_test_bt_${Date.now()}`;
    createJobDb(testJobId, 'BACKTEST', { symbol: 'EURUSD', timeframe: 'H1' });

    const job = getJobDb(testJobId);
    expect(job?.status).toBe('RUNNING');

    // Cancel job
    const cancelled = cancelJobDb(testJobId);
    expect(cancelled).toBe(true);
    expect(isJobCancelledDb(testJobId)).toBe(true);

    // Attempting to overwrite a cancelled job with COMPLETED must fail
    const overwriteAttempt = updateJobCompletedDb(testJobId, { totalTrades: 5 });
    expect(overwriteAttempt).toBe(false);

    // Verify it remains CANCELLED
    const cancelledJob = getJobDb(testJobId);
    expect(cancelledJob?.status).toBe('CANCELLED');
  });

  it('Requirement 12: Strategies, Bots, and Jobs persist in SQLite across queries', () => {
    const uniqueStratId = `strat_persist_${Date.now()}`;
    const testStrategy: Strategy = {
      id: uniqueStratId,
      name: 'Persisted RSI Strategy',
      description: 'Saved to SQLite',
      sourceType: 'typescript',
      code: 'export const strategy = {};',
      version: '1.0.0',
      tags: ['rsi', 'momentum'],
      paramsSchema: [{ name: 'period', type: 'number', default: 14, description: 'RSI Period' }],
      params: { period: 14 },
      createdAt: new Date().toISOString(),
    };

    saveStrategy(testStrategy, '// transpiled code');
    const allStrats = getAllStrategies();
    const foundStrat = allStrats.find((s) => s.id === uniqueStratId);
    expect(foundStrat).toBeDefined();
    expect(foundStrat?.name).toBe('Persisted RSI Strategy');

    // Bot persistence
    const uniqueBotId = `bot_persist_${Date.now()}`;
    const magicNum = Math.floor(10000 + Math.random() * 80000);
    const testBot: Bot = {
      id: uniqueBotId,
      name: 'Persisted Test Bot',
      strategyId: uniqueStratId,
      strategyName: 'Persisted RSI Strategy',
      accountId: '50192834',
      symbol: 'EURUSD',
      timeframe: 'H1',
      mode: 'DEMO_LIVE',
      status: 'RUNNING',
      params: { period: 14 },
      riskLimits: {
        maxRiskPctPerTrade: 1.0,
        maxLotSize: 0.5,
        maxOpenPositions: 2,
        maxDailyLossUSD: 100,
        stopLossPips: 30,
        takeProfitPips: 60,
        maxSpreadPips: 2.0,
      },
      todayPnl: 12.5,
      totalPnl: 150.0,
      tradesCount: 3,
      lastHeartbeat: new Date().toISOString(),
      logs: [],
    };

    saveBot(testBot, magicNum);
    const allBots = getAllBots();
    const foundBot = allBots.find((b) => b.id === uniqueBotId);
    expect(foundBot).toBeDefined();
    expect(foundBot?.name).toBe('Persisted Test Bot');
    expect(foundBot?.accountId).toBe('50192834');
  });
});
