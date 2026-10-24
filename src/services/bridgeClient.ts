import { hashContent } from './crypto';
import {
  getDb,
  logOrderIntent,
  updateOrderStatus,
  getOrderById,
  consumeLiveToken,
  insertAuditLog,
  insertRiskEvent,
  savePositionDb,
} from './db';
import { OrderRecord, OrderStatus, SymbolName } from '../types/forex';

// ==========================================
// 1. TYPES & INTERFACES
// ==========================================

export interface BridgeHealthResponse {
  status: string;
  mt5_package_installed: boolean;
  terminal_running: boolean;
  mt5_initialized: boolean;
  broker_connected: boolean;
  algo_trading_enabled: boolean;
  server_name: string;
  account_type: 'DEMO' | 'REAL' | 'CONTEST';
  is_demo: boolean;
  trade_mode?: number;
  login?: number;
  broker_utc_offset_hours: number;
  allow_trading: boolean;
  kill_engaged: boolean;
  timestamp_utc: string;
}

export interface BridgeAccountResponse {
  login: number;
  server: string;
  account_type: 'DEMO' | 'REAL' | 'CONTEST';
  is_demo: boolean;
  trade_mode?: number;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  leverage: number;
  currency: string;
  utc_offset_hours: number;
  status: string;
}

export interface BridgeSymbol {
  symbol: string;
  symbol_broker: string;
  digits: number;
  point: number;
  contract_size?: number;
  spread: number;
  bid?: number;
  ask?: number;
}

export interface BridgeCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume: number;
  spread: number;
}

export interface BridgeCandlesResponse {
  symbol: string;
  broker_symbol?: string;
  timeframe: string;
  count: number;
  utc_offset_hours: number;
  candles: BridgeCandle[];
  message?: string;
}

export interface BridgePositionResponse {
  ticket: number;
  time: number;
  type: number; // 0 = BUY, 1 = SELL
  magic: number;
  identifier?: number;
  volume: number;
  price_open: number;
  sl: number;
  tp: number;
  price_current: number;
  swap: number;
  profit: number;
  symbol: string;
  comment: string;
}

export interface BridgeOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  sl: number; // Mandatory Stop-Loss required
  tp?: number;
  magic?: number;
  comment?: string;
  price?: number;
}

export interface BridgeOrderResponse {
  status: 'SUCCESS' | 'ERROR';
  message: string;
  ticket?: number;
  fill_price?: number;
  volume?: number;
  symbol?: string;
}

export interface BridgeCloseResponse {
  status: string;
  message: string;
  ticket?: number;
}

export interface BridgeKillResponse {
  success: boolean;
  allFlat: boolean;
  closed: number[];
  unclosed: number[];
  kill_state_engaged: boolean;
  timestamp: string;
}

export interface BridgeDeal {
  ticket: number;
  order: number;
  time: number;
  type: number; // 0 = BUY, 1 = SELL
  entry: number; // 0 = ENTRY_IN, 1 = ENTRY_OUT
  magic: number;
  position_id: number;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  symbol: string;
  comment: string;
}

export interface BridgeCancelPendingResponse {
  status: string;
  message: string;
  ticket: number;
}

export interface BridgeResetKillResponse {
  success: boolean;
  kill_state_engaged: boolean;
  message: string;
}

export type BridgeErrorCode =
  | 'BRIDGE_UNREACHABLE'
  | 'BRIDGE_UNAUTHORIZED'
  | 'BRIDGE_FORBIDDEN'
  | 'BRIDGE_BAD_REQUEST'
  | 'BRIDGE_TIMEOUT'
  | 'BRIDGE_ERROR';

export class BridgeError extends Error {
  public statusCode: number;
  public code: BridgeErrorCode;
  public details?: any;

  constructor(statusCode: number, code: BridgeErrorCode, message: string, details?: any) {
    super(message);
    this.name = 'BridgeError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface BridgeClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  fetchFn?: typeof fetch;
}

// ==========================================
// 2. HTTP CLIENT WITH RETRIES & FAST-FAIL
// ==========================================

export class BridgeClient {
  public baseUrl: string;
  private token: string;
  private timeoutMs: number;
  private maxRetries: number;
  private initialRetryDelayMs: number;
  private fetchFn: typeof fetch;

  constructor(options: BridgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl !== undefined ? options.baseUrl : (process.env.BRIDGE_URL || 'http://127.0.0.1:8001')).replace(/\/+$/, '');
    this.token = (options.token !== undefined ? options.token : (process.env.BRIDGE_TOKEN || '')).trim();
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 100;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: any,
    maxRetriesOverride?: number
  ): Promise<T> {
    if (!this.token) {
      throw new BridgeError(
        401,
        'BRIDGE_UNAUTHORIZED',
        'Bridge token is not configured. Bearer token is mandatory for MT5 bridge communication.'
      );
    }

    const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    let lastError: any = null;
    const maxAttempts = maxRetriesOverride !== undefined ? maxRetriesOverride : this.maxRetries;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      let timeoutId: any = null;

      try {
        timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        };

        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }

        const response = await this.fetchFn(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Immediate Fast-Fail on Auth & Client validation errors (DO NOT RETRY)
        if (response.status === 401) {
          let errDetail = 'Invalid or missing bridge token.';
          try {
            const errJson = await response.json();
            errDetail = errJson.detail || errJson.error || errDetail;
          } catch (_) {}
          throw new BridgeError(401, 'BRIDGE_UNAUTHORIZED', `Bridge authentication rejected: ${errDetail}`);
        }

        if (response.status === 403) {
          let errDetail = 'Operation forbidden by bridge.';
          try {
            const errJson = await response.json();
            errDetail = errJson.detail || errJson.error || errDetail;
          } catch (_) {}
          throw new BridgeError(403, 'BRIDGE_FORBIDDEN', `Bridge access forbidden: ${errDetail}`);
        }

        if (response.status === 400) {
          let errDetail = 'Bad request sent to bridge.';
          try {
            const errJson = await response.json();
            errDetail = errJson.detail || errJson.error || errDetail;
          } catch (_) {}
          throw new BridgeError(400, 'BRIDGE_BAD_REQUEST', `Bridge rejected request parameters: ${errDetail}`);
        }

        if (response.ok) {
          const data = await response.json();
          return data as T;
        }

        // For HTTP 5xx or unhandled status:
        let errBody: any = null;
        try {
          errBody = await response.json();
        } catch (_) {}

        lastError = new BridgeError(
          response.status,
          'BRIDGE_ERROR',
          `Bridge HTTP ${response.status}: ${errBody?.detail || errBody?.error || response.statusText}`,
          errBody
        );
      } catch (err: any) {
        if (timeoutId) clearTimeout(timeoutId);

        // Fast-fail errors must rethrow immediately
        if (err instanceof BridgeError && (err.code === 'BRIDGE_UNAUTHORIZED' || err.code === 'BRIDGE_FORBIDDEN' || err.code === 'BRIDGE_BAD_REQUEST')) {
          throw err;
        }

        if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
          lastError = new BridgeError(
            408,
            'BRIDGE_TIMEOUT',
            `Bridge request to ${endpoint} timed out after ${this.timeoutMs}ms (attempt ${attempt + 1}/${maxAttempts + 1})`
          );
        } else {
          lastError = new BridgeError(
            503,
            'BRIDGE_UNREACHABLE',
            `Failed to communicate with bridge at ${url}: ${err.message || 'Network error'}`,
            err
          );
        }
      }

      // If we have retries remaining, wait with exponential backoff + jitter
      if (attempt < maxAttempts) {
        const backoff = this.initialRetryDelayMs * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 20);
        await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      }
    }

    throw lastError;
  }

  public async getHealth(): Promise<BridgeHealthResponse> {
    return this.request<BridgeHealthResponse>('/health', 'GET');
  }

  public async getAccount(): Promise<BridgeAccountResponse> {
    return this.request<BridgeAccountResponse>('/account', 'GET');
  }

  public async getSymbols(): Promise<BridgeSymbol[]> {
    return this.request<BridgeSymbol[]>('/symbols', 'GET');
  }

  public async getCandles(
    symbol: string = 'EURUSD',
    timeframe: string = 'H1',
    count: number = 500
  ): Promise<BridgeCandlesResponse> {
    const params = new URLSearchParams({ symbol, timeframe, count: String(count) });
    return this.request<BridgeCandlesResponse>(`/candles?${params.toString()}`, 'GET');
  }

  public async getPositions(): Promise<BridgePositionResponse[]> {
    return this.request<BridgePositionResponse[]>('/positions', 'GET');
  }

  public async getDeals(magic?: number, fromDate?: number, toDate?: number): Promise<BridgeDeal[]> {
    const params = new URLSearchParams();
    if (magic !== undefined) params.set('magic', String(magic));
    if (fromDate !== undefined) params.set('from_date', String(fromDate));
    if (toDate !== undefined) params.set('to_date', String(toDate));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<BridgeDeal[]>(`/deals${qs}`, 'GET');
  }

  public async sendOrder(req: BridgeOrderRequest): Promise<BridgeOrderResponse> {
    if (!req.sl || req.sl <= 0) {
      throw new BridgeError(
        400,
        'BRIDGE_BAD_REQUEST',
        'MANDATORY_STOP_LOSS_REQUIRED: Every order dispatched to bridge must specify a positive Stop-Loss price.'
      );
    }
    // sendOrder: exactly one attempt (0 retries). Must never auto-retry on 5xx or disconnects to avoid broker duplicates.
    return this.request<BridgeOrderResponse>('/orders', 'POST', req, 0);
  }

  public async cancelPending(ticket: number): Promise<BridgeCancelPendingResponse> {
    return this.request<BridgeCancelPendingResponse>(`/orders/${ticket}`, 'DELETE');
  }

  public async closePosition(ticket: number): Promise<BridgeCloseResponse> {
    return this.request<BridgeCloseResponse>(`/positions/${ticket}`, 'DELETE');
  }

  public async tripKillSwitch(): Promise<BridgeKillResponse> {
    return this.request<BridgeKillResponse>('/kill', 'POST');
  }

  public async resetKillSwitch(): Promise<BridgeResetKillResponse> {
    return this.request<BridgeResetKillResponse>('/kill/reset', 'POST');
  }
}

// ==========================================
// 3. CLOSED-BAR IDEMPOTENCY KEY
// ==========================================

/**
 * Computes a strictly deterministic SHA-256 idempotency key for closed-bar order execution.
 * Format: SHA256(`${botId}:${symbol}:${timeframe}:${barTimestamp}:${direction}`)
 * Guarantees that any bot running on bar close can NEVER fire more than one order
 * on the exact same bar interval.
 */
export function generateBarIdempotencyKey(
  botId: string,
  symbol: string,
  timeframe: string,
  barTimestamp: number,
  direction: 'BUY' | 'SELL'
): string {
  const payload = `${botId}:${symbol}:${timeframe}:${barTimestamp}:${direction.toUpperCase()}`;
  return hashContent(payload);
}

// ==========================================
// 4. 4-STATE ORDER LIFECYCLE MANAGEMENT
// ==========================================

export interface CreateOrderParams {
  id?: string;
  idempotencyKey: string;
  botId: string;
  magicNumber: number;
  symbol: SymbolName;
  side: 'BUY' | 'SELL';
  volume: number;
  intentPrice: number;
  sl: number;
  tp?: number;
  comment?: string;
}

/**
 * Step 1: Creates an order record in SQLite with status 'PENDING_BROKER'.
 * Enforces mandatory Stop-Loss validation and unique idempotency constraint.
 */
export function createPendingOrder(params: CreateOrderParams): OrderRecord {
  if (!params.sl || params.sl <= 0) {
    insertRiskEvent({
      id: `risk_sl_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Firewall',
      action: 'ORDER_REJECTED_NO_SL',
      entity: `${params.symbol} ${params.side}`,
      details: 'Rejected order intent because mandatory Stop-Loss was missing or non-positive.',
      severity: 'CRITICAL',
      status: 'BLOCKED',
    });
    throw new Error('MANDATORY_STOP_LOSS_REQUIRED: sl must be a positive number');
  }

  const orderId = params.id || `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const orderRecord: OrderRecord = {
    id: orderId,
    idempotencyKey: params.idempotencyKey,
    botId: params.botId,
    magicNumber: params.magicNumber,
    symbol: params.symbol,
    side: params.side,
    volume: params.volume,
    intentPrice: params.intentPrice,
    sl: params.sl,
    tp: params.tp,
    status: 'PENDING_BROKER',
    comment: params.comment || `zfx_${params.magicNumber}`,
    createdAt: new Date().toISOString(),
  };

  try {
    logOrderIntent(orderRecord);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`DUPLICATE_ORDER_INTENT: Order with key ${params.idempotencyKey} already exists.`);
    }
    throw err;
  }

  return orderRecord;
}

/**
 * Step 2: Transitions order status to 'SENT' when dispatched to broker.
 */
export function transitionOrderSent(orderId: string): void {
  updateOrderStatus(orderId, 'SENT');
}

/**
 * Step 3: Transitions order status to 'FILLED' upon broker execution confirmation.
 */
export function transitionOrderFilled(orderId: string, ticket: number, fillPrice: number): OrderRecord {
  updateOrderStatus(orderId, 'FILLED', ticket, fillPrice);
  const updated = getOrderById(orderId);
  if (!updated) throw new Error(`Order ${orderId} not found after fill`);

  insertAuditLog({
    id: `aud_fill_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    actor: 'BridgeClient',
    action: 'ORDER_FILLED',
    entity: `${updated.symbol} #${ticket}`,
    details: `Order filled at ${fillPrice} for ${updated.volume} lots. Ticket: ${ticket}`,
    status: 'SUCCESS',
  });

  return updated;
}

/**
 * Step 4A: Transitions order status to 'REJECTED' when broker denies the order.
 */
export function transitionOrderRejected(orderId: string, reason: string): OrderRecord {
  updateOrderStatus(orderId, 'REJECTED', undefined, undefined, reason);
  const updated = getOrderById(orderId);
  if (!updated) throw new Error(`Order ${orderId} not found after rejection`);

  insertAuditLog({
    id: `aud_rej_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    actor: 'BridgeClient',
    action: 'ORDER_REJECTED',
    entity: `${updated.symbol}`,
    details: `Order rejected by broker or firewall: ${reason}`,
    status: 'WARNING',
  });

  return updated;
}

/**
 * Step 4B: Transitions order status to 'UNKNOWN' when communication is ambiguous or timed out.
 * Flags for startup reconciliation and human oversight.
 */
export function transitionOrderUnknown(orderId: string, reason: string): OrderRecord {
  updateOrderStatus(orderId, 'UNKNOWN', undefined, undefined, reason);
  const updated = getOrderById(orderId);
  if (!updated) throw new Error(`Order ${orderId} not found after unknown transition`);

  insertAuditLog({
    id: `aud_unk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    actor: 'BridgeClient',
    action: 'ORDER_UNKNOWN_STATE',
    entity: `${updated.symbol}`,
    details: `CRITICAL: Order reached UNKNOWN status: ${reason}. Requires reconciliation.`,
    status: 'CRITICAL',
  });

  return updated;
}

export interface ExecutionOptions {
  liveToken?: string;
  accountLogin?: string;
  riskLimits?: any;
  botMode?: 'PAPER' | 'DEMO_LIVE' | 'LIVE';
}

/**
 * Orchestrates full 4-state lifecycle dispatch through MT5 Bridge:
 * PENDING_BROKER -> SENT -> FILLED / REJECTED / UNKNOWN
 */
export async function executeOrderThroughBridge(
  client: BridgeClient,
  order: OrderRecord,
  options: ExecutionOptions = {}
): Promise<{
  success: boolean;
  order: OrderRecord;
  bridgeResponse?: BridgeOrderResponse;
  error?: string;
}> {
  // If in LIVE mode, verify and consume the atomic single-use live gate token
  if (options.botMode === 'LIVE') {
    if (!options.liveToken || !options.accountLogin || !options.riskLimits) {
      const rejected = transitionOrderRejected(order.id, 'MISSING_LIVE_GATE_CREDENTIALS');
      return { success: false, order: rejected, error: 'Live mode requires liveToken, accountLogin, and riskLimits' };
    }

    const riskHash = hashContent(JSON.stringify(options.riskLimits));
    const consumed = consumeLiveToken(options.liveToken, order.botId, options.accountLogin, riskHash);
    if (!consumed) {
      const rejected = transitionOrderRejected(order.id, 'INVALID_OR_EXPIRED_LIVE_TOKEN');
      return { success: false, order: rejected, error: 'Live gate token is invalid, expired, or already used' };
    }
  }

  // 1. Transition to SENT
  transitionOrderSent(order.id);

  // 2. Dispatch to Bridge
  try {
    const bridgeResp = await client.sendOrder({
      symbol: order.symbol,
      side: order.side,
      volume: order.volume,
      sl: order.sl,
      tp: order.tp,
      magic: order.magicNumber,
      comment: order.comment,
      price: order.intentPrice,
    });

    if (!bridgeResp.ticket || bridgeResp.fill_price === undefined) {
      const unknown = transitionOrderUnknown(
        order.id,
        `Bridge response missing authoritative ticket or fill price: ${JSON.stringify(bridgeResp)}`
      );
      return { success: false, order: unknown, error: 'Missing authoritative ticket or fill price from broker' };
    }

    const ticket = bridgeResp.ticket;
    const fillPrice = bridgeResp.fill_price;
    const filledOrder = transitionOrderFilled(order.id, ticket, fillPrice);

    // Record position in SQLite
    savePositionDb({
      ticket,
      botId: order.botId,
      magicNumber: order.magicNumber,
      symbol: order.symbol,
      side: order.side,
      volume: order.volume,
      openPrice: fillPrice,
      currentPrice: fillPrice,
      sl: order.sl,
      tp: order.tp,
      openTime: Math.floor(Date.now() / 1000),
      comment: order.comment,
      status: 'OPEN',
    });

    return {
      success: true,
      order: filledOrder,
      bridgeResponse: bridgeResp,
    };
  } catch (err: any) {
    if (err instanceof BridgeError) {
      // Clear 4xx client errors (400 Bad Request, 403 Forbidden, 401 Unauthorized) map to REJECTED.
      // 408 Timeout is ambiguous and MUST map to UNKNOWN.
      if (
        err.statusCode !== 408 &&
        ((err.statusCode >= 400 && err.statusCode < 500) ||
          err.code === 'BRIDGE_BAD_REQUEST' ||
          err.code === 'BRIDGE_FORBIDDEN' ||
          err.code === 'BRIDGE_UNAUTHORIZED')
      ) {
        const rejected = transitionOrderRejected(order.id, err.message);
        return { success: false, order: rejected, error: err.message };
      }

      // 5xx errors, timeouts (408), and network disconnects (503) must leave order UNKNOWN
      const unknown = transitionOrderUnknown(order.id, err.message);
      return { success: false, order: unknown, error: err.message };
    }

    // Default network or system failure: transition to UNKNOWN to be resolved by reconciliation
    const reason = err?.message || 'Unknown bridge dispatch failure';
    const finalOrder = transitionOrderUnknown(order.id, reason);
    return { success: false, order: finalOrder, error: reason };
  }
}
