import { BridgeClient, BridgePositionResponse, BridgeDeal } from '../services/bridgeClient';
import {
  getPendingOrders,
  updateOrderStatus,
  getOpenPositionsDb,
  getPositionByTicketDb,
  savePositionDb,
  closePositionDb,
  getBotByMagic,
  insertAuditLog,
  insertRiskEvent,
} from '../services/db';
import { OrderRecord } from '../types/forex';

export interface ReconciliationOptions {
  gracePeriodSeconds?: number;
  autoCloseMissingSl?: boolean;
}

export interface ReconciliationReport {
  ordersFilled: number;
  ordersFailed: number;
  positionsAdopted: number;
  orphanPositions: number;
  positionsClosed: number;
  missingSlPositions: number;
  details: string[];
  timestamp: string;
}

/**
 * Executes bidirectional reconciliation between SQLite database and broker terminal:
 * 1. A pending or UNKNOWN order found at broker becomes FILLED (or adopted).
 * 2. A pending order not found after a grace period becomes FAILED (never auto-resent).
 * 3. A broker position with a known bot's magic number but no database record is adopted.
 * 4. A broker position with an unknown magic number is flagged as an ORPHAN risk event.
 * 5. Database shows open but broker closed it: mark it closed with broker's price and time.
 * 6. An adopted position with no stop-loss raises a risk event and requires manual action (configurable auto-close).
 */
export async function reconcileWithBroker(
  client: BridgeClient,
  options: ReconciliationOptions = {}
): Promise<ReconciliationReport> {
  const gracePeriodSeconds = options.gracePeriodSeconds ?? 60;
  const autoCloseMissingSl = options.autoCloseMissingSl ?? false;

  const report: ReconciliationReport = {
    ordersFilled: 0,
    ordersFailed: 0,
    positionsAdopted: 0,
    orphanPositions: 0,
    positionsClosed: 0,
    missingSlPositions: 0,
    details: [],
    timestamp: new Date().toISOString(),
  };

  // Fetch current broker active positions and recent deals
  let brokerPositions: BridgePositionResponse[] = [];
  let brokerDeals: BridgeDeal[] = [];

  try {
    brokerPositions = await client.getPositions();
  } catch (err: any) {
    report.details.push(`Failed to fetch positions from bridge: ${err.message}`);
    return report;
  }

  try {
    brokerDeals = await client.getDeals();
  } catch (_) {
    // Non-fatal if deals history is unavailable
  }

  const brokerTickets = new Set<number>(brokerPositions.map((p) => p.ticket));

  // ----------------------------------------------------
  // CASE 1 & CASE 2: Process Pending & UNKNOWN Orders
  // ----------------------------------------------------
  const pendingOrders = getPendingOrders();
  const nowMs = Date.now();

  for (const order of pendingOrders) {
    // Case 1: Order found in active broker positions or deals -> mark FILLED
    const matchingPos = brokerPositions.find(
      (p) => (order.ticket && p.ticket === order.ticket) || (p.magic === order.magicNumber && p.symbol === order.symbol)
    );

    if (matchingPos) {
      updateOrderStatus(order.id, 'FILLED', matchingPos.ticket, matchingPos.price_open);
      savePositionDb({
        ticket: matchingPos.ticket,
        botId: order.botId,
        magicNumber: order.magicNumber,
        symbol: matchingPos.symbol,
        side: matchingPos.type === 0 ? 'BUY' : 'SELL',
        volume: matchingPos.volume,
        openPrice: matchingPos.price_open,
        currentPrice: matchingPos.price_current,
        sl: matchingPos.sl,
        tp: matchingPos.tp,
        pnl: matchingPos.profit,
        swap: matchingPos.swap,
        openTime: matchingPos.time,
        comment: matchingPos.comment || order.comment,
        status: 'OPEN',
      });
      report.ordersFilled++;
      report.details.push(`Order ${order.id} matched active broker position #${matchingPos.ticket} -> FILLED`);
      insertAuditLog({
        id: `aud_recon_fill_${Date.now()}_${order.id}`,
        timestamp: new Date().toISOString(),
        actor: 'Reconciler',
        action: 'ORDER_RECONCILED_FILLED',
        entity: `${order.symbol} #${matchingPos.ticket}`,
        details: `Pending/UNKNOWN order resolved to FILLED via broker position #${matchingPos.ticket}`,
        status: 'SUCCESS',
      });
      continue;
    }

    // Check if order was already executed and closed in deal history
    const matchingDeal = brokerDeals.find(
      (d) => (order.ticket && d.order === order.ticket) || (d.magic === order.magicNumber && d.symbol === order.symbol)
    );

    if (matchingDeal) {
      updateOrderStatus(order.id, 'FILLED', matchingDeal.order || matchingDeal.ticket, matchingDeal.price);
      report.ordersFilled++;
      report.details.push(`Order ${order.id} matched historical deal #${matchingDeal.ticket} -> FILLED`);
      continue;
    }

    // Case 2: Order not found after grace period -> mark FAILED (never auto-resent)
    const orderAgeSeconds = (nowMs - new Date(order.createdAt).getTime()) / 1000;
    if (orderAgeSeconds >= gracePeriodSeconds) {
      updateOrderStatus(
        order.id,
        'FAILED',
        undefined,
        undefined,
        `Reconciliation: Order not found at broker after grace period of ${gracePeriodSeconds}s`
      );
      report.ordersFailed++;
      report.details.push(`Order ${order.id} expired after ${Math.round(orderAgeSeconds)}s -> FAILED`);
      insertAuditLog({
        id: `aud_recon_fail_${Date.now()}_${order.id}`,
        timestamp: new Date().toISOString(),
        actor: 'Reconciler',
        action: 'ORDER_RECONCILED_FAILED',
        entity: `${order.symbol} #${order.id}`,
        details: `Order expired without broker fill after ${Math.round(orderAgeSeconds)}s. Marked FAILED.`,
        status: 'WARNING',
      });
    }
  }

  // ----------------------------------------------------
  // CASE 3, CASE 4, CASE 6: Process Broker Positions
  // ----------------------------------------------------
  for (const pos of brokerPositions) {
    const existingDbPos = getPositionByTicketDb(pos.ticket);

    if (!existingDbPos) {
      // Position is at broker but NOT in database
      const owningBot = pos.magic ? getBotByMagic(pos.magic) : null;

      if (owningBot) {
        // Case 3: Broker position has known bot magic -> Adopt into DB
        savePositionDb({
          ticket: pos.ticket,
          botId: owningBot.id,
          magicNumber: pos.magic,
          symbol: pos.symbol,
          side: pos.type === 0 ? 'BUY' : 'SELL',
          volume: pos.volume,
          openPrice: pos.price_open,
          currentPrice: pos.price_current,
          sl: pos.sl,
          tp: pos.tp,
          pnl: pos.profit,
          swap: pos.swap,
          openTime: pos.time,
          comment: pos.comment || `adopted_${owningBot.id}`,
          status: 'ADOPTED',
        });
        report.positionsAdopted++;
        report.details.push(`Adopted broker position #${pos.ticket} for bot ${owningBot.name}`);
        insertAuditLog({
          id: `aud_recon_adopt_${Date.now()}_${pos.ticket}`,
          timestamp: new Date().toISOString(),
          actor: 'Reconciler',
          action: 'POSITION_ADOPTED',
          entity: `${pos.symbol} #${pos.ticket}`,
          details: `Adopted broker position #${pos.ticket} with magic ${pos.magic} for bot ${owningBot.name}`,
          status: 'SUCCESS',
        });
      } else {
        // Case 4: Broker position with unknown magic -> Flag as ORPHAN risk event
        savePositionDb({
          ticket: pos.ticket,
          magicNumber: pos.magic,
          symbol: pos.symbol,
          side: pos.type === 0 ? 'BUY' : 'SELL',
          volume: pos.volume,
          openPrice: pos.price_open,
          currentPrice: pos.price_current,
          sl: pos.sl,
          tp: pos.tp,
          pnl: pos.profit,
          swap: pos.swap,
          openTime: pos.time,
          comment: pos.comment || 'orphan_position',
          status: 'ORPHAN',
        });
        report.orphanPositions++;
        report.details.push(`Orphan position #${pos.ticket} (magic ${pos.magic}) detected`);
        insertRiskEvent({
          id: `risk_orphan_${Date.now()}_${pos.ticket}`,
          timestamp: new Date().toISOString(),
          actor: 'Reconciler',
          action: 'ORPHAN_POSITION_DETECTED',
          entity: `${pos.symbol} #${pos.ticket}`,
          details: `Broker position #${pos.ticket} has unknown magic number ${pos.magic}. No bot in system claims it.`,
          severity: 'CRITICAL',
          status: 'ORPHAN',
        });
      }
    }

    // Case 6: Position has NO Stop-Loss set (sl <= 0 or missing)
    if (!pos.sl || pos.sl <= 0) {
      report.missingSlPositions++;
      report.details.push(`Position #${pos.ticket} has no stop-loss`);
      insertRiskEvent({
        id: `risk_no_sl_${Date.now()}_${pos.ticket}`,
        timestamp: new Date().toISOString(),
        actor: 'Reconciler',
        action: 'POSITION_MISSING_STOP_LOSS',
        entity: `${pos.symbol} #${pos.ticket}`,
        details: `Broker position #${pos.ticket} is missing mandatory Stop-Loss. Requires manual intervention.`,
        severity: 'CRITICAL',
        status: 'HAZARD',
      });

      if (autoCloseMissingSl) {
        try {
          await client.closePosition(pos.ticket);
          report.details.push(`Auto-closed position #${pos.ticket} lacking Stop-Loss`);
          insertAuditLog({
            id: `aud_autoclose_${Date.now()}_${pos.ticket}`,
            timestamp: new Date().toISOString(),
            actor: 'Reconciler',
            action: 'AUTO_CLOSE_NO_SL',
            entity: `${pos.symbol} #${pos.ticket}`,
            details: `Auto-closed position #${pos.ticket} to enforce zero naked position risk rule.`,
            status: 'WARNING',
          });
        } catch (closeErr: any) {
          report.details.push(`Failed to auto-close position #${pos.ticket}: ${closeErr.message}`);
        }
      }
    }
  }

  // ----------------------------------------------------
  // CASE 5: Database shows open, but broker closed it
  // ----------------------------------------------------
  const dbOpenPositions = getOpenPositionsDb();

  for (const dbPos of dbOpenPositions) {
    if (!brokerTickets.has(dbPos.ticket)) {
      // Position was closed at broker while system was offline or running
      let closePrice = dbPos.openPrice;
      let closeTime = Math.floor(Date.now() / 1000);
      let pnl = 0;

      // Look up closing deal from deal history if available
      const closingDeal = brokerDeals.find(
        (d) => (d.position_id === dbPos.ticket || d.order === dbPos.ticket) && d.entry === 1
      );

      if (closingDeal) {
        closePrice = closingDeal.price;
        closeTime = closingDeal.time;
        pnl = closingDeal.profit + (closingDeal.swap || 0) + (closingDeal.commission || 0);
      }

      closePositionDb(dbPos.ticket, closePrice, closeTime, pnl);
      report.positionsClosed++;
      report.details.push(`Marked position #${dbPos.ticket} closed at broker price ${closePrice}`);
      insertAuditLog({
        id: `aud_recon_close_${Date.now()}_${dbPos.ticket}`,
        timestamp: new Date().toISOString(),
        actor: 'Reconciler',
        action: 'POSITION_CLOSED_BY_BROKER',
        entity: `${dbPos.symbol} #${dbPos.ticket}`,
        details: `Position #${dbPos.ticket} closed at broker at price ${closePrice} (time: ${closeTime}, PnL: ${pnl})`,
        status: 'SUCCESS',
      });
    }
  }

  return report;
}
