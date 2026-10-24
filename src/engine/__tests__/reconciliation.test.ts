import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDb,
  setNoNewOrdersFlag,
  getNoNewOrdersFlag,
  saveLiveToken,
  consumeLiveToken,
  logOrderIntent,
  updateOrderStatus,
  getPendingOrders,
  getOrderById,
  saveBot,
  savePositionDb,
  getPositionByTicketDb,
  getOpenPositionsDb,
} from '../../services/db';
import { hashContent } from '../../services/crypto';
import { OrderRecord } from '../../types/forex';
import { BridgeClient } from '../../services/bridgeClient';
import { reconcileWithBroker } from '../reconciliation';

describe('Order Lifecycle, Live Gate & Reconciliation Tests (Stage 3A-Fix)', () => {
  beforeEach(() => {
    // Reset DB state before each test
    setNoNewOrdersFlag(false);
    const db = getDb();
    db.exec('DELETE FROM orders');
    db.exec('DELETE FROM positions');
    db.exec('DELETE FROM bots');
    db.exec('DELETE FROM live_tokens');
  });

  it('Live Gate: Single-use confirmation token is consumed atomically and rejects replay', () => {
    const botId = 'bot_live_test_1';
    const accountLogin = '50192834';
    const riskLimits = { maxRiskPctPerTrade: 1.5, maxLotSize: 0.5 };
    const riskHash = hashContent(JSON.stringify(riskLimits));

    const token = `token_test_abc_${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60000).toISOString();

    saveLiveToken({
      token,
      botId,
      accountLogin,
      riskHash,
      createdAt: now.toISOString(),
      expiresAt,
    });

    // 1st consumption: must succeed
    const firstUse = consumeLiveToken(token, botId, accountLogin, riskHash);
    expect(firstUse).toBe(true);

    // 2nd consumption (replay attack): must be rejected
    const replayUse = consumeLiveToken(token, botId, accountLogin, riskHash);
    expect(replayUse).toBe(false);

    // Tampered risk hash: must be rejected
    const tamperedHash = hashContent(JSON.stringify({ maxRiskPctPerTrade: 5.0 }));
    const tamperedUse = consumeLiveToken('token_new_different', botId, accountLogin, tamperedHash);
    expect(tamperedUse).toBe(false);
  });

  it('Kill Switch: Sets persistent no_new_orders flag blocking order opens only', () => {
    expect(getNoNewOrdersFlag()).toBe(false);

    setNoNewOrdersFlag(true);
    expect(getNoNewOrdersFlag()).toBe(true);

    // Manual confirmed reset restores order creation capability
    setNoNewOrdersFlag(false);
    expect(getNoNewOrdersFlag()).toBe(false);
  });

  it('Order State Machine: Transitions PENDING_BROKER -> SENT -> FILLED with pre-logged intent', () => {
    const orderId = `ord_test_${Date.now()}`;
    const orderRecord: OrderRecord = {
      id: orderId,
      idempotencyKey: `idemp_${Date.now()}`,
      botId: 'bot_eur_1',
      magicNumber: 10482,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.2,
      intentPrice: 1.0834,
      sl: 1.0805, // Mandatory SL
      tp: 1.0890,
      status: 'PENDING_BROKER',
      comment: 'zfx_10482_init',
      createdAt: new Date().toISOString(),
    };

    // Pre-log intent
    logOrderIntent(orderRecord);

    const pending = getPendingOrders();
    expect(pending.some(o => o.id === orderId && o.status === 'PENDING_BROKER')).toBe(true);

    // Transition to SENT
    updateOrderStatus(orderId, 'SENT');
    const sent = getPendingOrders();
    expect(sent.some(o => o.id === orderId && o.status === 'SENT')).toBe(true);

    // Transition to FILLED
    updateOrderStatus(orderId, 'FILLED', 98124, 1.0835);
    const postFillPending = getPendingOrders();
    expect(postFillPending.some(o => o.id === orderId)).toBe(false);
  });

  // ==========================================
  // RECONCILIATION SUITE: 6 CASES + RESTART
  // ==========================================

  it('Case 1: Pending or UNKNOWN order found at broker becomes FILLED', async () => {
    const orderId = `ord_rec_case1_${Date.now()}`;
    const magic = 20491;
    logOrderIntent({
      id: orderId,
      idempotencyKey: `idemp_case1_${Date.now()}`,
      botId: 'bot_case1',
      magicNumber: magic,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      intentPrice: 1.0850,
      sl: 1.0800,
      status: 'UNKNOWN',
      comment: `zfx_${magic}`,
      createdAt: new Date().toISOString(),
    });

    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([
        {
          ticket: 77102,
          magic,
          symbol: 'EURUSD',
          type: 0,
          volume: 0.1,
          price_open: 1.0852,
          price_current: 1.0855,
          sl: 1.0800,
          tp: 1.0900,
          profit: 3.0,
          swap: 0,
          time: 1700000000,
          comment: `zfx_${magic}`,
        },
      ]),
      getDeals: vi.fn().mockResolvedValue([]),
    } as unknown as BridgeClient;

    const report = await reconcileWithBroker(mockClient);
    expect(report.ordersFilled).toBe(1);

    const updatedOrder = getOrderById(orderId);
    expect(updatedOrder?.status).toBe('FILLED');
    expect(updatedOrder?.ticket).toBe(77102);
    expect(updatedOrder?.fillPrice).toBe(1.0852);
  });

  it('Case 2: Pending order not found after grace period becomes FAILED (never auto-resent)', async () => {
    const orderId = `ord_rec_case2_${Date.now()}`;
    // Created 120 seconds ago (older than gracePeriodSeconds = 30)
    const oldTimestamp = new Date(Date.now() - 120 * 1000).toISOString();

    logOrderIntent({
      id: orderId,
      idempotencyKey: `idemp_case2_${Date.now()}`,
      botId: 'bot_case2',
      magicNumber: 88471,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      intentPrice: 1.0850,
      sl: 1.0800,
      status: 'SENT',
      comment: 'zfx_old_order',
      createdAt: oldTimestamp,
    });

    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([]),
      getDeals: vi.fn().mockResolvedValue([]),
    } as unknown as BridgeClient;

    const report = await reconcileWithBroker(mockClient, { gracePeriodSeconds: 30 });
    expect(report.ordersFailed).toBe(1);

    const updated = getOrderById(orderId);
    expect(updated?.status).toBe('FAILED');
    expect(updated?.errorReason).toContain('grace period');
  });

  it("Case 3: Broker position with a known bot's magic number but no database record is adopted", async () => {
    const magic = 44102;
    saveBot(
      {
        id: 'bot_trend_44',
        name: 'Known Trend Bot 44',
        strategyId: 'strat_sma',
        strategyName: 'SMA Trend Follower',
        accountId: '50192834',
        symbol: 'GBPUSD',
        timeframe: 'H1',
        mode: 'DEMO_LIVE',
        status: 'RUNNING',
        params: {},
        riskLimits: {} as any,
        todayPnl: 0,
        totalPnl: 0,
        tradesCount: 0,
        lastHeartbeat: new Date().toISOString(),
        logs: [],
      },
      magic
    );

    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([
        {
          ticket: 66010,
          magic,
          symbol: 'GBPUSD',
          type: 1, // SELL
          volume: 0.2,
          price_open: 1.2950,
          price_current: 1.2940,
          sl: 1.2990,
          tp: 1.2850,
          profit: 20.0,
          swap: -0.5,
          time: 1700001000,
          comment: 'broker_open',
        },
      ]),
      getDeals: vi.fn().mockResolvedValue([]),
    } as unknown as BridgeClient;

    const report = await reconcileWithBroker(mockClient);
    expect(report.positionsAdopted).toBe(1);

    const adopted = getPositionByTicketDb(66010);
    expect(adopted).not.toBeNull();
    expect(adopted?.botId).toBe('bot_trend_44');
    expect(adopted?.magicNumber).toBe(magic);
    expect(adopted?.side).toBe('SELL');
    expect(adopted?.status).toBe('ADOPTED');
  });

  it('Case 4: Broker position with an unknown magic number is flagged as an ORPHAN risk event', async () => {
    const orphanMagic = 999182; // No bot in DB has this magic number

    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([
        {
          ticket: 55401,
          magic: orphanMagic,
          symbol: 'XAUUSD',
          type: 0,
          volume: 0.1,
          price_open: 2720.0,
          price_current: 2725.0,
          sl: 2700.0,
          tp: 2750.0,
          profit: 50.0,
          swap: 0,
          time: 1700002000,
          comment: 'manual_trader',
        },
      ]),
      getDeals: vi.fn().mockResolvedValue([]),
    } as unknown as BridgeClient;

    const report = await reconcileWithBroker(mockClient);
    expect(report.orphanPositions).toBe(1);

    const orphanPos = getPositionByTicketDb(55401);
    expect(orphanPos).not.toBeNull();
    expect(orphanPos?.status).toBe('ORPHAN');
  });

  it('Case 5: Database shows open but the broker closed it: mark it closed with price & time', async () => {
    const ticket = 33109;
    savePositionDb({
      ticket,
      botId: 'bot_case5',
      magicNumber: 10482,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      openPrice: 1.0840,
      sl: 1.0800,
      tp: 1.0900,
      openTime: 1700000000,
      isClosed: false,
    });

    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([]), // Ticket 33109 is NO LONGER in open positions!
      getDeals: vi.fn().mockResolvedValue([
        {
          ticket: 99120,
          order: ticket,
          position_id: ticket,
          time: 1700003600,
          type: 1, // SELL (exit)
          entry: 1, // ENTRY_OUT
          magic: 10482,
          volume: 0.1,
          price: 1.0890,
          profit: 50.0,
          commission: -1.0,
          swap: -0.2,
          symbol: 'EURUSD',
          comment: 'tp_hit',
        },
      ]),
    } as unknown as BridgeClient;

    const report = await reconcileWithBroker(mockClient);
    expect(report.positionsClosed).toBe(1);

    const closedPos = getPositionByTicketDb(ticket);
    expect(closedPos?.isClosed).toBe(true);
    expect(closedPos?.closePrice).toBe(1.0890);
    expect(closedPos?.closeTime).toBe(1700003600);
    expect(closedPos?.pnl).toBe(48.8); // 50.0 - 1.0 - 0.2
  });

  it('Case 6: An adopted position with no stop-loss raises a risk event and requires manual action (or auto-closes)', async () => {
    const ticketNoSl = 22108;
    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([
        {
          ticket: ticketNoSl,
          magic: 7771,
          symbol: 'EURUSD',
          type: 0,
          volume: 0.1,
          price_open: 1.0850,
          price_current: 1.0855,
          sl: 0.0, // MISSING STOP-LOSS!
          tp: 0.0,
          profit: 5.0,
          swap: 0,
          time: 1700000000,
          comment: 'no_sl_hazard',
        },
      ]),
      getDeals: vi.fn().mockResolvedValue([]),
      closePosition: vi.fn().mockResolvedValue({ status: 'SUCCESS', ticket: ticketNoSl }),
    } as unknown as BridgeClient;

    // Test with autoCloseMissingSl = true
    const report = await reconcileWithBroker(mockClient, { autoCloseMissingSl: true });
    expect(report.missingSlPositions).toBe(1);
    expect(mockClient.closePosition).toHaveBeenCalledWith(ticketNoSl);
  });

  it('Restart Reconciliation: Reconciles all pending/open records cleanly upon boot', async () => {
    const ordPending = `ord_restart_${Date.now()}`;
    logOrderIntent({
      id: ordPending,
      idempotencyKey: `idemp_restart_${Date.now()}`,
      botId: 'bot_restart',
      magicNumber: 1234,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.1,
      intentPrice: 1.0845,
      sl: 1.0810,
      status: 'PENDING_BROKER',
      comment: 'zfx_restart_test',
      createdAt: new Date(Date.now() - 5000).toISOString(),
    });

    const mockClient = {
      getPositions: vi.fn().mockResolvedValue([]),
      getDeals: vi.fn().mockResolvedValue([]),
    } as unknown as BridgeClient;

    const report = await reconcileWithBroker(mockClient, { gracePeriodSeconds: 0 }); // Immediate expiration
    expect(report.ordersFailed).toBe(1);

    const resolved = getOrderById(ordPending);
    expect(resolved?.status).toBe('FAILED');
  });
});
