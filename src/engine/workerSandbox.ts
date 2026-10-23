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
    // Check for word boundary
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

export interface WorkerExecutionResult {
  success: boolean;
  decisionsCount: number;
  error?: string;
  durationMs: number;
}

export function runStrategyInWorker(
  strategyCode: string,
  sampleCandles: Candle[],
  timeoutMs = 3000
): Promise<WorkerExecutionResult> {
  return new Promise((resolve) => {
    const validation = validateStrategyCode(strategyCode);
    if (!validation.isValid) {
      return resolve({
        success: false,
        decisionsCount: 0,
        error: validation.errors.join(' | '),
        durationMs: 0,
      });
    }

    const startTime = performance.now();

    // Prepare worker script
    const workerScript = `
self.onmessage = function(e) {
  const { code, candles, params } = e.data;
  let decisions = 0;

  try {
    // Encapsulate strategy definition
    const factory = new Function('ctx', 'bar', code + '; if (typeof onBar === "function") { onBar(ctx, bar); }');
    
    // Simulate loop
    for (let i = 20; i < Math.min(candles.length, 60); i++) {
      const currentBar = candles[i];
      const slice = candles.slice(0, i + 1);
      const mockCtx = {
        data: slice,
        currentBar: currentBar,
        barIndex: i,
        params: params || {},
        buy: function() { decisions++; },
        sell: function() { decisions++; },
        close: function() { decisions++; },
        modify: function() { decisions++; }
      };

      factory(mockCtx, currentBar);
    }

    self.postMessage({ success: true, decisionsCount: decisions });
  } catch (err) {
    self.postMessage({ success: false, error: err ? err.message : 'Unknown execution error' });
  }
};
`;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    let worker: Worker | null = null;
    let timer: any = null;

    try {
      worker = new Worker(workerUrl);

      timer = setTimeout(() => {
        if (worker) {
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          resolve({
            success: false,
            decisionsCount: 0,
            error: `Strategy timed out after ${timeoutMs}ms (infinite loop protection).`,
            durationMs: Math.round(performance.now() - startTime),
          });
        }
      }, timeoutMs);

      worker.onmessage = (event) => {
        clearTimeout(timer);
        if (worker) {
          worker.terminate();
        }
        URL.revokeObjectURL(workerUrl);
        const durationMs = Math.round(performance.now() - startTime);

        if (event.data.success) {
          resolve({
            success: true,
            decisionsCount: event.data.decisionsCount || 0,
            durationMs,
          });
        } else {
          resolve({
            success: false,
            decisionsCount: 0,
            error: event.data.error,
            durationMs,
          });
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timer);
        if (worker) worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve({
          success: false,
          decisionsCount: 0,
          error: err.message || 'Worker syntax error',
          durationMs: Math.round(performance.now() - startTime),
        });
      };

      worker.postMessage({
        code: strategyCode,
        candles: sampleCandles,
        params: {},
      });
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      if (worker) worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve({
        success: false,
        decisionsCount: 0,
        error: err.message,
        durationMs: Math.round(performance.now() - startTime),
      });
    }
  });
}
