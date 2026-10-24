import { Candle } from '../types/forex';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

const FORBIDDEN_TOKENS = [
  'window',
  'document',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'eval',
  'Function',
  'importScripts',
  'cookie',
  'location',
];

export function validateStrategyCode(code: string): ValidationResult {
  const errors: string[] = [];

  for (const token of FORBIDDEN_TOKENS) {
    const regex = new RegExp(`\\b${token}\\b`, 'g');
    if (regex.test(code)) {
      errors.push(`Forbidden identifier detected: '${token}'. Sandbox prevents DOM, storage, and network access.`);
    }
  }

  // Ensure init and onBar exist
  if (!code.includes('onBar') && !code.includes('on_bar')) {
    errors.push("Strategy must implement an 'onBar(ctx, bar)' method.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export interface SmokeTestExecutionResult {
  success: boolean;
  decisionsCount: number;
  executedBars?: number;
  error?: string;
  durationMs: number;
}

/**
 * Executes a fast smoke test of strategy code inside the server-side QuickJS WASM sandbox.
 * Replaces the unsafe client-side `new Function` worker evaluation.
 */
export async function runStrategySmokeTest(
  strategyCode: string,
  sampleCandles: Candle[],
  params: Record<string, any> = {}
): Promise<SmokeTestExecutionResult> {
  const validation = validateStrategyCode(strategyCode);
  if (!validation.isValid) {
    return {
      success: false,
      decisionsCount: 0,
      error: validation.errors.join(' | '),
      durationMs: 0,
    };
  }

  const startTime = performance.now();

  try {
    const response = await fetch('/api/strategies/smoke-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: strategyCode,
        candles: sampleCandles,
        params,
      }),
    });

    const data = await response.json();
    const durationMs = Math.round(performance.now() - startTime);

    if (response.ok && data.success) {
      return {
        success: true,
        decisionsCount: data.totalSignals || 0,
        executedBars: data.executedBars || 0,
        durationMs: data.durationMs || durationMs,
      };
    } else {
      return {
        success: false,
        decisionsCount: 0,
        error: data.error || 'Smoke test execution failed',
        durationMs,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      decisionsCount: 0,
      error: err.message || 'Network error reaching QuickJS sandbox server endpoint',
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
