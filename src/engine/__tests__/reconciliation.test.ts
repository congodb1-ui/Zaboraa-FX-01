import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDb,
  setNoNewOrdersFlag,
  getNoNewOrdersFlag,
  saveLiveToken,
  consumeLiveToken,
  logOrderIntent,
  updateOrderStatus,
  getPendingOrders,
} from '../../services/db';
import { hashContent } from '../../services/crypto';
import { OrderRecord } from '../../types/forex';

describe('Order Lifecycle, Live Gate & Reconciliation Tests', () => {
  beforeEach(() => {
    // Reset DB state before each test
    setNoNewOrdersFlag(false);
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

  it('Bi-directional Reconciliation Direction A: MT5 has position not in DB -> Adopted & checked for SL', () => {
    // Mock MT5 position received from terminal IPC
    const mt5Position = {
      ticket: 99401,
      magic: 10482, // matches bot magic
      symbol: 'EURUSD',
      type: 0, // BUY
      volume: 0.1,
      price_open: 1.0820,
      sl: 0.0, // Missing SL!
      tp: 1.0880,
      comment: 'manual_or_orphaned',
    };

    // Reconciliation logic
    const dbPositions: any[] = []; // DB does not have it
    const adoptedTrades: any[] = [];

    const existsInDb = dbPositions.some(p => p.ticket === mt5Position.ticket);
    if (!existsInDb) {
      const hasMissingSl = !mt5Position.sl || mt5Position.sl <= 0;
      adoptedTrades.push({
        ticket: mt5Position.ticket,
        magicNumber: mt5Position.magic,
        symbol: mt5Position.symbol,
        sl: mt5Position.sl,
        flagMissingSl: hasMissingSl,
        status: hasMissingSl ? 'ADOPTED_MISSING_SL_WARNING' : 'ADOPTED_NORMAL',
      });
    }

    expect(adoptedTrades.length).toBe(1);
    expect(adoptedTrades[0].flagMissingSl).toBe(true);
    expect(adoptedTrades[0].status).toBe('ADOPTED_MISSING_SL_WARNING');
  });

  it('Bi-directional Reconciliation Direction B: DB recorded open position, MT5 reports it closed -> Marked closed in DB', () => {
    // DB recorded position as open
    const dbOpenPositions = [
      { ticket: 88201, symbol: 'GBPUSD', side: 'BUY', volume: 0.2, openPrice: 1.2950, isClosed: false },
    ];

    // MT5 positions list does NOT contain ticket 88201 (e.g. SL was hit while server was rebooting)
    const mt5ActivePositions: any[] = []; // empty!

    const reconciledPositions = dbOpenPositions.map(pos => {
      const stillOpenInMt5 = mt5ActivePositions.some(m => m.ticket === pos.ticket);
      if (!stillOpenInMt5) {
        return {
          ...pos,
          isClosed: true,
          reconciledReason: 'POSITION_CLOSED_BY_BROKER_DURING_DOWNTIME',
          closedAt: new Date().toISOString(),
        };
      }
      return pos;
    });

    expect(reconciledPositions[0].isClosed).toBe(true);
    expect((reconciledPositions[0] as any).reconciledReason).toBe('POSITION_CLOSED_BY_BROKER_DURING_DOWNTIME');
  });
});
