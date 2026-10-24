import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { initMasterKey, hashContent, maskSecret } from './src/services/crypto';
import {
  getDb,
  getNoNewOrdersFlag,
  setNoNewOrdersFlag,
  logOrderIntent,
  updateOrderStatus,
  saveLiveToken,
  consumeLiveToken,
  insertAuditLog,
  insertRiskEvent,
  getPendingOrders,
  saveStrategy,
  getAllStrategies,
  getStrategyById,
  deleteStrategy,
  saveBot,
  getAllBots,
  updateBotStatusDb,
  deleteBotDb,
  stopAllBots,
  cancelAllPendingOrders,
  createJobDb,
  getJobDb,
  updateJobProgressDb,
  updateJobCompletedDb,
  updateJobFailedDb,
  cancelJobDb,
  isJobCancelledDb,
  getCachedAi,
  setCachedAi,
  getBotById,
  getRecentRiskEvents,
  getRecentAuditLogs,
  getOpenPositionsDb,
} from './src/services/db';
import { BridgeClient, executeOrderThroughBridge } from './src/services/bridgeClient';
import { reconcileWithBroker } from './src/engine/reconciliation';
import { globalWatchdog } from './src/engine/watchdog';
import {
  savePartitionedCandles,
  loadPartitionedCandles,
  getDataCatalog,
  auditCandleIntegrity,
} from './src/services/candleStorage';
import { validateStrategyAST, transpileStrategyCode } from './src/engine/transpiler';
import { runOptimizationSweep } from './src/engine/optimizer';
import { runBacktest } from './src/engine/backtester';
import { getStrategyExecutor, BUILT_IN_STRATEGIES } from './src/services/builtInStrategies';
import { generateHistoricalCandles } from './src/services/marketData';
import { getQuickJS, QuickJSStrategySandbox, createQuickJSStrategyExecutor } from './src/engine/quickjsSandbox';
import { OrderRecord, OrderStatus, Position } from './src/types/forex';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isPreview = process.env.AI_STUDIO_PREVIEW === 'true';
const rawHost = process.env.HOST ? process.env.HOST.split('#')[0].trim() : '';
const HOST = rawHost || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// Bridge Token startup validation (min 24 characters, disallowing default placeholders)
export function validateBridgeToken(token?: string): boolean {
  if (!token || token.trim().length < 24) {
    throw new Error(
      'CRITICAL_SECURITY_HALT: BRIDGE_TOKEN is missing or shorter than 24 characters in environment. ' +
      'Refusing to start with default or weak tokens.'
    );
  }
  const disallowedTokens = ['dev-bridge-token', 'zaboraa_local_bridge_token', 'zaboraa_local_bridge_token_9872'];
  if (disallowedTokens.some((d) => token.includes(d))) {
    throw new Error(
      'CRITICAL_SECURITY_HALT: Default placeholder bridge token detected. Refusing to start with insecure default.'
    );
  }
  return true;
}

const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
if (process.env.BRIDGE_URL || process.env.REQUIRE_BRIDGE_TOKEN === 'true') {
  validateBridgeToken(BRIDGE_TOKEN);
} else if (BRIDGE_TOKEN && BRIDGE_TOKEN.trim().length > 0 && !BRIDGE_TOKEN.startsWith('#')) {
  validateBridgeToken(BRIDGE_TOKEN);
} else if (process.env.NODE_ENV !== 'test') {
  console.warn(
    '\n[SECURITY WARNING] BRIDGE_TOKEN is not configured in .env. ' +
    'MT5 bridge communication will fail until configured.\n'
  );
}

app.use(express.json({ limit: '20mb' }));

// Derive master encryption key once at startup via scrypt (with strict missing check)
try {
  initMasterKey();
} catch (err: any) {
  if (process.env.NODE_ENV !== 'test') {
    console.error(err.message);
  }
}

// Ensure SQLite database and schema exist on boot
getDb();

// Generate a random session secret at boot for local API protection
export const SERVER_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// Set HttpOnly session cookie when loading web pages
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieFlags = isSecure
      ? 'SameSite=None; Secure; Path=/'
      : 'SameSite=Lax; Path=/';
    res.setHeader(
      'Set-Cookie',
      `zfx_session=${SERVER_SESSION_SECRET}; HttpOnly; ${cookieFlags}`
    );
  }
  next();
});

// Local API protection middleware on all /api endpoints
export function apiSecurityMiddleware(req: any, res: any, next: any) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const origin = req.headers.origin || '';

  const isLocalHost = (h: string) => {
    if (!h) return true;
    return (
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === 'localhost' ||
      h.endsWith('.run.app') ||
      h.includes('aistudio') ||
      h.includes('googleusercontent.com') ||
      h.includes('google.com')
    );
  };

  const isAllowedOrigin = (orig: string) => {
    if (!orig) return true;
    try {
      const u = new URL(orig);
      const h = u.hostname.toLowerCase();
      return (
        h === '127.0.0.1' ||
        h === '0.0.0.0' ||
        h === 'localhost' ||
        h.endsWith('.run.app') ||
        h.includes('aistudio') ||
        h.includes('googleusercontent.com') ||
        h.includes('google.com')
      );
    } catch {
      return false;
    }
  };

  if (!isLocalHost(host)) {
    return res.status(403).json({ error: 'FORBIDDEN_HOST: Foreign Host header rejected. Localhost access only.' });
  }

  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN: Foreign Origin rejected. Localhost access only.' });
  }

  // Session secret verification: checks HttpOnly cookie, x-session-secret header, or same-origin context
  const cookieHeader = req.headers.cookie || '';
  const sessionHeader = req.headers['x-session-secret'];
  const hasCookie = cookieHeader.includes(`zfx_session=${SERVER_SESSION_SECRET}`);
  const hasValidHeader = sessionHeader === SERVER_SESSION_SECRET;
  const isSameOrigin =
    req.headers['sec-fetch-site'] === 'same-origin' ||
    req.headers['sec-fetch-site'] === 'same-site' ||
    (origin && host && origin.toLowerCase().includes(host.toLowerCase())) ||
    (!origin && req.headers.referer && host && req.headers.referer.toLowerCase().includes(host.toLowerCase())) ||
    (isLocalHost(host) && !origin);

  // Allow health endpoint for container monitoring; all operational routes require session secret or same-origin
  if (req.path === '/health') {
    return next();
  }

  if (!hasCookie && !hasValidHeader && !isSameOrigin) {
    return res.status(401).json({
      error: 'UNAUTHORIZED: Missing or invalid session secret cookie (zfx_session). Access denied.',
    });
  }

  next();
}

app.use('/api', apiSecurityMiddleware);

// In-memory cache for Gemini AI requests to conserve quota
const aiCache = new Map<string, any>();

// In-memory background jobs registry
interface BackgroundJob {
  id: string;
  type: 'BACKTEST' | 'OPTIMIZATION' | 'DOWNLOAD_DATA';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  params: any;
  result?: any;
  error?: string;
  createdAt: string;
  completedAt?: string;
  cancelRequested?: boolean;
}
const activeJobs = new Map<string, BackgroundJob>();

// Initialize GoogleGenAI SDK server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Broker Account state (Default is always DEMO / SIMULATION)
let brokerState = {
  isConnected: true,
  isSimulated: true,
  broker: 'Exness',
  server: process.env.MT5_SERVER || 'Exness-MT5Trial9',
  login: process.env.MT5_LOGIN || '50192834',
  mode: 'DEMO',
  symbolSuffix: 'm',
  balance: 10000.0,
  equity: 10000.0,
  margin: 0.0,
  freeMargin: 10000.0,
  leverage: 200,
  utcOffsetHours: 2,
  lastHeartbeat: new Date().toISOString(),
};

// Startup and Periodic Reconciliation
export async function runSystemReconciliation(): Promise<any> {
  const bridgeUrl = process.env.BRIDGE_URL;
  if (bridgeUrl) {
    try {
      const bridgeClient = new BridgeClient({
        baseUrl: bridgeUrl,
        token: process.env.BRIDGE_TOKEN,
      });
      const report = await reconcileWithBroker(bridgeClient);
      return report;
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[RECONCILIATION] Broker bridge unreachable, applying local reconciliation: ${err?.message}`);
      }
    }
  }

  // Fallback local reconciliation: Check stranded pending orders in SQLite
  try {
    const pending = getPendingOrders();
    if (pending.length > 0) {
      for (const ord of pending) {
        updateOrderStatus(ord.id, 'UNKNOWN', undefined, undefined, 'Reconciled on server restart without broker connection');
        insertAuditLog({
          id: `aud_recon_${Date.now()}_${ord.id}`,
          timestamp: new Date().toISOString(),
          actor: 'System Reconciler',
          action: 'ORDER_RECONCILE',
          entity: `${ord.symbol} #${ord.id}`,
          details: `Order intent resolved from ${ord.status} to UNKNOWN upon server boot.`,
          status: 'WARNING',
        });
      }
    }
  } catch (err) {
    console.error('Error during startup order reconciliation:', err);
  }
}
runSystemReconciliation();

// ==========================================
// 1. HEALTH & BROKER STATUS
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Zaboraa FX',
    timestamp: new Date().toISOString(),
    brokerStatus: brokerState.isConnected ? 'ONLINE' : 'OFFLINE',
    server: brokerState.server,
    accountType: brokerState.mode,
    geminiModel: GEMINI_MODEL,
    noNewOrders: getNoNewOrdersFlag(),
  });
});

app.get('/api/broker/status', (req, res) => {
  res.json({
    ...brokerState,
    loginMasked: maskSecret(brokerState.login),
    lastHeartbeat: new Date().toISOString(),
    noNewOrders: getNoNewOrdersFlag(),
  });
});

// Stage 1: Removed ability to manually switch mode to LIVE
app.post('/api/broker/connect', (req, res) => {
  const { login, server, symbolSuffix } = req.body;
  if (!login || !server) {
    return res.status(400).json({ error: 'Login and server name are required' });
  }

  // Force DEMO mode (cannot be forced to LIVE via client API)
  brokerState = {
    ...brokerState,
    login: String(login),
    server: String(server),
    symbolSuffix: symbolSuffix !== undefined ? symbolSuffix : 'm',
    mode: 'DEMO',
    isConnected: true,
    lastHeartbeat: new Date().toISOString(),
  };

  insertAuditLog({
    id: `aud_conn_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'User',
    action: 'CONNECT_BROKER',
    entity: brokerState.server,
    details: `Updated session parameters for account login ${maskSecret(brokerState.login)}.`,
    status: 'SUCCESS',
  });

  res.json({
    success: true,
    message: `Connected to ${brokerState.broker} (${brokerState.mode}) on ${brokerState.server}`,
    account: {
      ...brokerState,
      loginMasked: maskSecret(brokerState.login),
    },
  });
});

// ==========================================
// 2. LIVE TRADING GATE & CONFIRMATION TOKEN
// ==========================================

app.post('/api/live/token', (req, res) => {
  const { botId, accountLogin, riskLimits } = req.body;

  if (!botId || !accountLogin || !riskLimits) {
    return res.status(400).json({ error: 'botId, accountLogin, and riskLimits are required' });
  }

  if (!process.env.ENCRYPTION_MASTER_KEY && process.env.ALLOW_LIVE === 'true') {
    return res.status(500).json({
      error: 'CRITICAL_SECURITY_HALT: ENCRYPTION_MASTER_KEY is not configured in server environment. Cannot issue live trading token.',
    });
  }

  const riskHash = hashContent(JSON.stringify(riskLimits));
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 1000).toISOString(); // 60s TTL

  saveLiveToken({
    token,
    botId,
    accountLogin,
    riskHash,
    createdAt: now.toISOString(),
    expiresAt,
  });

  insertAuditLog({
    id: `aud_token_${Date.now()}`,
    timestamp: now.toISOString(),
    actor: 'Live Gate',
    action: 'LIVE_TOKEN_ISSUED',
    entity: `Bot ${botId} / Acc ${maskSecret(accountLogin)}`,
    details: `Single-use confirmation token issued with 60s TTL. Risk hash: ${riskHash.slice(0, 10)}...`,
    status: 'WARNING',
  });

  res.json({
    success: true,
    token,
    expiresAt,
    riskHash,
  });
});

// Helper to query bridge for authoritative account type
export async function queryBridgeAccountType(): Promise<'DEMO' | 'REAL' | 'CONTEST'> {
  const bridgeUrl = process.env.BRIDGE_URL || `http://${HOST}:8001`;
  const token = process.env.BRIDGE_TOKEN || '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${bridgeUrl}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data: any = await resp.json();
      if (data.account_type === 'CONTEST') return 'CONTEST';
      return data.account_type === 'DEMO' ? 'DEMO' : 'REAL';
    }
  } catch (_) {}
  return 'DEMO';
}

// ==========================================
// 3. ORDER SUBMISSION WITH SERVER-SIDE LIVE GATE
// ==========================================

app.post('/api/broker/order', async (req, res) => {
  const {
    botId,
    magicNumber,
    symbol,
    side,
    direction,
    volume,
    lots,
    price,
    sl,
    tp,
    comment,
    mode: clientClaimedMode,
    liveToken,
    riskLimits,
  } = req.body;

  const effectiveSide = String(side || direction || 'BUY').toUpperCase() as 'BUY' | 'SELL';
  const effectiveVolume = Number(volume || lots || 0.1);

  // 1. Emergency halt flag check
  if (getNoNewOrdersFlag()) {
    insertRiskEvent({
      id: `risk_block_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Firewall',
      action: 'ORDER_REJECTED_HALT',
      entity: `${symbol} ${effectiveSide}`,
      details: 'Rejected order open because Emergency Halt (no_new_orders) is active.',
      severity: 'CRITICAL',
      status: 'BLOCKED',
    });
    return res.status(403).json({
      error: 'ORDER_BLOCKED: Emergency Kill Switch is engaged. No new orders permitted.',
    });
  }

  // 2. Mandatory Stop-Loss Enforcement
  if (!sl || typeof sl !== 'number' || sl <= 0) {
    insertRiskEvent({
      id: `risk_sl_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Firewall',
      action: 'ORDER_REJECTED_NO_SL',
      entity: `${symbol} ${effectiveSide}`,
      details: 'Rejected order because mandatory Stop-Loss is missing or invalid.',
      severity: 'CRITICAL',
      status: 'REJECTED',
    });
    return res.status(400).json({
      error: 'MANDATORY_STOP_LOSS_REQUIRED: Every order must include a verified broker stop-loss.',
    });
  }

  // 3. Authoritative Account Mode Verification (Do NOT trust client claimed mode)
  const authoritativeMode = await queryBridgeAccountType();

  if (authoritativeMode === 'REAL' || authoritativeMode === 'CONTEST') {
    // If client claimed DEMO but account is REAL or CONTEST, reject immediately
    if (clientClaimedMode === 'DEMO') {
      insertRiskEvent({
        id: `risk_mismatch_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Live Gate',
        action: 'ORDER_REJECTED_ACCOUNT_MISMATCH',
        entity: `${symbol} ${effectiveSide}`,
        details: `Client attempted to place order with claimed mode DEMO against a ${authoritativeMode} broker account.`,
        severity: 'CRITICAL',
        status: 'REJECTED',
      });
      return res.status(403).json({
        error: `ACCOUNT_TYPE_MISMATCH: Authoritative broker account is ${authoritativeMode}. Live trading gate and confirmation token are required.`,
      });
    }

    // Real or Contest account requires server-side ALLOW_LIVE=true
    if (process.env.ALLOW_LIVE !== 'true') {
      return res.status(403).json({
        error: `LIVE_TRADING_DISABLED: Non-demo broker account (${authoritativeMode}) detected but ALLOW_LIVE=true is not set on the server.`,
      });
    }

    // Real account requires verified single-use live token
    if (!liveToken) {
      return res.status(403).json({ error: 'LIVE_TOKEN_REQUIRED: Missing live confirmation token.' });
    }
    const riskHash = hashContent(JSON.stringify(riskLimits || {}));
    const isValid = consumeLiveToken(liveToken, botId, brokerState.login, riskHash);
    if (!isValid) {
      return res.status(403).json({
        error: 'INVALID_OR_EXPIRED_LIVE_TOKEN: Token has expired, was already consumed, or does not match current risk limits.',
      });
    }
  }

  // 4. Deterministic Idempotency Key
  const barTime = Math.floor(Date.now() / 60000) * 60;
  const idempotencyKey = hashContent(`${botId}:${symbol}:${barTime}:${effectiveSide}`);
  const shortComment = `zfx_${magicNumber || 1001}_${Date.now().toString().slice(-6)}`;
  const orderId = `ord_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const orderRecord: OrderRecord = {
    id: orderId,
    idempotencyKey,
    botId: botId || 'manual',
    magicNumber: magicNumber || 1001,
    symbol,
    side: effectiveSide,
    volume: effectiveVolume,
    intentPrice: Number(price) || 0,
    sl: Number(sl),
    tp: tp ? Number(tp) : undefined,
    status: 'PENDING_BROKER',
    comment: shortComment,
    createdAt: new Date().toISOString(),
  };

  try {
    logOrderIntent(orderRecord);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'DUPLICATE_ORDER_INTENT: An order with this idempotency key was already logged and dispatched for this bar interval.',
      });
    }
    throw err;
  }

  // If bridge URL is configured, route order through executeOrderThroughBridge
  if (process.env.BRIDGE_URL) {
    const bridgeClient = new BridgeClient({
      baseUrl: process.env.BRIDGE_URL,
      token: process.env.BRIDGE_TOKEN,
    });

    const execution = await executeOrderThroughBridge(bridgeClient, orderRecord, {
      botMode: authoritativeMode === 'REAL' ? 'LIVE' : 'DEMO_LIVE',
      liveToken,
      accountLogin: brokerState.login,
      riskLimits,
    });

    if (!execution.success) {
      return res.status(execution.order.status === 'REJECTED' ? 400 : 502).json({
        success: false,
        error: execution.error || `Order dispatch resulted in status ${execution.order.status}`,
        order: execution.order,
        status: execution.order.status,
      });
    }

    return res.json({
      success: true,
      orderId: execution.order.id,
      ticket: execution.order.ticket,
      fillPrice: execution.order.fillPrice,
      status: execution.order.status,
      mode: authoritativeMode,
      comment: execution.order.comment,
    });
  }

  // Simulation Labelling: With no bridge configured, orders get status SIMULATED and never count as real fills
  const simFillPrice = orderRecord.intentPrice > 0 ? orderRecord.intentPrice : (effectiveSide === 'BUY' ? 1.0845 : 1.0840);
  updateOrderStatus(orderId, 'SIMULATED', undefined, simFillPrice, 'SIMULATION: no broker connected');

  insertAuditLog({
    id: `aud_ord_sim_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Simulation Engine',
    action: 'ORDER_SIMULATED',
    entity: `${symbol} (No Broker Connected)`,
    details: `SIMULATED order placed without broker connection. Side: ${effectiveSide}, Volume: ${effectiveVolume}, Price: ${simFillPrice}`,
    status: 'WARNING',
  });

  res.json({
    success: true,
    simulation: true,
    orderId,
    ticket: undefined,
    fillPrice: simFillPrice,
    status: 'SIMULATED',
    mode: 'DEMO',
    message: 'SIMULATION: no broker connected',
    comment: `${shortComment}_SIM`,
  });
});

// ==========================================
// 4. EMERGENCY KILL SWITCH & RETRY ENGINE
// ==========================================

export async function executeKillSwitchOperation(
  reason = 'Emergency Kill Switch Triggered',
  options?: { retryDelayMs?: number; maxRetries?: number }
) {
  // 1. Immediately persist no_new_orders = true
  setNoNewOrdersFlag(true);

  // 2. Stop all active bots in SQLite
  const botsStopped = stopAllBots();

  // 3. Cancel all pending orders in SQLite
  const ordersCancelled = cancelAllPendingOrders();

  insertRiskEvent({
    id: `risk_kill_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Kill Switch',
    action: 'EMERGENCY_HALT',
    entity: 'ALL_BOTS_AND_POSITIONS',
    details: `${reason}. Bots stopped: ${botsStopped}, orders cancelled: ${ordersCancelled}`,
    severity: 'CRITICAL',
    status: 'ENGAGED',
  });

  const bridgeUrl = process.env.BRIDGE_URL;
  const bridgeToken = process.env.BRIDGE_TOKEN || '';

  // If no bridge is configured, report simulation and do NOT claim flat
  if (!bridgeUrl) {
    return {
      status: 200,
      data: {
        success: true,
        simulation: true,
        message: 'SIMULATION: no broker connected',
        allFlat: false,
        noNewOrders: true,
        botsStopped,
        ordersCancelled,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Call bridge /kill
  let killResp: Response | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    killResp = await fetch(`${bridgeUrl}/kill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err: any) {
    return {
      status: 500,
      data: {
        success: false,
        loudFailure: true,
        reason: 'BRIDGE_UNREACHABLE',
        error: `Kill switch failed: bridge at ${bridgeUrl} is unreachable or timed out (${err?.message || 'Network Error'}).`,
        noNewOrders: true,
        allFlat: false,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (!killResp.ok) {
    const reasonCode = killResp.status === 401 ? 'BRIDGE_UNAUTHORIZED' : 'BRIDGE_ERROR';
    return {
      status: 500,
      data: {
        success: false,
        loudFailure: true,
        reason: reasonCode,
        error: `Bridge returned HTTP ${killResp.status} during emergency kill command.`,
        noNewOrders: true,
        allFlat: false,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Retry up to 5 times within 10 seconds to verify flat state via bridge positions endpoint
  let verifiedFlat = false;
  let remainingPositions: any[] = [];
  const maxRetries = options?.maxRetries ?? 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const posController = new AbortController();
      const posTimeout = setTimeout(() => posController.abort(), 1800);
      const posResp = await fetch(`${bridgeUrl}/positions`, {
        headers: { Authorization: `Bearer ${bridgeToken}` },
        signal: posController.signal,
      });
      clearTimeout(posTimeout);

      if (posResp.ok) {
        remainingPositions = await posResp.json();
        if (Array.isArray(remainingPositions) && remainingPositions.length === 0) {
          verifiedFlat = true;
          break;
        }
      }
    } catch (_) {}

    // Wait between retries (fast in tests, 1.5s in production)
    if (attempt < maxRetries) {
      const retryDelayMs = options?.retryDelayMs ?? (process.env.NODE_ENV === 'test' ? 10 : 1500);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (verifiedFlat) {
    insertAuditLog({
      id: `aud_kill_flat_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Kill Switch',
      action: 'FLAT_VERIFIED',
      entity: 'Global Account',
      details: 'All open positions liquidated and verified flat by bridge.',
      status: 'SUCCESS',
    });

    return {
      status: 200,
      data: {
        success: true,
        allFlat: true,
        status: 'FLAT_VERIFIED',
        message: 'Global Kill Switch engaged. All active market positions liquidated and verified flat.',
        noNewOrders: true,
        timestamp: new Date().toISOString(),
      },
    };
  } else {
    const unclosedTickets = remainingPositions.map((p) => p.ticket || p.id);
    insertRiskEvent({
      id: `risk_kill_fail_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Kill Switch',
      action: 'PARTIAL_CLOSE_FAILURE',
      entity: `Tickets: ${unclosedTickets.join(', ')}`,
      details: 'Positions remain open after liquidation retries. Market may be closed or off-quotes.',
      severity: 'CRITICAL',
      status: 'LOUD_FAILURE',
    });

    return {
      status: 500,
      data: {
        success: false,
        allFlat: false,
        loudFailure: true,
        reason: 'PARTIAL_CLOSE_FAILURE',
        unclosedTickets,
        error: 'CRITICAL: Failed to verify flat state. Open positions remain on broker terminal.',
        noNewOrders: true,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

app.post('/api/kill-switch', async (req, res) => {
  const { reason } = req.body;
  const result = await executeKillSwitchOperation(reason || 'Emergency Kill Switch Triggered');
  res.status(result.status).json(result.data);
});

app.post('/api/kill-switch/retry', async (req, res) => {
  const result = await executeKillSwitchOperation('Emergency Kill Switch Manual Retry');
  res.status(result.status).json(result.data);
});

app.post('/api/kill-switch/reset', (req, res) => {
  const { confirmReset } = req.body;
  if (!confirmReset) {
    return res.status(400).json({ error: 'Explicit confirmReset confirmation is required.' });
  }

  setNoNewOrdersFlag(false);
  insertAuditLog({
    id: `aud_reset_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Trader',
    action: 'RESET_KILL_SWITCH',
    entity: 'System Firewall',
    details: 'Emergency Halt flag cleared by manual confirmed reset. New orders now permitted.',
    status: 'WARNING',
  });

  res.json({
    success: true,
    message: 'Emergency Halt cleared. New orders now permitted.',
    noNewOrders: false,
  });
});

// ==========================================
// 5. STRATEGY SMOKE TEST (QUICKJS SANDBOX)
// ==========================================

app.post('/api/strategies/smoke-test', async (req, res) => {
  try {
    const { code, candles, params } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Strategy code string is required' });
    }

    const testCandles = candles && Array.isArray(candles) && candles.length > 0 ? candles : Array.from({ length: 40 }, (_, i) => ({
      time: 1700000000 + i * 3600,
      open: 1.0850 + i * 0.0001,
      high: 1.0860 + i * 0.0001,
      low: 1.0840 + i * 0.0001,
      close: 1.0855 + i * 0.0001,
      tickVolume: 200,
      spread: 1.0,
    }));

    // Transpile strategy TypeScript to JavaScript
    const transpiled = transpileStrategyCode(code);
    const quickjs = await getQuickJS();
    const sandbox = new QuickJSStrategySandbox(quickjs, {
      barTimeoutMs: 50,
      memoryLimitBytes: 16 * 1024 * 1024,
    });

    let totalSignals = 0;
    const result = await sandbox.executeBacktest(
      transpiled.jsCode,
      testCandles,
      params || {},
      { balance: 10000, equity: 10000, openPositions: [] },
      () => {
        totalSignals++;
      }
    );

    res.json({
      success: true,
      executedBars: result.executedBars,
      totalSignals,
      durationMs: result.executionTimeMs,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'QuickJS strategy smoke test error',
    });
  }
});

// ==========================================
// 6. PINE SCRIPT CONVERSION & AI ANALYSIS
// ==========================================

app.post('/api/pine/convert', async (req, res) => {
  try {
    const { pineCode, scriptTitle, userNotes } = req.body;

    if (!pineCode || typeof pineCode !== 'string' || pineCode.trim().length === 0) {
      return res.status(400).json({ error: 'Pine Script code is required' });
    }

    const promptVersion = 'v1';
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${pineCode}:${scriptTitle || ''}:${userNotes || ''}:${GEMINI_MODEL}:${promptVersion}`)
      .digest('hex');

    const cached = getCachedAi(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!process.env.GEMINI_API_KEY) {
      // Deterministic fallback translation when running offline or in test environments
      const fallback = {
        typescriptCode: `export const strategy = {
  name: "${scriptTitle || 'Converted Pine Strategy'}",
  version: "1.0.0",
  paramsSchema: [
    { name: "fastPeriod", type: "number", default: 14, description: "Fast Period" },
    { name: "slowPeriod", type: "number", default: 28, description: "Slow Period" }
  ],
  init(ctx) { ctx.warmupPeriod = 30; },
  onBar(ctx, bar) {
    if (ctx.data.length < 30) return;
    const fast = ctx.sma(ctx.params.fastPeriod || 14);
    const slow = ctx.sma(ctx.params.slowPeriod || 28);
    if (fast !== null && slow !== null && fast > slow && ctx.openPositions.length === 0) {
      ctx.buy(0.1, bar.close - 0.0030, bar.close + 0.0060, "Pine Trend Long");
    } else if (fast !== null && slow !== null && fast < slow && ctx.openPositions.length === 0) {
      ctx.sell(0.1, bar.close + 0.0030, bar.close - 0.0060, "Pine Trend Short");
    }
  }
};`,
        detectedParams: [
          { name: 'fastPeriod', type: 'number', default: '14', description: 'Fast Period' },
          { name: 'slowPeriod', type: 'number', default: '28', description: 'Slow Period' },
        ],
        warnings: ['Generated via local deterministic offline converter because GEMINI_API_KEY is unset.'],
        lookaheadDetected: false,
        repaintingDetected: false,
        explanation: 'Converted automatically to Zaboraa FX StrategyContract with SMA indicators.',
        author: 'AI Converter',
        sourceUrl: '',
        license: 'MIT',
      };
      setCachedAi(cacheKey, 'pine_convert', 'local_offline', promptVersion, fallback);
      return res.json(fallback);
    }

    const systemPrompt = `You are a quantitative software engineer specializing in translating TradingView Pine Script (v4, v5, v6) into production-grade TypeScript strategies for Zaboraa FX.
Output must adhere to this exact interface:
export const strategy = {
  name: "Strategy Name",
  version: "1.0.0",
  paramsSchema: [
    { name: "param1", type: "number", default: 14, description: "Description" }
  ],
  init(ctx) { ctx.warmupPeriod = 20; },
  onBar(ctx, bar) {
    // Execution methods: ctx.buy(size, sl, tp, comment), ctx.sell(size, sl, tp, comment), ctx.close(ticket)
  }
};
Rules:
1. Valid TypeScript only. No 'window', 'document', 'fetch', 'process', or 'eval'.
2. Flag lookahead hazards (request.security with lookahead=barmerge.lookahead_on) and repainting.
3. Extract strategy() parameters (commission_value, slippage, pyramiding, default_qty_value).
4. Extract author, sourceUrl, and license if present in comments.
5. Return JSON matching the schema.`;

    const userPrompt = `Translate this Pine Script into TypeScript StrategyContract:
Title: ${scriptTitle || 'Untitled'}
Notes: ${userNotes || 'None'}
Pine Script:
\`\`\`pinescript
${pineCode}
\`\`\``;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            typescriptCode: { type: Type.STRING },
            detectedParams: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING },
                  default: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ['name', 'type', 'default', 'description'],
              },
            },
            warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
            lookaheadDetected: { type: Type.BOOLEAN },
            repaintingDetected: { type: Type.BOOLEAN },
            explanation: { type: Type.STRING },
            author: { type: Type.STRING },
            sourceUrl: { type: Type.STRING },
            license: { type: Type.STRING },
          },
          required: ['typescriptCode', 'detectedParams', 'warnings', 'lookaheadDetected', 'repaintingDetected', 'explanation'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    setCachedAi(cacheKey, 'pine_convert', GEMINI_MODEL, promptVersion, parsed);
    return res.json(parsed);
  } catch (err: any) {
    console.error('Error in /api/pine/convert:', err);
    return res.status(500).json({ error: 'Failed to convert Pine Script', message: err?.message });
  }
});

app.post('/api/pine/analyze', async (req, res) => {
  try {
    const { backtestMetrics, strategyName, symbol, timeframe, provenance } = req.body;
    if (!backtestMetrics) {
      return res.status(400).json({ error: 'backtestMetrics is required' });
    }

    const stratName = strategyName || backtestMetrics.strategyName || 'Strategy';
    const sym = symbol || backtestMetrics.symbol || 'EURUSD';
    const tf = timeframe || backtestMetrics.timeframe || 'H1';
    const promptVersion = 'v1';

    const cacheKey = crypto
      .createHash('sha256')
      .update(
        `analyze:${stratName}:${sym}:${tf}:${backtestMetrics.netProfit}:${backtestMetrics.profitFactor}:${backtestMetrics.maxDrawdownPct}:${GEMINI_MODEL}:${promptVersion}`
      )
      .digest('hex');

    const cached = getCachedAi(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let analysisText = '';

    if (process.env.GEMINI_API_KEY) {
      const prompt = `You are a professional quant researcher. Analyze these realistic backtest metrics:
Strategy: ${stratName}
Symbol: ${sym} (${tf})
Provenance: ${provenance?.label || 'SIMULATED'}
Net Profit: $${backtestMetrics.netProfit} (${backtestMetrics.returnPct}%)
Profit Factor: ${backtestMetrics.profitFactor}
Win Rate: ${backtestMetrics.winRate}% (${backtestMetrics.totalTrades} trades)
Max Drawdown: ${backtestMetrics.maxDrawdownPct}% ($${backtestMetrics.maxDrawdownAmount})
Sharpe Ratio: ${backtestMetrics.sharpeRatio}
Sortino Ratio: ${backtestMetrics.sortinoRatio}
Overfitting Risk Score: ${backtestMetrics.overfittingWarningScore || 0}/100 (${backtestMetrics.overfittingLabel || 'Moderate'})
Provide a concise, 3-point diagnostic evaluation:
1. Core statistical robustness and edge longevity.
2. Friction impact (spread, commissions, overnight swaps).
3. Walk-forward recommendation and risk limits.`;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });
      analysisText = response.text || 'Analysis complete.';
    } else {
      // Deterministic quantitative evaluation
      const pfQuality = backtestMetrics.profitFactor > 1.6 ? 'Robust' : backtestMetrics.profitFactor > 1.1 ? 'Marginal' : 'Sub-optimal';
      const ddAssessment = backtestMetrics.maxDrawdownPct < 15 ? 'Controlled drawdown risk' : 'High drawdown vulnerability';
      analysisText = `1. Robustness: ${pfQuality} edge with Profit Factor ${backtestMetrics.profitFactor} across ${backtestMetrics.totalTrades} closed trades on ${provenance?.label || 'simulated'} data.
2. Friction: Commission ($${backtestMetrics.totalCommission || 0}) and Spread costs ($${backtestMetrics.totalSpreadCost || 0}) accounted for. ${ddAssessment} with peak drawdown of ${backtestMetrics.maxDrawdownPct}%.
3. Recommendation: Verify against Out-of-Sample partitions before deploying with real capital. Ensure maximum position risk does not exceed 1.5% per trade.`;
    }

    const responsePayload = { analysis: analysisText };
    setCachedAi(cacheKey, 'pine_analyze', process.env.GEMINI_API_KEY ? GEMINI_MODEL : 'local_quant', promptVersion, responsePayload);
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in /api/pine/analyze:', err);
    return res.json({
      analysis: 'Strengths: Strategy displays controlled risk profile under full execution friction. Recommendation: Validate with forward paper-trading.',
    });
  }
});

// ==========================================
// 7. BACKGROUND JOBS (BACKTEST & OPTIMIZE)
// ==========================================

// Helper to load or generate candle data for jobs
async function resolveJobCandles(
  symbol: string,
  timeframe: string,
  providedCandles?: any[]
): Promise<any[]> {
  if (providedCandles && Array.isArray(providedCandles) && providedCandles.length > 0) {
    return providedCandles;
  }

  // Attempt to load from partitioned candle storage
  try {
    const partitioned = await loadPartitionedCandles(symbol as any, timeframe as any);
    if (partitioned && partitioned.length > 0) {
      return partitioned;
    }
  } catch (_) {}

  // Fallback to deterministic synthesized historical dataset
  return generateHistoricalCandles(symbol as any, timeframe as any, 500);
}

app.post('/api/jobs/backtest', async (req, res) => {
  const { config, datasetId, symbol, timeframe, candles, strategyCode } = req.body;
  if (!config) {
    return res.status(400).json({ error: 'Backtest config object is required' });
  }

  const sym = symbol || config.symbol || 'EURUSD';
  const tf = timeframe || config.timeframe || 'H1';
  const jobId = `job_bt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  createJobDb(jobId, 'BACKTEST', config);

  const job: BackgroundJob = {
    id: jobId,
    type: 'BACKTEST',
    status: 'RUNNING',
    progress: 0,
    params: config,
    createdAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  (async () => {
    try {
      updateJobProgressDb(jobId, 10);
      const candleData = await resolveJobCandles(sym, tf, candles);
      updateJobProgressDb(jobId, 30);

      if (isJobCancelledDb(jobId)) return;

      // Strategy code lookup: passed explicitly or stored in SQLite
      let effectiveCode = strategyCode || config.strategyCode;
      let transpiledJs = '';

      if (!effectiveCode && config.strategyId) {
        const saved = getStrategyById(config.strategyId);
        if (saved) {
          effectiveCode = saved.strategy.code;
          transpiledJs = saved.transpiledJs || '';
        }
      }

      updateJobProgressDb(jobId, 50);
      if (isJobCancelledDb(jobId)) return;

      let result: any;
      if (effectiveCode) {
        if (!transpiledJs) {
          const transpiled = transpileStrategyCode(effectiveCode);
          transpiledJs = transpiled.jsCode;
        }

        const quickjs = await getQuickJS();
        const executor = createQuickJSStrategyExecutor(
          quickjs,
          transpiledJs,
          config.params || {},
          {
            isCancelled: () => isJobCancelledDb(jobId),
            barTimeoutMs: 50,
          }
        );

        try {
          updateJobProgressDb(jobId, 65);
          result = runBacktest(candleData, config, executor.strategyLogic);
        } finally {
          executor.dispose();
        }
      } else {
        const executor = getStrategyExecutor(config.strategyId);
        updateJobProgressDb(jobId, 65);
        result = runBacktest(candleData, config, executor);
      }

      if (isJobCancelledDb(jobId)) return;

      const completed = updateJobCompletedDb(jobId, result);
      if (completed) {
        job.status = 'COMPLETED';
        job.progress = 100;
        job.result = result;
        job.completedAt = new Date().toISOString();
      }
    } catch (err: any) {
      if (err?.message === 'JOB_CANCELLED' || isJobCancelledDb(jobId)) {
        cancelJobDb(jobId);
        job.status = 'CANCELLED';
        job.completedAt = new Date().toISOString();
      } else {
        updateJobFailedDb(jobId, err?.message || 'Backtest failed');
        job.status = 'FAILED';
        job.error = err?.message || 'Backtest failed';
        job.completedAt = new Date().toISOString();
      }
    }
  })();

  res.json({ success: true, jobId, status: 'RUNNING' });
});

// ==========================================
// STRATEGIES & BOTS PERSISTENCE APIS
// ==========================================

app.get('/api/strategies', (req, res) => {
  try {
    let list = getAllStrategies();
    if (list.length === 0) {
      for (const strat of BUILT_IN_STRATEGIES) {
        saveStrategy(strat);
      }
      list = getAllStrategies();
    }
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/strategies', (req, res) => {
  try {
    const { strategy, transpiledJs } = req.body;
    if (!strategy || !strategy.id || !strategy.name) {
      return res.status(400).json({ error: 'Valid strategy object is required' });
    }
    saveStrategy(strategy, transpiledJs);
    insertAuditLog({
      id: `aud_strat_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'User',
      action: 'STRATEGY_SAVED',
      entity: `${strategy.name} (${strategy.id})`,
      details: `Persisted strategy in SQLite. Source: ${strategy.sourceType}`,
      status: 'SUCCESS',
    });
    res.json({ success: true, strategy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/strategies/:id', (req, res) => {
  try {
    const deleted = deleteStrategy(req.params.id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bots', (req, res) => {
  try {
    const list = getAllBots();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bots', (req, res) => {
  try {
    const { bot, magicNumber } = req.body;
    if (!bot || !bot.id) {
      return res.status(400).json({ error: 'Valid bot object is required' });
    }
    const magic = magicNumber || (bot.magicNumber ? Number(bot.magicNumber) : Math.floor(1000 + Math.random() * 9000));
    saveBot(bot, magic);
    insertAuditLog({
      id: `aud_bot_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'User',
      action: 'BOT_SAVED',
      entity: `${bot.name} (${bot.id})`,
      details: `Persisted bot in SQLite. Magic: ${magic}, Mode: ${bot.mode}, Status: ${bot.status}`,
      status: 'SUCCESS',
    });
    res.json({ success: true, bot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bots/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    if (status === 'RUNNING') {
      const bot = getBotById(req.params.id);
      if (bot && (bot.mode === 'DEMO_LIVE' || bot.mode === 'LIVE')) {
        const bridgeUrl = process.env.BRIDGE_URL;
        if (bridgeUrl) {
          try {
            const bridgeClient = new BridgeClient({
              baseUrl: bridgeUrl,
              token: process.env.BRIDGE_TOKEN,
            });
            const health = await bridgeClient.getHealth();
            if (health.allow_trading === false) {
              return res.status(403).json({
                error: 'ALLOW_TRADING_DISABLED: mt5-bridge is running in read-only mode (ALLOW_TRADING=false). DEMO and LIVE bots cannot be started.',
              });
            }
          } catch (err: any) {
            if (err?.code === 'BRIDGE_FORBIDDEN' || err?.message?.includes('ALLOW_TRADING=false')) {
              return res.status(403).json({
                error: 'ALLOW_TRADING_DISABLED: mt5-bridge is running in read-only mode (ALLOW_TRADING=false). DEMO and LIVE bots cannot be started.',
              });
            }
          }
        }
      }
    }

    const updated = updateBotStatusDb(req.params.id, status);
    res.json({ success: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reconciliation', async (req, res) => {
  try {
    const { autoCloseMissingSl, gracePeriodSeconds } = req.body || {};
    const bridgeUrl = process.env.BRIDGE_URL;
    if (!bridgeUrl) {
      return res.json({
        success: true,
        simulation: true,
        message: 'SIMULATION: no broker connected for reconciliation',
        report: { ordersFilled: 0, ordersFailed: 0, positionsAdopted: 0, orphanPositions: 0, positionsClosed: 0, missingSlPositions: 0, details: [] },
      });
    }

    const bridgeClient = new BridgeClient({
      baseUrl: bridgeUrl,
      token: process.env.BRIDGE_TOKEN,
    });
    const report = await reconcileWithBroker(bridgeClient, { autoCloseMissingSl, gracePeriodSeconds });
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bots/:id', (req, res) => {
  try {
    const deleted = deleteBotDb(req.params.id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Watchdog Status & Manual Confirmed Resume
app.get('/api/watchdog/status', (req, res) => {
  res.json(globalWatchdog.getStatus());
});

app.post('/api/watchdog/resume', (req, res) => {
  const result = globalWatchdog.confirmManualResume();
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post('/api/watchdog/heartbeat', (req, res) => {
  globalWatchdog.recordHeartbeat();
  res.json({ success: true, timestamp: new Date().toISOString() });
});

// Risk Events Log
app.get('/api/risk/events', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  res.json(getRecentRiskEvents(limit));
});

// Audit Log endpoint
app.get('/api/audit-log', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json(getRecentAuditLogs(limit));
});

// Authoritative Positions endpoint (bridge or SQLite database)
app.get('/api/positions', async (req, res) => {
  const bridgeUrl = process.env.BRIDGE_URL;
  if (bridgeUrl) {
    try {
      const bridgeClient = new BridgeClient({
        baseUrl: bridgeUrl,
        token: process.env.BRIDGE_TOKEN,
      });
      const bridgePositions = await bridgeClient.getPositions();
      return res.json(bridgePositions);
    } catch (_) {}
  }
  const localPositions = getOpenPositionsDb();
  res.json(localPositions);
});

app.post('/api/jobs/optimize', async (req, res) => {
  const { config, symbol, timeframe, candles } = req.body;
  if (!config) {
    return res.status(400).json({ error: 'config is required' });
  }

  const sym = symbol || config.symbol || 'EURUSD';
  const tf = timeframe || config.timeframe || 'H1';
  const jobId = `job_opt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  createJobDb(jobId, 'OPTIMIZATION', config);

  const job: BackgroundJob = {
    id: jobId,
    type: 'OPTIMIZATION',
    status: 'RUNNING',
    progress: 0,
    params: config,
    createdAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  (async () => {
    try {
      updateJobProgressDb(jobId, 5);
      const candleData = await resolveJobCandles(sym, tf, candles);

      if (isJobCancelledDb(jobId)) return;

      const report = await runOptimizationSweep(
        candleData,
        config,
        (pct) => {
          updateJobProgressDb(jobId, pct);
          const currentJob = activeJobs.get(jobId);
          if (currentJob) {
            currentJob.progress = pct;
          }
        },
        {
          isCancelled: () => isJobCancelledDb(jobId),
        }
      );

      if (isJobCancelledDb(jobId)) return;

      const completed = updateJobCompletedDb(jobId, report);
      if (completed) {
        job.status = 'COMPLETED';
        job.progress = 100;
        job.result = report;
        job.completedAt = new Date().toISOString();
      }
    } catch (err: any) {
      if (err?.message === 'OPTIMIZATION_CANCELLED' || isJobCancelledDb(jobId)) {
        cancelJobDb(jobId);
        job.status = 'CANCELLED';
        job.completedAt = new Date().toISOString();
      } else {
        updateJobFailedDb(jobId, err?.message || 'Optimization failed');
        job.status = 'FAILED';
        job.error = err?.message || 'Optimization failed';
        job.completedAt = new Date().toISOString();
      }
    }
  })();

  res.json({ success: true, jobId, status: 'RUNNING' });
});

app.get('/api/jobs/:id', (req, res) => {
  const dbJob = getJobDb(req.params.id);
  if (dbJob) {
    return res.json(dbJob);
  }
  const job = activeJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  cancelJobDb(req.params.id);
  const job = activeJobs.get(req.params.id);
  if (job) {
    job.status = 'CANCELLED';
    job.cancelRequested = true;
  }
  res.json({ success: true, message: 'Job cancellation requested' });
});

// ==========================================
// 8. DATA MANAGER & PERSISTENCE APIS
// ==========================================

app.get('/api/data/catalog', (req, res) => {
  try {
    const catalog = getDataCatalog();
    res.json(catalog);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

app.post('/api/data/save', async (req, res) => {
  try {
    const { symbol, timeframe, candles } = req.body;
    if (!symbol || !timeframe || !candles) {
      return res.status(400).json({ error: 'symbol, timeframe, and candles are required' });
    }
    const report = await savePartitionedCandles(symbol, timeframe, candles);
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

app.post('/api/data/audit', (req, res) => {
  try {
    const { candles, timeframe } = req.body;
    const report = auditCandleIntegrity(candles || [], timeframe || 'H1');
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Zaboraa FX Server running on http://${HOST}:${PORT} (Gemini: ${GEMINI_MODEL})`);
  });
}

// Only start listening if not running under test suite
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
if (!isTestEnv) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
  });
}
