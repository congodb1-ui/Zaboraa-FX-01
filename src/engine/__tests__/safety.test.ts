import { describe, it, expect, beforeAll } from 'vitest';
import { validateStrategyAST, transpileStrategyCode } from '../transpiler';
import { getQuickJS, QuickJSStrategySandbox } from '../quickjsSandbox';
import { Candle } from '../../types/forex';
import { calculateHeuristicOverfittingScore } from '../overfittingHeuristic';

describe('Safety & Sandbox Isolation Tests', () => {
  let QuickJS: any;

  beforeAll(async () => {
    QuickJS = await getQuickJS();
  });

  const mockCandles: Candle[] = [
    { time: 1700000000, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0840, tickVolume: 100, spread: 1.0 },
    { time: 1700003600, open: 1.0840, high: 1.0880, low: 1.0830, close: 1.0870, tickVolume: 120, spread: 1.0 },
    { time: 1700007200, open: 1.0870, high: 1.0890, low: 1.0850, close: 1.0860, tickVolume: 90, spread: 1.0 },
  ];

  it('AST pre-pass rejects code attempting to access process or file system', () => {
    const maliciousCode = `
      export const strategy = {
        name: "Malicious Exploit",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx) {},
        onBar(ctx, bar) {
          const fs = require('fs');
          process.exit(1);
        }
      };
    `;

    const validation = validateStrategyAST(maliciousCode);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('process'))).toBe(true);
    expect(validation.errors.some(e => e.includes('fs') || e.includes('require'))).toBe(true);
  });

  it('AST pre-pass rejects dynamic code evaluation via Function constructor and eval', () => {
    const evalCode = `
      export const strategy = {
        name: "Eval Exploit",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx) {},
        onBar(ctx, bar) {
          const fn = new Function('return process');
          eval("console.log('escape')");
        }
      };
    `;

    const validation = validateStrategyAST(evalCode);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('Function') || e.includes('eval'))).toBe(true);
  });

  it('Sandboxed QuickJS executes benign TypeScript strategy without host leak', async () => {
    const benignTs = `
      export const strategy = {
        name: "Safe SMA",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx: any) {},
        onBar(ctx: any, bar: any) {
          if (ctx.barIndex === 1) {
            ctx.buy(0.1, bar.close - 0.0030, bar.close + 0.0060, "Safe test buy");
          }
        }
      };
    `;

    const transpile = transpileStrategyCode(benignTs);
    expect(transpile.success).toBe(true);

    const sandbox = new QuickJSStrategySandbox(QuickJS, { memoryLimitBytes: 16 * 1024 * 1024, barTimeoutMs: 100 });
    const signals: any[] = [];

    const res = await sandbox.executeBacktest(
      transpile.jsCode,
      mockCandles,
      {},
      { balance: 10000, equity: 10000, openPositions: [] },
      (s) => signals.push(s)
    );

    expect(res.executedBars).toBe(3);
    expect(signals.length).toBe(1);
    expect(signals[0].action).toBe('BUY');
    expect(signals[0].sl).toBeCloseTo(1.0840, 3);
  });

  it('Canary Look-Ahead Trap: Rejects strategy attempting to read future bars', async () => {
    // Strategy attempts to read bar at index 2 while processing bar index 0
    const lookaheadJs = `
      export const strategy = {
        name: "Lookahead Cheat",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx) {},
        onBar(ctx, bar) {
          if (ctx.barIndex === 0) {
            // Attempt to look ahead to future index 2
            const futureBar = ctx.data[2];
          }
        }
      };
    `;

    const sandbox = new QuickJSStrategySandbox(QuickJS, { barTimeoutMs: 100 });
    const transpiledLookahead = transpileStrategyCode(lookaheadJs);
    expect(transpiledLookahead.success).toBe(true);

    await expect(
      sandbox.executeBacktest(
        transpiledLookahead.jsCode,
        mockCandles,
        {},
        { balance: 10000, equity: 10000, openPositions: [] },
        () => {}
      )
    ).rejects.toThrow(/CANARY_LOOKAHEAD_VIOLATION/);
  });

  it('Interrupt Timeout: Infinite loop inside onBar is halted by deadline', async () => {
    const infiniteLoopJs = `
      export const strategy = {
        name: "Hanging Strategy",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx: any) {},
        onBar(ctx: any, bar: any) {
          while (true) {
            // infinite loop
          }
        }
      };
    `;

    const transpiledLoop = transpileStrategyCode(infiniteLoopJs);
    expect(transpiledLoop.success).toBe(true);

    const sandbox = new QuickJSStrategySandbox(QuickJS, { barTimeoutMs: 30 }); // 30ms deadline
    await expect(
      sandbox.executeBacktest(
        transpiledLoop.jsCode,
        mockCandles,
        {},
        { balance: 10000, equity: 10000, openPositions: [] },
        () => {}
      )
    ).rejects.toThrow(/interrupted/i);
  });

  it('Heuristic Overfitting Score caps every term at 100 and applies trade-per-parameter penalty', () => {
    const scoreBreakdown = calculateHeuristicOverfittingScore({
      isSharpe: 2.5,
      oosSharpe: 0.2, // severe degradation
      isTrades: 12,   // low trades (< 30)
      oosTrades: 4,
      paramCount: 5,  // 12 trades / 5 params = 2.4 trades per parameter!
      totalTrialsTested: 100,
    });

    expect(scoreBreakdown.totalScore).toBeGreaterThanOrEqual(50);
    expect(scoreBreakdown.label).toBe('Elevated Overfitting Indication');
    expect(scoreBreakdown.terms.oosDegradation).toBeLessThanOrEqual(100);
    expect(scoreBreakdown.terms.tradesPerParameterPenalty).toBeLessThanOrEqual(100);
    expect(scoreBreakdown.terms.sampleSizePenalty).toBeLessThanOrEqual(100);
  });
});
