import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Candle, DataIntegrityReport, SymbolName, Timeframe } from '../types/forex';
import { getDb } from './db';

const CANDLE_DIR = path.resolve(process.cwd(), 'data', 'candles');

/**
 * Ensures directory hierarchy exists
 */
function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Computes SHA-256 hash of a candle array
 */
export function computeCandlesHash(candles: Candle[]): string {
  const hash = crypto.createHash('sha256');
  for (const c of candles) {
    hash.update(`${c.time}:${c.open}:${c.high}:${c.low}:${c.close}:${c.tickVolume || 0},`);
  }
  return hash.digest('hex');
}

/**
 * Runs thorough integrity analysis on a candle dataset
 */
export function auditCandleIntegrity(candles: Candle[], timeframe: Timeframe): DataIntegrityReport {
  if (candles.length === 0) {
    return {
      totalBars: 0,
      validBars: 0,
      gapCount: 0,
      duplicateCount: 0,
      invalidOhlcCount: 0,
      gaps: [],
      invalidBars: [],
      sha256Hash: '',
      qualityScore: 100,
    };
  }

  // Sort ascending by timestamp
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const gaps: { startTime: number; endTime: number; missingBarsEstimated: number }[] = [];
  const invalidBars: { time: number; reason: string }[] = [];

  let duplicateCount = 0;
  let invalidOhlcCount = 0;

  // Expected bar step in seconds
  const stepMap: Record<Timeframe, number> = {
    M1: 60,
    M5: 300,
    M15: 900,
    H1: 3600,
    H4: 14400,
    D1: 86400,
  };
  const expectedStep = stepMap[timeframe] || 3600;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];

    // OHLC validation: H must be >= L, O, C; L must be <= H, O, C
    if (c.high < c.low || c.open > c.high || c.close > c.high || c.open < c.low || c.close < c.low) {
      invalidOhlcCount++;
      if (invalidBars.length < 20) {
        invalidBars.push({
          time: c.time,
          reason: `Invalid OHLC bounds: O=${c.open}, H=${c.high}, L=${c.low}, C=${c.close}`,
        });
      }
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      const diff = c.time - prev.time;

      if (diff === 0) {
        duplicateCount++;
      } else if (diff > expectedStep * 1.5) {
        // Exclude normal weekend gap for forex (Friday 22:00 UTC to Sunday 22:00 UTC ~ 48h)
        const isWeekend = diff >= 86400 * 1.8 && diff <= 86400 * 2.5;
        if (!isWeekend) {
          const missingBars = Math.floor(diff / expectedStep) - 1;
          if (missingBars > 0 && gaps.length < 30) {
            gaps.push({
              startTime: prev.time,
              endTime: c.time,
              missingBarsEstimated: missingBars,
            });
          }
        }
      }
    }
  }

  const sha256Hash = computeCandlesHash(sorted);
  const totalGaps = gaps.length;
  const invalidTotal = invalidOhlcCount + duplicateCount;
  const errorRate = (invalidTotal + totalGaps * 2) / Math.max(1, sorted.length);
  const qualityScore = Math.max(0, Math.min(100, Math.round((1 - errorRate) * 100)));

  return {
    totalBars: sorted.length,
    validBars: sorted.length - invalidOhlcCount,
    gapCount: totalGaps,
    duplicateCount,
    invalidOhlcCount,
    gaps,
    invalidBars,
    sha256Hash,
    qualityScore,
  };
}

/**
 * Saves candles atomically to disk partitioned by symbol/timeframe/year,
 * writes to .tmp first, and updates SQLite catalog metadata.
 */
export async function savePartitionedCandles(
  symbol: SymbolName,
  timeframe: Timeframe,
  candles: Candle[]
): Promise<DataIntegrityReport> {
  const audit = auditCandleIntegrity(candles, timeframe);

  // Group candles by UTC calendar year
  const byYear = new Map<number, Candle[]>();
  for (const c of candles) {
    const yr = new Date(c.time * 1000).getUTCFullYear();
    let arr = byYear.get(yr);
    if (!arr) {
      arr = [];
      byYear.set(yr, arr);
    }
    arr.push(c);
  }

  const db = getDb();

  for (const [year, yearCandles] of byYear.entries()) {
    yearCandles.sort((a, b) => a.time - b.time);
    const yearHash = computeCandlesHash(yearCandles);

    const partitionDir = path.join(CANDLE_DIR, symbol, timeframe);
    ensureDir(partitionDir);

    const targetFile = path.join(partitionDir, `${year}.json`);
    const tmpFile = path.join(partitionDir, `${year}.tmp.${Date.now()}`);

    // Atomic write pattern: write to .tmp, flush, and rename
    await fs.promises.writeFile(tmpFile, JSON.stringify(yearCandles, null, 2), 'utf8');
    await fs.promises.rename(tmpFile, targetFile);

    const firstTime = yearCandles[0].time;
    const lastTime = yearCandles[yearCandles.length - 1].time;

    // Update SQLite Data Catalog
    const catalogId = `${symbol}_${timeframe}_${year}`;
    db.prepare(`
      INSERT INTO data_catalog (
        id, symbol, timeframe, year, file_path, sha256_hash,
        first_candle_time, last_candle_time, candle_count, gap_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_path = excluded.file_path,
        sha256_hash = excluded.sha256_hash,
        first_candle_time = excluded.first_candle_time,
        last_candle_time = excluded.last_candle_time,
        candle_count = excluded.candle_count,
        gap_count = excluded.gap_count,
        updated_at = excluded.updated_at
    `).run(
      catalogId,
      symbol,
      timeframe,
      year,
      targetFile,
      yearHash,
      firstTime,
      lastTime,
      yearCandles.length,
      audit.gapCount,
      new Date().toISOString()
    );
  }

  return audit;
}

/**
 * Loads partitioned candles from disk for a symbol, timeframe, and optional date range
 */
export async function loadPartitionedCandles(
  symbol: SymbolName,
  timeframe: Timeframe,
  startTimeSec?: number,
  endTimeSec?: number
): Promise<Candle[]> {
  const partitionDir = path.join(CANDLE_DIR, symbol, timeframe);
  if (!fs.existsSync(partitionDir)) {
    return [];
  }

  const files = await fs.promises.readdir(partitionDir);
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

  let allCandles: Candle[] = [];

  for (const file of jsonFiles) {
    const filePath = path.join(partitionDir, file);
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const parsed: Candle[] = JSON.parse(content);
      allCandles = allCandles.concat(parsed);
    } catch (err) {
      console.error(`Failed to read candle partition ${filePath}:`, err);
    }
  }

  // Filter by time range if requested
  if (startTimeSec !== undefined) {
    allCandles = allCandles.filter(c => c.time >= startTimeSec);
  }
  if (endTimeSec !== undefined) {
    allCandles = allCandles.filter(c => c.time <= endTimeSec);
  }

  return allCandles.sort((a, b) => a.time - b.time);
}

/**
 * Retrieves the Data Catalog entries from SQLite
 */
export function getDataCatalog() {
  const db = getDb();
  return db.prepare('SELECT * FROM data_catalog ORDER BY symbol, timeframe, year ASC').all();
}
