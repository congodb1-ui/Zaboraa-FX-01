import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  Strategy,
  Bot,
  OrderRecord,
  OrderStatus,
  LiveTokenRecord,
  AuditLogEntry,
  BacktestResult,
  Position,
} from '../types/forex';

let dbInstance: DatabaseSync | null = null;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'zaboraa.sqlite');

/**
 * Initializes and returns the SQLite database instance with WAL and FULL sync
 */
export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  dbInstance = new DatabaseSync(DB_PATH);

  // Configure pragmas for crash safety, concurrency, and persistence
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA synchronous = FULL;');
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA busy_timeout = 10000;');

  initSchema(dbInstance);
  return dbInstance;
}

function initSchema(db: DatabaseSync) {
  // System State (e.g. no_new_orders, risk limits)
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Strategies
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL,
      code TEXT NOT NULL,
      transpiled_js TEXT,
      version TEXT,
      params_schema TEXT,
      params TEXT,
      author TEXT,
      source_url TEXT,
      license TEXT,
      pine_source TEXT,
      verified_tv INTEGER DEFAULT 0,
      tags TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Background Jobs
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL DEFAULT 0,
      params_json TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);

  // AI Prompt & Response Cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_cache (
      cache_key TEXT PRIMARY KEY,
      prompt_type TEXT NOT NULL,
      model_name TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Automated Trading Bots
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      magic_number INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      strategy_name TEXT,
      account_login TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      params_json TEXT,
      risk_limits_json TEXT,
      today_pnl REAL DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      trades_count INTEGER DEFAULT 0,
      last_signal_json TEXT,
      last_heartbeat TEXT,
      last_reconciled_at TEXT
    );
  `);

  // Order Intent & Execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      bot_id TEXT NOT NULL,
      magic_number INTEGER NOT NULL,
      ticket INTEGER,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      volume REAL NOT NULL,
      intent_price REAL NOT NULL,
      fill_price REAL,
      sl REAL NOT NULL,
      tp REAL,
      status TEXT NOT NULL,
      comment TEXT,
      error_reason TEXT,
      created_at TEXT NOT NULL,
      filled_at TEXT
    );
  `);

  // Single-use Live Tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_tokens (
      token TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      account_login TEXT NOT NULL,
      risk_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
  `);

  // Risk Events
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      details TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  // Trades
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      ticket INTEGER,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      volume REAL NOT NULL,
      open_price REAL NOT NULL,
      close_price REAL NOT NULL,
      sl REAL NOT NULL,
      tp REAL,
      pnl REAL NOT NULL,
      swap REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      slippage_pips REAL DEFAULT 0,
      open_time INTEGER NOT NULL,
      close_time INTEGER NOT NULL,
      magic_number INTEGER,
      idempotency_key TEXT UNIQUE
    );
  `);

  // Backtest Results
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_results (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      mc_seed INTEGER,
      metrics_json TEXT NOT NULL,
      trades_json TEXT,
      chart_equity_json TEXT,
      overfitting_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Data Catalog with SHA-256 Hashes
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_catalog (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      year INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      first_candle_time INTEGER,
      last_candle_time INTEGER,
      candle_count INTEGER NOT NULL,
      gap_count INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(symbol, timeframe, year)
    );
  `);

  // Audit Log
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL
    );
  `);

  // Open Positions
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      ticket INTEGER PRIMARY KEY,
      bot_id TEXT,
      magic_number INTEGER,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      volume REAL NOT NULL,
      open_price REAL NOT NULL,
      current_price REAL,
      sl REAL,
      tp REAL,
      pnl REAL DEFAULT 0,
      swap REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      open_time INTEGER NOT NULL,
      comment TEXT,
      is_closed INTEGER DEFAULT 0,
      close_price REAL,
      close_time INTEGER,
      status TEXT DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed default system state if empty
  const stateCheck = db.prepare('SELECT value FROM system_state WHERE key = ?').get('no_new_orders') as any;
  if (!stateCheck) {
    db.prepare('INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)').run(
      'no_new_orders',
      'false',
      new Date().toISOString()
    );
  }
}

// ==========================================
// SYSTEM STATE & KILL SWITCH OPERATIONS
// ==========================================

export function getNoNewOrdersFlag(): boolean {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get('no_new_orders') as any;
    return row?.value === 'true';
  } catch (err) {
    console.error('Failed to read no_new_orders flag from SQLite:', err);
    return false;
  }
}

export function setNoNewOrdersFlag(value: boolean): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO system_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('no_new_orders', value ? 'true' : 'false', new Date().toISOString());
  } catch (err) {
    console.error('Failed to persist no_new_orders flag in SQLite (falling back to memory):', err);
  }
}

// ==========================================
// STRATEGY REPOSITORY
// ==========================================

export function saveStrategy(strategy: Strategy, transpiledJs?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO strategies (
      id, name, description, source_type, code, transpiled_js, version,
      params_schema, params, author, source_url, license, pine_source,
      verified_tv, tags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      code = excluded.code,
      transpiled_js = excluded.transpiled_js,
      version = excluded.version,
      params_schema = excluded.params_schema,
      params = excluded.params,
      author = excluded.author,
      source_url = excluded.source_url,
      license = excluded.license,
      pine_source = excluded.pine_source,
      verified_tv = excluded.verified_tv,
      tags = excluded.tags,
      updated_at = excluded.updated_at
  `).run(
    strategy.id,
    strategy.name,
    strategy.description || '',
    strategy.sourceType,
    strategy.code,
    transpiledJs || '',
    strategy.version,
    JSON.stringify(strategy.paramsSchema || []),
    JSON.stringify(strategy.params || {}),
    strategy.author || '',
    '', // source_url
    strategy.licenseNote || '',
    strategy.pineSource || '',
    0,
    JSON.stringify(strategy.tags || []),
    strategy.createdAt || new Date().toISOString(),
    new Date().toISOString()
  );
}

export function getAllStrategies(): Strategy[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM strategies ORDER BY updated_at DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    sourceType: r.source_type,
    code: r.code,
    paramsSchema: JSON.parse(r.params_schema || '[]'),
    params: JSON.parse(r.params || '{}'),
    version: r.version,
    author: r.author,
    licenseNote: r.license,
    pineSource: r.pine_source,
    tags: JSON.parse(r.tags || '[]'),
    createdAt: r.created_at,
  }));
}

export function getStrategyById(id: string): { strategy: Strategy; transpiledJs?: string } | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM strategies WHERE id = ?').get(id) as any;
  if (!r) return null;
  return {
    strategy: {
      id: r.id,
      name: r.name,
      description: r.description,
      sourceType: r.source_type,
      code: r.code,
      paramsSchema: JSON.parse(r.params_schema || '[]'),
      params: JSON.parse(r.params || '{}'),
      version: r.version,
      author: r.author,
      licenseNote: r.license,
      pineSource: r.pine_source,
      tags: JSON.parse(r.tags || '[]'),
      createdAt: r.created_at,
    },
    transpiledJs: r.transpiled_js || undefined,
  };
}

export function deleteStrategy(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM strategies WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

// ==========================================
// ORDER LIFECYCLE & RECONCILIATION
// ==========================================

export function logOrderIntent(order: OrderRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO orders (
      id, idempotency_key, bot_id, magic_number, ticket, symbol, side,
      volume, intent_price, fill_price, sl, tp, status, comment,
      created_at, filled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id,
    order.idempotencyKey,
    order.botId || 'manual',
    order.magicNumber || 1001,
    order.ticket ?? null,
    order.symbol,
    order.side || 'BUY',
    order.volume ?? 0.1,
    order.intentPrice ?? 0,
    order.fillPrice ?? null,
    order.sl,
    order.tp ?? null,
    order.status || 'PENDING_BROKER',
    order.comment || '',
    order.createdAt,
    order.filledAt ?? null
  );
}

export function updateOrderStatus(
  id: string,
  status: OrderStatus,
  ticket?: number,
  fillPrice?: number,
  errorReason?: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE orders
    SET status = ?, ticket = COALESCE(?, ticket), fill_price = COALESCE(?, fill_price),
        error_reason = ?, filled_at = CASE WHEN ? = 'FILLED' THEN ? ELSE filled_at END
    WHERE id = ?
  `).run(
    status,
    ticket || null,
    fillPrice || null,
    errorReason || null,
    status,
    new Date().toISOString(),
    id
  );
}

export function getPendingOrders(): OrderRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM orders WHERE status IN ('PENDING_BROKER', 'SENT', 'UNKNOWN')").all() as any[];
  return rows.map(r => ({
    id: r.id,
    idempotencyKey: r.idempotency_key,
    botId: r.bot_id,
    magicNumber: r.magic_number,
    ticket: r.ticket,
    symbol: r.symbol,
    side: r.side,
    volume: r.volume,
    intentPrice: r.intent_price,
    fillPrice: r.fill_price,
    sl: r.sl,
    tp: r.tp,
    status: r.status,
    comment: r.comment,
    createdAt: r.created_at,
    filledAt: r.filled_at,
    errorReason: r.error_reason,
  }));
}

export function getOrderById(id: string): OrderRecord | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    botId: r.bot_id,
    magicNumber: r.magic_number,
    ticket: r.ticket ?? undefined,
    symbol: r.symbol,
    side: r.side,
    volume: r.volume,
    intentPrice: r.intent_price,
    fillPrice: r.fill_price ?? undefined,
    sl: r.sl,
    tp: r.tp ?? undefined,
    status: r.status,
    comment: r.comment,
    createdAt: r.created_at,
    filledAt: r.filled_at ?? undefined,
    errorReason: r.error_reason ?? undefined,
  };
}

export function getOrderByTicket(ticket: number): OrderRecord | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM orders WHERE ticket = ?').get(ticket) as any;
  if (!r) return null;
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    botId: r.bot_id,
    magicNumber: r.magic_number,
    ticket: r.ticket ?? undefined,
    symbol: r.symbol,
    side: r.side,
    volume: r.volume,
    intentPrice: r.intent_price,
    fillPrice: r.fill_price ?? undefined,
    sl: r.sl,
    tp: r.tp ?? undefined,
    status: r.status,
    comment: r.comment,
    createdAt: r.created_at,
    filledAt: r.filled_at ?? undefined,
    errorReason: r.error_reason ?? undefined,
  };
}

// ==========================================
// LIVE TOKENS (ATOMIC CAS & TTL)
// ==========================================

export function saveLiveToken(tokenRecord: LiveTokenRecord): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO live_tokens (token, bot_id, account_login, risk_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    tokenRecord.token,
    tokenRecord.botId,
    tokenRecord.accountLogin,
    tokenRecord.riskHash,
    tokenRecord.createdAt,
    tokenRecord.expiresAt
  );
}

export function consumeLiveToken(token: string, botId: string, accountLogin: string, riskHash: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();

  // Atomic single-use check: updates used_at ONLY if token matches, is not expired, and has not yet been used
  const res = db.prepare(`
    UPDATE live_tokens
    SET used_at = ?
    WHERE token = ?
      AND bot_id = ?
      AND account_login = ?
      AND risk_hash = ?
      AND expires_at > ?
      AND used_at IS NULL
  `).run(now, token, botId, accountLogin, riskHash, now);

  return res.changes > 0;
}

// ==========================================
// BOTS REPOSITORY
// ==========================================

export function saveBot(bot: Bot, magicNumber: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO bots (
      id, magic_number, name, strategy_id, strategy_name, account_login,
      symbol, timeframe, mode, status, params_json, risk_limits_json,
      today_pnl, total_pnl, trades_count, last_signal_json, last_heartbeat,
      last_reconciled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mode = excluded.mode,
      status = excluded.status,
      params_json = excluded.params_json,
      risk_limits_json = excluded.risk_limits_json,
      today_pnl = excluded.today_pnl,
      total_pnl = excluded.total_pnl,
      trades_count = excluded.trades_count,
      last_signal_json = excluded.last_signal_json,
      last_heartbeat = excluded.last_heartbeat,
      last_reconciled_at = excluded.last_reconciled_at
  `).run(
    bot.id,
    magicNumber,
    bot.name,
    bot.strategyId,
    bot.strategyName,
    bot.accountId,
    bot.symbol,
    bot.timeframe,
    bot.mode,
    bot.status,
    JSON.stringify(bot.params || {}),
    JSON.stringify(bot.riskLimits || {}),
    bot.todayPnl,
    bot.totalPnl,
    bot.tradesCount,
    JSON.stringify(bot.lastSignal || null),
    bot.lastHeartbeat,
    new Date().toISOString()
  );
}

export function getAllBots(): Bot[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM bots').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    accountId: r.account_login,
    symbol: r.symbol,
    timeframe: r.timeframe,
    mode: r.mode,
    status: r.status,
    params: JSON.parse(r.params_json || '{}'),
    riskLimits: JSON.parse(r.risk_limits_json || '{}'),
    todayPnl: r.today_pnl,
    totalPnl: r.total_pnl,
    tradesCount: r.trades_count,
    lastSignal: r.last_signal_json ? JSON.parse(r.last_signal_json) : undefined,
    lastHeartbeat: r.last_heartbeat || new Date().toISOString(),
    logs: [],
  }));
}

export function updateBotStatusDb(id: string, status: string): boolean {
  const db = getDb();
  const res = db.prepare('UPDATE bots SET status = ?, last_heartbeat = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  return Number(res.changes) > 0;
}

export function deleteBotDb(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function getBotById(id: string): Bot | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    accountId: r.account_login,
    symbol: r.symbol,
    timeframe: r.timeframe,
    mode: r.mode,
    status: r.status,
    params: JSON.parse(r.params_json || '{}'),
    riskLimits: JSON.parse(r.risk_limits_json || '{}'),
    todayPnl: r.today_pnl,
    totalPnl: r.total_pnl,
    tradesCount: r.trades_count,
    lastSignal: r.last_signal_json ? JSON.parse(r.last_signal_json) : undefined,
    lastHeartbeat: r.last_heartbeat || new Date().toISOString(),
    logs: [],
  };
}

export function getBotByMagic(magicNumber: number): Bot | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM bots WHERE magic_number = ?').get(magicNumber) as any;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    accountId: r.account_login,
    symbol: r.symbol,
    timeframe: r.timeframe,
    mode: r.mode,
    status: r.status,
    params: JSON.parse(r.params_json || '{}'),
    riskLimits: JSON.parse(r.risk_limits_json || '{}'),
    todayPnl: r.today_pnl,
    totalPnl: r.total_pnl,
    tradesCount: r.trades_count,
    lastSignal: r.last_signal_json ? JSON.parse(r.last_signal_json) : undefined,
    lastHeartbeat: r.last_heartbeat || new Date().toISOString(),
    logs: [],
  };
}

// ==========================================
// POSITIONS REPOSITORY
// ==========================================

export interface DbPosition {
  ticket: number;
  botId?: string;
  magicNumber?: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  currentPrice?: number;
  sl?: number;
  tp?: number;
  pnl?: number;
  swap?: number;
  commission?: number;
  openTime: number;
  comment?: string;
  isClosed?: boolean;
  closePrice?: number;
  closeTime?: number;
  status?: string;
}

export function savePositionDb(pos: DbPosition): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO positions (
      ticket, bot_id, magic_number, symbol, side, volume,
      open_price, current_price, sl, tp, pnl, swap, commission,
      open_time, comment, is_closed, close_price, close_time, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticket) DO UPDATE SET
      current_price = excluded.current_price,
      sl = excluded.sl,
      tp = excluded.tp,
      pnl = excluded.pnl,
      swap = excluded.swap,
      commission = excluded.commission,
      is_closed = excluded.is_closed,
      close_price = excluded.close_price,
      close_time = excluded.close_time,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    pos.ticket,
    pos.botId || null,
    pos.magicNumber || null,
    pos.symbol,
    pos.side,
    pos.volume,
    pos.openPrice,
    pos.currentPrice ?? pos.openPrice,
    pos.sl ?? null,
    pos.tp ?? null,
    pos.pnl ?? 0,
    pos.swap ?? 0,
    pos.commission ?? 0,
    pos.openTime,
    pos.comment || null,
    pos.isClosed ? 1 : 0,
    pos.closePrice ?? null,
    pos.closeTime ?? null,
    pos.status || 'OPEN',
    now,
    now
  );
}

export function getOpenPositionsDb(): DbPosition[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM positions WHERE is_closed = 0').all() as any[];
  return rows.map(r => ({
    ticket: r.ticket,
    botId: r.bot_id || undefined,
    magicNumber: r.magic_number ?? undefined,
    symbol: r.symbol,
    side: r.side,
    volume: r.volume,
    openPrice: r.open_price,
    currentPrice: r.current_price,
    sl: r.sl ?? undefined,
    tp: r.tp ?? undefined,
    pnl: r.pnl,
    swap: r.swap,
    commission: r.commission,
    openTime: r.open_time,
    comment: r.comment || undefined,
    isClosed: false,
    status: r.status,
  }));
}

export function getPositionByTicketDb(ticket: number): DbPosition | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM positions WHERE ticket = ?').get(ticket) as any;
  if (!r) return null;
  return {
    ticket: r.ticket,
    botId: r.bot_id || undefined,
    magicNumber: r.magic_number ?? undefined,
    symbol: r.symbol,
    side: r.side,
    volume: r.volume,
    openPrice: r.open_price,
    currentPrice: r.current_price,
    sl: r.sl ?? undefined,
    tp: r.tp ?? undefined,
    pnl: r.pnl,
    swap: r.swap,
    commission: r.commission,
    openTime: r.open_time,
    comment: r.comment || undefined,
    isClosed: r.is_closed === 1,
    closePrice: r.close_price ?? undefined,
    closeTime: r.close_time ?? undefined,
    status: r.status,
  };
}

export function closePositionDb(
  ticket: number,
  closePrice: number,
  closeTime: number,
  pnl: number = 0
): boolean {
  const db = getDb();
  const res = db.prepare(`
    UPDATE positions
    SET is_closed = 1, close_price = ?, close_time = ?, pnl = ?, status = 'CLOSED', updated_at = ?
    WHERE ticket = ?
  `).run(closePrice, closeTime, pnl, new Date().toISOString(), ticket);
  return Number(res.changes) > 0;
}

// ==========================================
// AUDIT LOG & RISK EVENTS
// ==========================================

export function insertAuditLog(entry: AuditLogEntry): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (id, timestamp, actor, action, entity, details, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.timestamp,
      entry.actor,
      entry.action,
      entry.entity,
      entry.details,
      entry.status
    );
  } catch (err) {
    console.error('Failed to write audit log to SQLite:', err);
  }
}

export function getRecentAuditLogs(limit = 100): AuditLogEntry[] {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      details: r.details,
      status: r.status,
    }));
  } catch (err) {
    console.error('Failed to query audit_log from SQLite:', err);
    return [];
  }
}


export function insertRiskEvent(event: {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity: string;
  details: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  status: string;
}): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO risk_events (id, timestamp, actor, action, entity, details, severity, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.timestamp,
      event.actor,
      event.action,
      event.entity,
      event.details,
      event.severity,
      event.status
    );
  } catch (err) {
    console.error('Failed to write risk event to SQLite:', err);
  }
}

export function getRecentRiskEvents(limit = 100): Array<{
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity: string;
  details: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  status: string;
}> {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM risk_events ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
  } catch (err) {
    console.error('Failed to query risk_events from SQLite:', err);
    return [];
  }
}

export function stopAllBots(): number {
  try {
    const db = getDb();
    const res = db.prepare("UPDATE bots SET status = 'STOPPED' WHERE status != 'STOPPED'").run();
    return Number(res.changes);
  } catch (err) {
    console.error('Failed to stop all bots in SQLite:', err);
    return 0;
  }
}

export function cancelAllPendingOrders(): number {
  try {
    const db = getDb();
    const res = db.prepare(`
      UPDATE orders
      SET status = 'CANCELLED', error_reason = 'Cancelled by emergency kill switch'
      WHERE status IN ('PENDING_BROKER', 'SENT')
    `).run();
    return Number(res.changes);
  } catch (err) {
    console.error('Failed to cancel pending orders in SQLite:', err);
    return 0;
  }
}

export function getOrSetPerInstallSalt(): string {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'encryption_salt'").get() as any;
    if (row && row.value) {
      return row.value;
    }
    // Generate fresh 16-byte random salt for this installation
    const newSalt = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('encryption_salt', ?, ?)
      ON CONFLICT(key) DO NOTHING
    `).run(newSalt, new Date().toISOString());
    return newSalt;
  } catch (err) {
    console.error('Failed to read or persist per-install salt, falling back to local fallback:', err);
    return 'zaboraa-fallback-salt-2026';
  }
}

// ==========================================
// BACKGROUND JOBS (PERSISTENT IN SQLITE)
// ==========================================

export interface PersistentJob {
  id: string;
  type: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  params: any;
  result?: any;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export function createJobDb(id: string, type: string, params: any): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, type, status, progress, params_json, created_at)
    VALUES (?, ?, 'RUNNING', 0, ?, ?)
  `).run(id, type, JSON.stringify(params || {}), new Date().toISOString());
}

export function getJobDb(id: string): PersistentJob | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    params: row.params_json ? JSON.parse(row.params_json) : {},
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}

export function updateJobProgressDb(id: string, progress: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE jobs
    SET progress = ?
    WHERE id = ? AND status != 'CANCELLED'
  `).run(progress, id);
}

/**
 * Updates job to COMPLETED. CRITICAL: A cancelled job must never be overwritten with COMPLETED.
 */
export function updateJobCompletedDb(id: string, result: any): boolean {
  const db = getDb();
  const res = db.prepare(`
    UPDATE jobs
    SET status = 'COMPLETED', progress = 100, result_json = ?, completed_at = ?
    WHERE id = ? AND status != 'CANCELLED'
  `).run(JSON.stringify(result || {}), new Date().toISOString(), id);
  return Number(res.changes) > 0;
}

export function updateJobFailedDb(id: string, errorMessage: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE jobs
    SET status = 'FAILED', error_message = ?, completed_at = ?
    WHERE id = ? AND status != 'CANCELLED'
  `).run(errorMessage, new Date().toISOString(), id);
}

export function cancelJobDb(id: string): boolean {
  const db = getDb();
  const res = db.prepare(`
    UPDATE jobs
    SET status = 'CANCELLED', completed_at = ?
    WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')
  `).run(new Date().toISOString(), id);
  return Number(res.changes) > 0;
}

export function isJobCancelledDb(id: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id) as any;
  return row?.status === 'CANCELLED';
}

// ==========================================
// AI CACHE (PERSISTENT IN SQLITE)
// ==========================================

export function getCachedAi(cacheKey: string): any | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT response_json FROM ai_cache WHERE cache_key = ?').get(cacheKey) as any;
    if (row && row.response_json) {
      return JSON.parse(row.response_json);
    }
    return null;
  } catch (err) {
    console.error('Failed to read from ai_cache in SQLite:', err);
    return null;
  }
}

export function setCachedAi(
  cacheKey: string,
  promptType: string,
  modelName: string,
  promptVersion: string,
  responseData: any
): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO ai_cache (cache_key, prompt_type, model_name, prompt_version, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        response_json = excluded.response_json,
        created_at = excluded.created_at
    `).run(
      cacheKey,
      promptType,
      modelName,
      promptVersion,
      JSON.stringify(responseData),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to persist to ai_cache in SQLite:', err);
  }
}
