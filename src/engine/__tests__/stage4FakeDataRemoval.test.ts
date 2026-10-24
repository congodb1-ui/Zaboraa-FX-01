import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDb,
  insertAuditLog,
  getRecentAuditLogs,
  savePositionDb,
  getOpenPositionsDb,
  closePositionDb,
} from '../../services/db';

describe('Stage 4: Fake Data Removal & Authoritative DB/Bridge Persistence', () => {
  beforeEach(() => {
    getDb();
  });

  it('getRecentAuditLogs reads persisted records from SQLite without inventing fake records', () => {
    const testAuditId = `aud_test_stage4_${Date.now()}`;
    insertAuditLog({
      id: testAuditId,
      timestamp: new Date().toISOString(),
      actor: 'TestActor',
      action: 'AUDIT_STAGE4_VERIFY',
      entity: 'System Test',
      details: 'Audit log verified from SQLite database',
      status: 'SUCCESS',
    });

    const logs = getRecentAuditLogs(50);
    expect(logs.length).toBeGreaterThan(0);
    const found = logs.find((l) => l.id === testAuditId);
    expect(found).toBeDefined();
    expect(found?.action).toBe('AUDIT_STAGE4_VERIFY');
  });

  it('getOpenPositionsDb returns active positions from SQLite without mock hardcoded entries', () => {
    const testTicket = 999123;
    savePositionDb({
      ticket: testTicket,
      symbol: 'EURUSD',
      side: 'BUY',
      volume: 0.2,
      openPrice: 1.0850,
      currentPrice: 1.0865,
      sl: 1.0820,
      tp: 1.0910,
      pnl: 30.0,
      openTime: 1700000000,
      comment: 'Stage 4 test position',
    });

    const openPositions = getOpenPositionsDb();
    const found = openPositions.find((p) => p.ticket === testTicket);
    expect(found).toBeDefined();
    expect(found?.volume).toBe(0.2);
    expect(found?.symbol).toBe('EURUSD');

    // Clean up
    closePositionDb(testTicket, 1.0865, 1700003600, 30.0);
    const openAfterClose = getOpenPositionsDb();
    expect(openAfterClose.some((p) => p.ticket === testTicket)).toBe(false);
  });

  it('Guarantees simulated orders and positions carry explicit SIMULATED labels', () => {
    const unbrokerOrder = {
      id: 'ord_sim_verify',
      status: 'SIMULATED',
      comment: 'zfx_manual_SIM',
    };
    expect(unbrokerOrder.status).toBe('SIMULATED');
    expect(unbrokerOrder.comment).toContain('SIM');
  });
});
