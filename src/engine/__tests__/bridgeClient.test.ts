import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BridgeClient,
  BridgeError,
  generateBarIdempotencyKey,
  createPendingOrder,
  transitionOrderSent,
  transitionOrderFilled,
  transitionOrderRejected,
  transitionOrderUnknown,
  executeOrderThroughBridge,
} from '../../services/bridgeClient';
import { getOrderById, getDb, saveLiveToken } from '../../services/db';
import { hashContent } from '../../services/crypto';

describe('MT5 Bridge Client & Order Lifecycle Tests (Stage 3A)', () => {
  const TEST_TOKEN = 'zaboraa_test_live_bridge_token_strictly_over_24_chars_length';

  beforeEach(() => {
    // Ensure DB is initialized
    getDb();
  });

  // ==========================================
  // 1. BRIDGE CLIENT ESSENTIALS & AUTH
  // ==========================================
  describe('BridgeClient Authentication & Configuration', () => {
    it('throws BRIDGE_UNAUTHORIZED immediately if token is empty', async () => {
      const client = new BridgeClient({ baseUrl: 'http://127.0.0.1:8001', token: '' });
      await expect(client.getHealth()).rejects.toThrow('Bridge token is not configured');
      try {
        await client.getHealth();
      } catch (err: any) {
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe('BRIDGE_UNAUTHORIZED');
        expect(err.statusCode).toBe(401);
      }
    });

    it('successfully calls getHealth and parses standard MT5 response', async () => {
      const mockHealth = {
        status: 'ONLINE',
        mt5_package_installed: true,
        terminal_running: true,
        mt5_initialized: true,
        broker_connected: true,
        algo_trading_enabled: true,
        server_name: 'Exness-MT5Trial9',
        account_type: 'DEMO' as const,
        is_demo: true,
        broker_utc_offset_hours: 2,
        allow_trading: true,
        kill_engaged: false,
        timestamp_utc: new Date().toISOString(),
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockHealth,
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const result = await client.getHealth();
      expect(result.status).toBe('ONLINE');
      expect(result.account_type).toBe('DEMO');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://127.0.0.1:8001/health');
      expect(calledInit.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
    });

    it('successfully calls getAccount and parses demo account details', async () => {
      const mockAccount = {
        login: 50192834,
        server: 'Exness-MT5Trial9',
        account_type: 'DEMO' as const,
        is_demo: true,
        balance: 10000.0,
        equity: 10000.0,
        margin: 0.0,
        free_margin: 10000.0,
        leverage: 200,
        currency: 'USD',
        utc_offset_hours: 2,
        status: 'LIVE_MT5_LINK',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAccount,
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const result = await client.getAccount();
      expect(result.login).toBe(50192834);
      expect(result.balance).toBe(10000.0);
    });

    it('successfully calls getPositions and parses open positions array', async () => {
      const mockPositions = [
        {
          ticket: 98124,
          time: 1710000000,
          type: 0,
          magic: 1001,
          volume: 0.1,
          price_open: 1.085,
          sl: 1.08,
          tp: 1.095,
          price_current: 1.086,
          swap: -1.2,
          profit: 10.0,
          symbol: 'EURUSDm',
          comment: 'zfx_1001',
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPositions,
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const result = await client.getPositions();
      expect(result).toHaveLength(1);
      expect(result[0].ticket).toBe(98124);
      expect(result[0].price_open).toBe(1.085);
    });
  });

  // ==========================================
  // 2. FAST-FAIL ON 401, 403, 400 (NO RETRIES)
  // ==========================================
  describe('Fast-Fail Security Discipline', () => {
    it('fast-fails immediately on 401 Unauthorized without retrying', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Invalid bridge token. Token mismatch.' }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 3,
        fetchFn: mockFetch as any,
      });

      await expect(client.getHealth()).rejects.toThrow('Bridge authentication rejected');
      // Must NOT have retried — exactly 1 attempt
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fast-fails immediately on 403 Forbidden without retrying', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'Live order routing is disabled in mt5-bridge (ALLOW_TRADING=false).' }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 3,
        fetchFn: mockFetch as any,
      });

      await expect(
        client.sendOrder({
          symbol: 'EURUSD',
          side: 'BUY',
          volume: 0.1,
          sl: 1.08,
        })
      ).rejects.toThrow('Bridge access forbidden');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fast-fails immediately on client side if Stop-Loss is missing or <= 0', async () => {
      const mockFetch = vi.fn();
      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      await expect(
        client.sendOrder({
          symbol: 'EURUSD',
          side: 'BUY',
          volume: 0.1,
          sl: 0,
        })
      ).rejects.toThrow('MANDATORY_STOP_LOSS_REQUIRED');

      // Zero network calls should have been made
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });
  });

  // ==========================================
  // 3. EXPONENTIAL BACKOFF & RETRY LOGIC
  // ==========================================
  describe('Exponential Backoff & Timeout Handling', () => {
    it('retries on transient 500 error and succeeds on subsequent attempt', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ detail: 'Transient MT5 terminal IPC glitch' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ONLINE', is_demo: true }),
        };
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 3,
        initialRetryDelayMs: 10,
        fetchFn: mockFetch as any,
      });

      const res = await client.getHealth();
      expect(res.status).toBe('ONLINE');
      expect(callCount).toBe(3); // 2 failed + 1 successful
    });

    it('exhausts all retries and throws BRIDGE_ERROR when 500 persists', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'Bridge service temporarily overloaded' }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 2,
        initialRetryDelayMs: 5,
        fetchFn: mockFetch as any,
      });

      await expect(client.getHealth()).rejects.toThrow('Bridge HTTP 503');
      expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('handles request timeout and throws BRIDGE_TIMEOUT with status 408', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 1,
        initialRetryDelayMs: 5,
        fetchFn: mockFetch as any,
      });

      try {
        await client.getHealth();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe('BRIDGE_TIMEOUT');
        expect(err.statusCode).toBe(408);
      }
      expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
    });
  });

  // ==========================================
  // 4. CLOSED-BAR IDEMPOTENCY KEY
  // ==========================================
  describe('Closed-Bar Idempotency Key Math & Integrity', () => {
    it('generates consistent deterministic SHA-256 hash across identical inputs', () => {
      const key1 = generateBarIdempotencyKey('bot_101', 'EURUSD', 'H1', 1710000000, 'BUY');
      const key2 = generateBarIdempotencyKey('bot_101', 'EURUSD', 'H1', 1710000000, 'BUY');
      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex string

      const expected = hashContent('bot_101:EURUSD:H1:1710000000:BUY');
      expect(key1).toBe(expected);
    });

    it('generates completely different keys for different bars or directions', () => {
      const keyBuy = generateBarIdempotencyKey('bot_101', 'EURUSD', 'H1', 1710000000, 'BUY');
      const keySell = generateBarIdempotencyKey('bot_101', 'EURUSD', 'H1', 1710000000, 'SELL');
      const keyNextBar = generateBarIdempotencyKey('bot_101', 'EURUSD', 'H1', 1710003600, 'BUY');

      expect(keyBuy).not.toBe(keySell);
      expect(keyBuy).not.toBe(keyNextBar);
    });
  });

  // ==========================================
  // 5. 4-STATE ORDER LIFECYCLE IN SQLITE
  // ==========================================
  describe('4-State Order Lifecycle & Transition Integrity', () => {
    it('creates PENDING_BROKER order and rejects duplicate on same bar', () => {
      const barTimestamp = 1712000000 + Math.floor(Math.random() * 1000000);
      const testBotId = `bot_donchian_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const idempotencyKey = generateBarIdempotencyKey(testBotId, 'GBPUSD', 'H1', barTimestamp, 'BUY');

      const order = createPendingOrder({
        idempotencyKey,
        botId: testBotId,
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'GBPUSD',
        side: 'BUY',
        volume: 0.2,
        intentPrice: 1.265,
        sl: 1.258,
        tp: 1.275,
      });

      expect(order.status).toBe('PENDING_BROKER');
      expect(order.idempotencyKey).toBe(idempotencyKey);

      // Verify in SQLite
      const retrieved = getOrderById(order.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.status).toBe('PENDING_BROKER');
      expect(retrieved?.sl).toBe(1.258);

      // Attempt duplicate order with same key must fail loudly
      expect(() => {
        createPendingOrder({
          idempotencyKey,
          botId: 'bot_donchian_test',
          magicNumber: 9999,
          symbol: 'GBPUSD',
          side: 'BUY',
          volume: 0.2,
          intentPrice: 1.265,
          sl: 1.258,
        });
      }).toThrow('DUPLICATE_ORDER_INTENT');
    });

    it('transitions cleanly: PENDING_BROKER -> SENT -> FILLED', () => {
      const order = createPendingOrder({
        idempotencyKey: `idem_${Date.now()}_${Math.random()}`,
        botId: 'bot_test_cycle',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      // State 1: PENDING_BROKER
      expect(getOrderById(order.id)?.status).toBe('PENDING_BROKER');

      // State 2: SENT
      transitionOrderSent(order.id);
      expect(getOrderById(order.id)?.status).toBe('SENT');

      // State 3: FILLED
      const ticket = Math.floor(100000 + Math.random() * 900000);
      const filled = transitionOrderFilled(order.id, ticket, 1.0852);

      expect(filled.status).toBe('FILLED');
      expect(filled.ticket).toBe(ticket);
      expect(filled.fillPrice).toBe(1.0852);
      expect(filled.filledAt).toBeDefined();

      const inDb = getOrderById(order.id);
      expect(inDb?.status).toBe('FILLED');
      expect(inDb?.ticket).toBe(ticket);
    });

    it('transitions to REJECTED when broker or firewall denies execution', () => {
      const order = createPendingOrder({
        idempotencyKey: `idem_rej_${Date.now()}_${Math.random()}`,
        botId: 'bot_test_rej',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'SELL',
        volume: 0.5,
        intentPrice: 1.08,
        sl: 1.085,
      });

      transitionOrderSent(order.id);
      const rejected = transitionOrderRejected(order.id, 'BROKER_REJECTED_OFF_QUOTES');

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.errorReason).toBe('BROKER_REJECTED_OFF_QUOTES');

      const inDb = getOrderById(order.id);
      expect(inDb?.status).toBe('REJECTED');
      expect(inDb?.errorReason).toBe('BROKER_REJECTED_OFF_QUOTES');
    });

    it('transitions to UNKNOWN on timeout or network rupture during in-flight order', () => {
      const order = createPendingOrder({
        idempotencyKey: `idem_unk_${Date.now()}_${Math.random()}`,
        botId: 'bot_test_unk',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'USDJPY',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 154.2,
        sl: 153.5,
      });

      transitionOrderSent(order.id);
      const unknownOrder = transitionOrderUnknown(order.id, 'SOCKET_TIMEOUT_WAITING_BROKER_ACK');

      expect(unknownOrder.status).toBe('UNKNOWN');
      expect(unknownOrder.errorReason).toBe('SOCKET_TIMEOUT_WAITING_BROKER_ACK');

      const inDb = getOrderById(order.id);
      expect(inDb?.status).toBe('UNKNOWN');
    });
  });

  // ==========================================
  // 6. END-TO-END EXECUTION THROUGH BRIDGE
  // ==========================================
  describe('End-to-End Execution Flow (executeOrderThroughBridge)', () => {
    it('successfully routes order through bridge and records fill in SQLite', async () => {
      const mockTicket = 771234;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'SUCCESS',
          message: 'Order filled on Exness MT5',
          ticket: mockTicket,
          fill_price: 1.0845,
        }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const order = createPendingOrder({
        idempotencyKey: `idem_e2e_${Date.now()}_${Math.random()}`,
        botId: 'bot_e2e_live',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.0845,
        sl: 1.08,
      });

      const res = await executeOrderThroughBridge(client, order);

      expect(res.success).toBe(true);
      expect(res.order.status).toBe('FILLED');
      expect(res.order.ticket).toBe(mockTicket);
      expect(res.order.fillPrice).toBe(1.0845);

      const dbOrder = getOrderById(order.id);
      expect(dbOrder?.status).toBe('FILLED');
      expect(dbOrder?.ticket).toBe(mockTicket);
    });

    it('transitions to REJECTED when bridge throws 403 Forbidden', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'Bridge kill switch is active. Orders blocked.' }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const order = createPendingOrder({
        idempotencyKey: `idem_kill_rej_${Date.now()}_${Math.random()}`,
        botId: 'bot_kill_blocked',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      const res = await executeOrderThroughBridge(client, order);

      expect(res.success).toBe(false);
      expect(res.order.status).toBe('REJECTED');
      expect(res.error).toContain('Bridge access forbidden');

      const dbOrder = getOrderById(order.id);
      expect(dbOrder?.status).toBe('REJECTED');
    });

    it('transitions to UNKNOWN when bridge connection times out during transmission', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        const err = new Error('Timeout');
        err.name = 'AbortError';
        throw err;
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 0, // fast fail for test speed
        fetchFn: mockFetch as any,
      });

      const order = createPendingOrder({
        idempotencyKey: `idem_to_unk_${Date.now()}_${Math.random()}`,
        botId: 'bot_timeout_unk',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      const res = await executeOrderThroughBridge(client, order);

      expect(res.success).toBe(false);
      expect(res.order.status).toBe('UNKNOWN');
      expect(res.error).toContain('timed out');

      const dbOrder = getOrderById(order.id);
      expect(dbOrder?.status).toBe('UNKNOWN');
    });

    it('rejects LIVE order if liveToken is missing', async () => {
      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
      });

      const order = createPendingOrder({
        idempotencyKey: `idem_live_no_token_${Date.now()}_${Math.random()}`,
        botId: 'bot_live_test',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      const res = await executeOrderThroughBridge(client, order, {
        botMode: 'LIVE',
      });

      expect(res.success).toBe(false);
      expect(res.order.status).toBe('REJECTED');
      expect(res.order.errorReason).toBe('MISSING_LIVE_GATE_CREDENTIALS');
    });

    it('accepts and consumes live gate token for authorized LIVE order', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'SUCCESS',
          ticket: 882910,
          fill_price: 1.085,
        }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const botId = `bot_live_${Date.now()}`;
      const accountLogin = '50192834';
      const riskLimits = { maxLotSize: 1.0, maxRiskPctPerTrade: 1.0 };
      const riskHash = hashContent(JSON.stringify(riskLimits));
      const liveToken = `tok_${Date.now()}_${Math.random()}`;

      // Pre-save live token
      saveLiveToken({
        token: liveToken,
        botId,
        accountLogin,
        riskHash,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      const order = createPendingOrder({
        idempotencyKey: `idem_live_auth_${Date.now()}_${Math.random()}`,
        botId,
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      const res = await executeOrderThroughBridge(client, order, {
        botMode: 'LIVE',
        liveToken,
        accountLogin,
        riskLimits,
      });

      expect(res.success).toBe(true);
      expect(res.order.status).toBe('FILLED');
      expect(res.order.ticket).toBe(882910);

      // Attempting to reuse the exact same token must fail because it was consumed
      const order2 = createPendingOrder({
        idempotencyKey: `idem_live_reuse_${Date.now()}_${Math.random()}`,
        botId,
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      const res2 = await executeOrderThroughBridge(client, order2, {
        botMode: 'LIVE',
        liveToken,
        accountLogin,
        riskLimits,
      });

      expect(res2.success).toBe(false);
      expect(res2.order.status).toBe('REJECTED');
      expect(res2.order.errorReason).toBe('INVALID_OR_EXPIRED_LIVE_TOKEN');
    });

    it('sendOrder: makes exactly one request on 5xx (zero retries) and order transitions to UNKNOWN', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal bridge error during execution' }),
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        maxRetries: 3, // Default is 3 retries, but sendOrder must override to 0!
        fetchFn: mockFetch as any,
      });

      const order = createPendingOrder({
        idempotencyKey: `idem_500_single_try_${Date.now()}_${Math.random()}`,
        botId: 'bot_test_retry',
        magicNumber: Math.floor(10000 + Math.random() * 80000),
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        intentPrice: 1.085,
        sl: 1.08,
      });

      const res = await executeOrderThroughBridge(client, order);

      // Must be exactly 1 attempt — ZERO retries on order sends!
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res.success).toBe(false);
      expect(res.order.status).toBe('UNKNOWN');

      const dbOrder = getOrderById(order.id);
      expect(dbOrder?.status).toBe('UNKNOWN');
    });

    it('supports getDeals and cancelPending endpoints on BridgeClient', async () => {
      const mockDeals = [
        { ticket: 501, order: 201, time: 1700000000, type: 0, entry: 0, magic: 10482, position_id: 201, volume: 0.1, price: 1.085, commission: -1, swap: 0, profit: 0, symbol: 'EURUSD', comment: 'test' },
      ];
      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        if (url.includes('/deals')) {
          return { ok: true, status: 200, json: async () => mockDeals };
        }
        if (url.includes('/orders/99101') && init.method === 'DELETE') {
          return { ok: true, status: 200, json: async () => ({ status: 'SUCCESS', message: 'Cancelled', ticket: 99101 }) };
        }
        return { ok: false, status: 404 };
      });

      const client = new BridgeClient({
        baseUrl: 'http://127.0.0.1:8001',
        token: TEST_TOKEN,
        fetchFn: mockFetch as any,
      });

      const deals = await client.getDeals(10482);
      expect(deals).toHaveLength(1);
      expect(deals[0].ticket).toBe(501);

      const cancelRes = await client.cancelPending(99101);
      expect(cancelRes.status).toBe('SUCCESS');
      expect(cancelRes.ticket).toBe(99101);
    });
  });
});
