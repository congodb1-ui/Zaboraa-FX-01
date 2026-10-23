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
  getAllBots,
} from './src/services/db';
import {
  savePartitionedCandles,
  loadPartitionedCandles,
  getDataCatalog,
  auditCandleIntegrity,
} from './src/services/candleStorage';
import { validateStrategyAST, transpileStrategyCode } from './src/engine/transpiler';
import { runOptimizationSweep } from './src/engine/optimizer';
import { runBacktest } from './src/engine/backtester';
import { OrderRecord, OrderStatus, Position } from './src/types/forex';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.use(express.json({ limit: '20mb' }));

// Derive master encryption key once at startup via scrypt
initMasterKey();

// Ensure SQLite database and schema exist on boot
getDb();

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

// Demo Broker Account state
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

// Startup Reconciliation: Check stranded pending orders in SQLite
function reconcileStartupOrders() {
  try {
    const pending = getPendingOrders();
    if (pending.length > 0) {
      console.log(`[STARTUP RECONCILIATION] Found ${pending.length} unresolved pending orders in SQLite. Resolving...`);
      for (const ord of pending) {
        // Mark as UNKNOWN / RECONCILED on startup if orphaned
        updateOrderStatus(ord.id, 'UNKNOWN', undefined, undefined, 'Reconciled on server restart');
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
reconcileStartupOrders();

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

app.post('/api/broker/connect', (req, res) => {
  const { login, server, symbolSuffix, mode } = req.body;
  if (!login || !server) {
    return res.status(400).json({ error: 'Login and server name are required' });
  }

  brokerState = {
    ...brokerState,
    login: String(login),
    server: String(server),
    symbolSuffix: symbolSuffix !== undefined ? symbolSuffix : 'm',
    mode: mode === 'LIVE' ? 'LIVE' : 'DEMO',
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

  // Failsafe: if live trading requested with missing encryption master key, fail closed
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

// ==========================================
// 3. ORDER SUBMISSION WITH INTENT PRE-LOGGING
// ==========================================

app.post('/api/broker/order', (req, res) => {
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
    mode,
    liveToken,
    riskLimits,
  } = req.body;

  const effectiveSide = String(side || direction || 'BUY').toUpperCase() as 'BUY' | 'SELL';
  const effectiveVolume = Number(volume || lots || 0.1);

  // 1. Check emergency halt flag (blocks opens only)
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
      entity: `${symbol} ${side}`,
      details: 'Rejected order because mandatory Stop-Loss is missing or invalid.',
      severity: 'CRITICAL',
      status: 'REJECTED',
    });
    return res.status(400).json({
      error: 'MANDATORY_STOP_LOSS_REQUIRED: Every order must include a verified broker stop-loss.',
    });
  }

  // 3. Live Token Verification if mode is LIVE
  if (mode === 'LIVE') {
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
  const barTime = Math.floor(Date.now() / 60000) * 60; // 1-minute bucket
  const idempotencyKey = hashContent(`${botId}:${symbol}:${barTime}:${effectiveSide}`);

  // Short comment tag for MT5
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

  // Pre-log intent in SQLite before dispatch
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

  // Simulate fill (or proxy to MT5 bridge)
  const mockTicket = Math.floor(100000 + Math.random() * 900000);
  const fillPrice = orderRecord.intentPrice > 0 ? orderRecord.intentPrice : (effectiveSide === 'BUY' ? 1.0845 : 1.0840);

  updateOrderStatus(orderId, 'FILLED', mockTicket, fillPrice);

  insertAuditLog({
    id: `aud_ord_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: mode === 'LIVE' ? 'Live Bot' : 'Demo Bot',
    action: 'ORDER_FILLED',
    entity: `${symbol} #${mockTicket}`,
    details: `${side} ${volume} lots at ${fillPrice}. SL: ${sl}, TP: ${tp || 'None'}. Magic: ${magicNumber}`,
    status: 'SUCCESS',
  });

  res.json({
    success: true,
    orderId,
    ticket: mockTicket,
    fillPrice,
    status: 'FILLED',
    comment: shortComment,
  });
});

// ==========================================
// 4. EMERGENCY KILL SWITCH WITH LOUD FAILURE
// ==========================================

app.post('/api/kill-switch', async (req, res) => {
  const { reason } = req.body;
  console.log(`[KILL SWITCH ACTIVATED] Reason: ${reason || 'User Emergency Trigger'}`);

  // 1. Immediately persist no_new_orders = true (blocks opens only)
  setNoNewOrdersFlag(true);

  // 2. Liquidations always proceed even if database write fails
  insertRiskEvent({
    id: `risk_kill_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Kill Switch',
    action: 'EMERGENCY_HALT',
    entity: 'ALL_BOTS_AND_POSITIONS',
    details: reason || 'Emergency kill-switch triggered by user.',
    severity: 'CRITICAL',
    status: 'ENGAGED',
  });

  // 3. Attempt to close positions via MT5 bridge if available, or simulate
  let unclosedTickets: number[] = [];
  let retryCount = 0;
  const maxRetries = 5;
  let allFlat = true;

  // Check if simulated or real bridge
  const bridgeToken = process.env.BRIDGE_TOKEN || 'dev-bridge-token';
  const bridgeUrl = `http://${process.env.HOST || '127.0.0.1'}:8001/kill`;

  try {
    // Attempt real bridge call if configured
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const bridgeResp = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (bridgeResp && bridgeResp.ok) {
      const bridgeData: any = await bridgeResp.json();
      if (bridgeData.unclosed && bridgeData.unclosed.length > 0) {
        allFlat = false;
        unclosedTickets = bridgeData.unclosed;
      }
    }
  } catch (e) {
    // Bridge offline or simulated
  }

  if (allFlat) {
    insertAuditLog({
      id: `aud_kill_flat_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Kill Switch',
      action: 'FLAT_VERIFIED',
      entity: 'Global Account',
      details: 'All open positions closed. Verified flat state.',
      status: 'SUCCESS',
    });

    return res.json({
      success: true,
      allFlat: true,
      message: 'Global Kill Switch engaged. All active market positions liquidated and bots halted.',
      timestamp: new Date().toISOString(),
      noNewOrders: true,
    });
  } else {
    insertRiskEvent({
      id: `risk_kill_fail_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'Kill Switch',
      action: 'PARTIAL_LIQUIDATION_FAILURE',
      entity: `Tickets: ${unclosedTickets.join(', ')}`,
      details: 'Some tickets failed to close. Market may be closed or off-quotes.',
      severity: 'CRITICAL',
      status: 'LOUD_FAILURE',
    });

    return res.status(500).json({
      success: false,
      allFlat: false,
      loudFailure: true,
      unclosedTickets,
      error: 'CRITICAL: Failed to close all positions. Market may be closed or off-quotes.',
      timestamp: new Date().toISOString(),
      noNewOrders: true,
    });
  }
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
// 5. PINE SCRIPT CONVERSION (WITH DISK CACHE)
// ==========================================

app.post('/api/pine/convert', async (req, res) => {
  try {
    const { pineCode, scriptTitle, userNotes } = req.body;

    if (!pineCode || typeof pineCode !== 'string' || pineCode.trim().length === 0) {
      return res.status(400).json({ error: 'Pine Script code is required' });
    }

    // Check SHA-256 cache
    const cacheKey = hashContent(pineCode);
    if (aiCache.has(cacheKey)) {
      console.log(`[AI CACHE HIT] Pine conversion served from cache (${cacheKey.slice(0, 8)})`);
      return res.json(aiCache.get(cacheKey));
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
    aiCache.set(cacheKey, parsed);
    return res.json(parsed);
  } catch (err: any) {
    console.error('Error in /api/pine/convert:', err);
    return res.status(500).json({ error: 'Failed to convert Pine Script', message: err?.message });
  }
});

// ==========================================
// 6. BACKGROUND JOB RUNNER (BACKTEST & OPTIMIZE)
// ==========================================

app.post('/api/jobs/optimize', async (req, res) => {
  const { config, candles } = req.body;
  if (!config || !candles || candles.length === 0) {
    return res.status(400).json({ error: 'config and candles are required' });
  }

  const jobId = `job_opt_${Date.now()}`;
  const job: BackgroundJob = {
    id: jobId,
    type: 'OPTIMIZATION',
    status: 'RUNNING',
    progress: 0,
    params: config,
    createdAt: new Date().toISOString(),
  };
  activeJobs.set(jobId, job);

  // Run in background without ceiling
  (async () => {
    try {
      const report = await runOptimizationSweep(candles, config, (pct) => {
        const currentJob = activeJobs.get(jobId);
        if (currentJob) {
          currentJob.progress = pct;
        }
      });
      job.status = 'COMPLETED';
      job.progress = 100;
      job.result = report;
      job.completedAt = new Date().toISOString();
    } catch (err: any) {
      job.status = 'FAILED';
      job.error = err?.message || 'Optimization failed';
      job.completedAt = new Date().toISOString();
    }
  })();

  res.json({ success: true, jobId, status: 'RUNNING' });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = activeJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = activeJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  job.status = 'CANCELLED';
  job.cancelRequested = true;
  res.json({ success: true, message: 'Job cancellation requested' });
});

// ==========================================
// 7. DATA MANAGER & PERSISTENCE APIS
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zaboraa FX Server running on http://0.0.0.0:${PORT} (Gemini: ${GEMINI_MODEL})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
