import { newQuickJSWASMModule, QuickJSContext, QuickJSWASMModule } from 'quickjs-emscripten';
import { Candle, Position } from '../types/forex';

let quickJSModulePromise: Promise<QuickJSWASMModule> | null = null;

export function getQuickJS(): Promise<QuickJSWASMModule> {
  if (!quickJSModulePromise) {
    quickJSModulePromise = newQuickJSWASMModule();
  }
  return quickJSModulePromise;
}

export interface SandboxOrderSignal {
  action: 'BUY' | 'SELL' | 'CLOSE' | 'MODIFY';
  size?: number;
  sl?: number;
  tp?: number;
  ticket?: number;
  comment?: string;
  barIndex: number;
  time: number;
}

export interface QuickJSSandboxOptions {
  memoryLimitBytes?: number;
  barTimeoutMs?: number;
  isCancelled?: () => boolean;
}

export class QuickJSStrategySandbox {
  private QuickJS: QuickJSWASMModule;
  private memoryLimitBytes: number;
  private barTimeoutMs: number;
  private isCancelled?: () => boolean;

  constructor(QuickJS: QuickJSWASMModule, options?: QuickJSSandboxOptions) {
    this.QuickJS = QuickJS;
    const envMemoryMb = typeof process !== 'undefined' && process.env?.SANDBOX_MEMORY_MB ? parseInt(process.env.SANDBOX_MEMORY_MB, 10) : 32;
    const envTimeoutMs = typeof process !== 'undefined' && process.env?.SANDBOX_BAR_TIMEOUT_MS ? parseInt(process.env.SANDBOX_BAR_TIMEOUT_MS, 10) : 50;
    this.memoryLimitBytes = options?.memoryLimitBytes ?? envMemoryMb * 1024 * 1024;
    this.barTimeoutMs = options?.barTimeoutMs ?? envTimeoutMs;
    this.isCancelled = options?.isCancelled;
  }

  /**
   * Runs the strategy over a sequence of candles with zero lookahead,
   * compiles the strategy ONCE, then calls a persistent onBar dispatcher per bar.
   * Injects indicator helpers (SMA, EMA, RSI, ATR, Donchian, Bollinger, crossover).
   */
  public async executeBacktest(
    jsCode: string,
    candles: Candle[],
    params: Record<string, any>,
    accountState: { balance: number; equity: number; openPositions: any[] },
    onSignal: (signal: SandboxOrderSignal) => void
  ): Promise<{ executedBars: number; totalSignals: number; executionTimeMs: number }> {
    const startTime = Date.now();
    let executedBars = 0;
    let totalSignals = 0;

    const vm = this.QuickJS.newContext();
    const runtime = vm.runtime;
    runtime.setMemoryLimit(this.memoryLimitBytes);

    let currentBarDeadline = 0;
    runtime.setInterruptHandler(() => {
      if (this.isCancelled && this.isCancelled()) {
        return true;
      }
      if (currentBarDeadline > 0 && Date.now() > currentBarDeadline) {
        return true;
      }
      return false;
    });

    const activeHandles: any[] = [];
    let currentBarIndex = 0;

    try {
      // 1. Order execution host functions
      const buyHandle = vm.newFunction('host_buy', (sizeHandle, slHandle, tpHandle, commentHandle) => {
        const size = vm.dump(sizeHandle);
        const sl = vm.dump(slHandle);
        const tp = vm.dump(tpHandle);
        const comment = vm.dump(commentHandle);

        const currentCandle = candles[currentBarIndex];
        const signal: SandboxOrderSignal = {
          action: 'BUY',
          size: typeof size === 'number' ? size : 0.1,
          sl: typeof sl === 'number' ? sl : undefined,
          tp: typeof tp === 'number' ? tp : undefined,
          ticket: undefined,
          comment: typeof comment === 'string' ? comment : undefined,
          barIndex: currentBarIndex,
          time: currentCandle ? currentCandle.time : Date.now() / 1000,
        };
        totalSignals++;
        onSignal(signal);
        return vm.undefined;
      });
      activeHandles.push(buyHandle);
      vm.setProp(vm.global, 'host_buy', buyHandle);

      const sellHandle = vm.newFunction('host_sell', (sizeHandle, slHandle, tpHandle, commentHandle) => {
        const size = vm.dump(sizeHandle);
        const sl = vm.dump(slHandle);
        const tp = vm.dump(tpHandle);
        const comment = vm.dump(commentHandle);

        const currentCandle = candles[currentBarIndex];
        const signal: SandboxOrderSignal = {
          action: 'SELL',
          size: typeof size === 'number' ? size : 0.1,
          sl: typeof sl === 'number' ? sl : undefined,
          tp: typeof tp === 'number' ? tp : undefined,
          ticket: undefined,
          comment: typeof comment === 'string' ? comment : undefined,
          barIndex: currentBarIndex,
          time: currentCandle ? currentCandle.time : Date.now() / 1000,
        };
        totalSignals++;
        onSignal(signal);
        return vm.undefined;
      });
      activeHandles.push(sellHandle);
      vm.setProp(vm.global, 'host_sell', sellHandle);

      const closeHandle = vm.newFunction('host_close', (ticketHandle) => {
        const ticket = vm.dump(ticketHandle);
        const currentCandle = candles[currentBarIndex];
        const signal: SandboxOrderSignal = {
          action: 'CLOSE',
          ticket: typeof ticket === 'number' ? ticket : undefined,
          barIndex: currentBarIndex,
          time: currentCandle ? currentCandle.time : Date.now() / 1000,
        };
        totalSignals++;
        onSignal(signal);
        return vm.undefined;
      });
      activeHandles.push(closeHandle);
      vm.setProp(vm.global, 'host_close', closeHandle);

      const modifyHandle = vm.newFunction('host_modify', (ticketHandle, slHandle, tpHandle) => {
        const ticket = vm.dump(ticketHandle);
        const sl = vm.dump(slHandle);
        const tp = vm.dump(tpHandle);
        const currentCandle = candles[currentBarIndex];
        const signal: SandboxOrderSignal = {
          action: 'MODIFY',
          ticket: typeof ticket === 'number' ? ticket : undefined,
          sl: typeof sl === 'number' ? sl : undefined,
          tp: typeof tp === 'number' ? tp : undefined,
          barIndex: currentBarIndex,
          time: currentCandle ? currentCandle.time : Date.now() / 1000,
        };
        totalSignals++;
        onSignal(signal);
        return vm.undefined;
      });
      activeHandles.push(modifyHandle);
      vm.setProp(vm.global, 'host_modify', modifyHandle);

      // 2. Bounds-checked getBar(index) - enforces zero lookahead
      const getBarHandle = vm.newFunction('host_get_bar', (idxHandle) => {
        const idx = vm.dump(idxHandle);
        if (typeof idx !== 'number' || idx < 0 || idx > currentBarIndex) {
          return vm.undefined;
        }
        const b = candles[idx];
        if (!b) return vm.undefined;

        const barObj = vm.newObject();
        vm.setProp(barObj, 'time', vm.newNumber(b.time));
        vm.setProp(barObj, 'open', vm.newNumber(b.open));
        vm.setProp(barObj, 'high', vm.newNumber(b.high));
        vm.setProp(barObj, 'low', vm.newNumber(b.low));
        vm.setProp(barObj, 'close', vm.newNumber(b.close));
        vm.setProp(barObj, 'tickVolume', vm.newNumber(b.tickVolume || 0));
        vm.setProp(barObj, 'spread', vm.newNumber(b.spread || 0));
        return barObj;
      });
      activeHandles.push(getBarHandle);
      vm.setProp(vm.global, 'host_get_bar', getBarHandle);

      // 3. Indicator helper: host_sma(period, offset)
      const smaHandle = vm.newFunction('host_sma', (pHandle, offsetHandle) => {
        const period = vm.dump(pHandle) || 14;
        const offset = vm.dump(offsetHandle) || 0;
        const targetIdx = currentBarIndex - offset;
        if (targetIdx < period - 1 || targetIdx < 0) return vm.null;

        let sum = 0;
        for (let j = targetIdx - period + 1; j <= targetIdx; j++) {
          sum += candles[j].close;
        }
        return vm.newNumber(sum / period);
      });
      activeHandles.push(smaHandle);
      vm.setProp(vm.global, 'host_sma', smaHandle);

      // 4. Indicator helper: host_ema(period, offset)
      const emaHandle = vm.newFunction('host_ema', (pHandle, offsetHandle) => {
        const period = vm.dump(pHandle) || 14;
        const offset = vm.dump(offsetHandle) || 0;
        const targetIdx = currentBarIndex - offset;
        if (targetIdx < period - 1 || targetIdx < 0) return vm.null;

        const k = 2 / (period + 1);
        let ema = candles[0].close;
        for (let j = 1; j <= targetIdx; j++) {
          ema = candles[j].close * k + ema * (1 - k);
        }
        return vm.newNumber(ema);
      });
      activeHandles.push(emaHandle);
      vm.setProp(vm.global, 'host_ema', emaHandle);

      // 5. Indicator helper: host_rsi(period, offset)
      const rsiHandle = vm.newFunction('host_rsi', (pHandle, offsetHandle) => {
        const period = vm.dump(pHandle) || 14;
        const offset = vm.dump(offsetHandle) || 0;
        const targetIdx = currentBarIndex - offset;
        if (targetIdx < period || targetIdx < 0) return vm.null;

        let gains = 0;
        let losses = 0;
        for (let j = targetIdx - period + 1; j <= targetIdx; j++) {
          const diff = candles[j].close - candles[j - 1].close;
          if (diff >= 0) gains += diff;
          else losses += Math.abs(diff);
        }
        if (losses === 0) return vm.newNumber(100);
        const rs = gains / losses;
        return vm.newNumber(100 - 100 / (1 + rs));
      });
      activeHandles.push(rsiHandle);
      vm.setProp(vm.global, 'host_rsi', rsiHandle);

      // 6. Indicator helper: host_atr(period, offset)
      const atrHandle = vm.newFunction('host_atr', (pHandle, offsetHandle) => {
        const period = vm.dump(pHandle) || 14;
        const offset = vm.dump(offsetHandle) || 0;
        const targetIdx = currentBarIndex - offset;
        if (targetIdx < period || targetIdx <= 0) return vm.null;

        let sumTr = 0;
        for (let j = targetIdx - period + 1; j <= targetIdx; j++) {
          const c = candles[j];
          const prevC = candles[j - 1];
          const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
          sumTr += tr;
        }
        return vm.newNumber(sumTr / period);
      });
      activeHandles.push(atrHandle);
      vm.setProp(vm.global, 'host_atr', atrHandle);

      // 7. Indicator helper: host_donchian(period, offset)
      const donchianHandle = vm.newFunction('host_donchian', (pHandle, offsetHandle) => {
        const period = vm.dump(pHandle) || 20;
        const offset = vm.dump(offsetHandle) || 0;
        const targetIdx = currentBarIndex - offset;
        if (targetIdx < period || targetIdx <= 0) return vm.null;

        let maxH = -Infinity;
        let minL = Infinity;
        for (let j = targetIdx - period; j < targetIdx; j++) {
          if (candles[j].high > maxH) maxH = candles[j].high;
          if (candles[j].low < minL) minL = candles[j].low;
        }
        const obj = vm.newObject();
        vm.setProp(obj, 'high', vm.newNumber(maxH));
        vm.setProp(obj, 'low', vm.newNumber(minL));
        vm.setProp(obj, 'middle', vm.newNumber((maxH + minL) / 2));
        return obj;
      });
      activeHandles.push(donchianHandle);
      vm.setProp(vm.global, 'host_donchian', donchianHandle);

      // 8. Indicator helper: host_bollinger(period, stdDev, offset)
      const bollingerHandle = vm.newFunction('host_bollinger', (pHandle, stdHandle, offsetHandle) => {
        const period = vm.dump(pHandle) || 20;
        const stdDevMult = vm.dump(stdHandle) || 2.0;
        const offset = vm.dump(offsetHandle) || 0;
        const targetIdx = currentBarIndex - offset;
        if (targetIdx < period - 1 || targetIdx < 0) return vm.null;

        let sum = 0;
        for (let j = targetIdx - period + 1; j <= targetIdx; j++) {
          sum += candles[j].close;
        }
        const mean = sum / period;
        let varianceSum = 0;
        for (let j = targetIdx - period + 1; j <= targetIdx; j++) {
          varianceSum += Math.pow(candles[j].close - mean, 2);
        }
        const stdDev = Math.sqrt(varianceSum / period);

        const obj = vm.newObject();
        vm.setProp(obj, 'middle', vm.newNumber(mean));
        vm.setProp(obj, 'upper', vm.newNumber(mean + stdDevMult * stdDev));
        vm.setProp(obj, 'lower', vm.newNumber(mean - stdDevMult * stdDev));
        return obj;
      });
      activeHandles.push(bollingerHandle);
      vm.setProp(vm.global, 'host_bollinger', bollingerHandle);

      // 9. Indicator helper: host_crossover(c1, c2, p1, p2)
      const crossHandle = vm.newFunction('host_crossover', (c1H, c2H, p1H, p2H) => {
        const c1 = vm.dump(c1H);
        const c2 = vm.dump(c2H);
        const p1 = vm.dump(p1H);
        const p2 = vm.dump(p2H);
        return vm.newNumber((p1 <= p2 && c1 > c2) ? 1 : 0);
      });
      activeHandles.push(crossHandle);
      vm.setProp(vm.global, 'host_crossover', crossHandle);

      // 10. Compile the strategy ONCE and register the persistent onBar dispatcher
      const harnessCode = `
        var module = { exports: {} };
        var exports = module.exports;
        ${jsCode}
        var __strategy = (module.exports && module.exports.strategy) || (exports && exports.strategy) || (typeof strategy !== 'undefined' ? strategy : null);
        if (!__strategy) {
          throw new Error("Strategy object not found in exports. Please export 'const strategy = {...}'.");
        }
        if (typeof __strategy.onBar !== 'function') {
          throw new Error("Strategy must define an onBar(ctx, bar) function.");
        }

        var __currentBarIndex = 0;
        var __ctx = {
          params: ${JSON.stringify(params)},
          warmupPeriod: 20,
          barIndex: 0,
          currentBar: null,
          balance: ${accountState.balance},
          equity: ${accountState.equity},
          accountBalance: ${accountState.balance},
          accountEquity: ${accountState.equity},
          openPositions: Object.freeze([]),
          data: new Proxy([], {
            get(target, prop) {
              if (prop === 'length') return __currentBarIndex + 1;
              var n = Number(prop);
              if (!isNaN(n)) {
                if (n > __currentBarIndex) {
                  throw new Error("CANARY_LOOKAHEAD_VIOLATION: Attempted access to future bar index " + n + " while on bar " + __currentBarIndex);
                }
                return host_get_bar(n);
              }
              return target[prop];
            }
          }),
          buy: function(size, sl, tp, comment) { host_buy(size, sl, tp, comment); },
          sell: function(size, sl, tp, comment) { host_sell(size, sl, tp, comment); },
          close: function(ticket) { host_close(ticket); },
          modify: function(ticket, sl, tp) { host_modify(ticket, sl, tp); },
          sma: function(period, offset) { return host_sma(period, offset || 0); },
          ema: function(period, offset) { return host_ema(period, offset || 0); },
          rsi: function(period, offset) { return host_rsi(period, offset || 0); },
          atr: function(period, offset) { return host_atr(period, offset || 0); },
          donchian: function(period, offset) { return host_donchian(period, offset || 0); },
          bollinger: function(period, stdDev, offset) { return host_bollinger(period, stdDev || 2.0, offset || 0); },
          crossover: function(c1, c2, p1, p2) { return host_crossover(c1, c2, p1, p2) === 1; }
        };

        if (__strategy.init) {
          __strategy.init(__ctx);
        }

        var __onBarFn = __strategy.onBar;

        function __dispatchBar(idx, bal, eq, posJson) {
          __currentBarIndex = idx;
          var bar = host_get_bar(idx);
          if (!bar) return;
          __ctx.barIndex = idx;
          __ctx.currentBar = bar;
          __ctx.balance = bal;
          __ctx.equity = eq;
          __ctx.accountBalance = bal;
          __ctx.accountEquity = eq;
          try {
            var parsed = JSON.parse(posJson);
            __ctx.openPositions = Object.freeze(Array.isArray(parsed) ? parsed.map(function(p) { return Object.freeze(p); }) : []);
          } catch(e) {
            __ctx.openPositions = Object.freeze([]);
          }
          __onBarFn(__ctx, bar);
        }
      `;

      currentBarDeadline = Date.now() + 3000;
      const compileRes = vm.evalCode(harnessCode);
      if (compileRes.error) {
        const errorMsg = vm.dump(compileRes.error);
        compileRes.error.dispose();
        const errStr = typeof errorMsg === 'string' ? errorMsg : (errorMsg?.message || JSON.stringify(errorMsg));
        throw new Error(`Strategy compilation error: ${errStr}`);
      }
      compileRes.value.dispose();

      // 11. Execute persistent onBar dispatcher over all bars
      const totalCandles = candles.length;
      for (let i = 0; i < totalCandles; i++) {
        // Cancellation check
        if (this.isCancelled && this.isCancelled()) {
          throw new Error('JOB_CANCELLED');
        }

        currentBarIndex = i;
        currentBarDeadline = Date.now() + this.barTimeoutMs;

        const posJson = JSON.stringify(accountState.openPositions || []);
        const dispatchCode = `__dispatchBar(${i}, ${accountState.balance}, ${accountState.equity}, ${JSON.stringify(posJson)})`;

        const barRes = vm.evalCode(dispatchCode);
        if (barRes.error) {
          const errorMsg = vm.dump(barRes.error);
          barRes.error.dispose();
          const errStr = typeof errorMsg === 'string' ? errorMsg : (errorMsg?.message || JSON.stringify(errorMsg));
          throw new Error(`Error on bar ${i}: ${errStr}`);
        }
        barRes.value.dispose();
        executedBars++;
      }
    } finally {
      currentBarDeadline = 0;
      for (const h of activeHandles) {
        try {
          if (h && typeof h.dispose === 'function') h.dispose();
        } catch (_) {}
      }
      try {
        vm.dispose();
      } catch (_) {}
    }

    return {
      executedBars,
      totalSignals,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Creates a synchronous strategy executor for runBacktest using QuickJS.
 * Compiles the strategy code ONCE into a persistent context and calls onBar per bar.
 */
export function createQuickJSStrategyExecutor(
  QuickJS: QuickJSWASMModule,
  jsCode: string,
  params: Record<string, any>,
  options?: { isCancelled?: () => boolean; barTimeoutMs?: number; memoryLimitBytes?: number }
): {
  strategyLogic: (ctx: any, p: Record<string, any>) => void;
  dispose: () => void;
} {
  const envMemoryMb = typeof process !== 'undefined' && process.env?.SANDBOX_MEMORY_MB ? parseInt(process.env.SANDBOX_MEMORY_MB, 10) : 32;
  const envTimeoutMs = typeof process !== 'undefined' && process.env?.SANDBOX_BAR_TIMEOUT_MS ? parseInt(process.env.SANDBOX_BAR_TIMEOUT_MS, 10) : 50;
  const memoryLimitBytes = options?.memoryLimitBytes ?? envMemoryMb * 1024 * 1024;
  const barTimeoutMs = options?.barTimeoutMs ?? envTimeoutMs;
  const isCancelled = options?.isCancelled;

  const vm = QuickJS.newContext();
  const runtime = vm.runtime;
  runtime.setMemoryLimit(memoryLimitBytes);

  let currentBarDeadline = 0;
  runtime.setInterruptHandler(() => {
    if (isCancelled && isCancelled()) {
      return true;
    }
    if (currentBarDeadline > 0 && Date.now() > currentBarDeadline) {
      return true;
    }
    return false;
  });

  const activeHandles: any[] = [];
  let currentCtx: any = null;

  // 1. Host Order Functions bound directly to current backtester ctx
  const buyHandle = vm.newFunction('host_buy', (sizeHandle, slHandle, tpHandle, commentHandle) => {
    if (!currentCtx) return vm.undefined;
    const size = vm.dump(sizeHandle);
    const sl = vm.dump(slHandle);
    const tp = vm.dump(tpHandle);
    const comment = vm.dump(commentHandle);
    currentCtx.buy(
      typeof size === 'number' ? size : undefined,
      typeof sl === 'number' ? sl : undefined,
      typeof tp === 'number' ? tp : undefined,
      typeof comment === 'string' ? comment : undefined
    );
    return vm.undefined;
  });
  activeHandles.push(buyHandle);
  vm.setProp(vm.global, 'host_buy', buyHandle);

  const sellHandle = vm.newFunction('host_sell', (sizeHandle, slHandle, tpHandle, commentHandle) => {
    if (!currentCtx) return vm.undefined;
    const size = vm.dump(sizeHandle);
    const sl = vm.dump(slHandle);
    const tp = vm.dump(tpHandle);
    const comment = vm.dump(commentHandle);
    currentCtx.sell(
      typeof size === 'number' ? size : undefined,
      typeof sl === 'number' ? sl : undefined,
      typeof tp === 'number' ? tp : undefined,
      typeof comment === 'string' ? comment : undefined
    );
    return vm.undefined;
  });
  activeHandles.push(sellHandle);
  vm.setProp(vm.global, 'host_sell', sellHandle);

  const closeHandle = vm.newFunction('host_close', (ticketHandle) => {
    if (!currentCtx) return vm.undefined;
    const ticket = vm.dump(ticketHandle);
    currentCtx.close(typeof ticket === 'number' ? ticket : undefined);
    return vm.undefined;
  });
  activeHandles.push(closeHandle);
  vm.setProp(vm.global, 'host_close', closeHandle);

  const modifyHandle = vm.newFunction('host_modify', (ticketHandle, slHandle, tpHandle) => {
    if (!currentCtx) return vm.undefined;
    const ticket = vm.dump(ticketHandle);
    const sl = vm.dump(slHandle);
    const tp = vm.dump(tpHandle);
    if (typeof ticket === 'number') {
      currentCtx.modify(ticket, typeof sl === 'number' ? sl : undefined, typeof tp === 'number' ? tp : undefined);
    }
    return vm.undefined;
  });
  activeHandles.push(modifyHandle);
  vm.setProp(vm.global, 'host_modify', modifyHandle);

  // 2. host_get_bar
  const getBarHandle = vm.newFunction('host_get_bar', (idxHandle) => {
    if (!currentCtx) return vm.undefined;
    const idx = vm.dump(idxHandle);
    if (typeof idx !== 'number' || idx < 0 || idx > currentCtx.barIndex) {
      return vm.undefined;
    }
    const b = currentCtx.data[idx];
    if (!b) return vm.undefined;
    const barObj = vm.newObject();
    vm.setProp(barObj, 'time', vm.newNumber(b.time));
    vm.setProp(barObj, 'open', vm.newNumber(b.open));
    vm.setProp(barObj, 'high', vm.newNumber(b.high));
    vm.setProp(barObj, 'low', vm.newNumber(b.low));
    vm.setProp(barObj, 'close', vm.newNumber(b.close));
    vm.setProp(barObj, 'tickVolume', vm.newNumber(b.tickVolume || 0));
    vm.setProp(barObj, 'spread', vm.newNumber(b.spread || 0));
    return barObj;
  });
  activeHandles.push(getBarHandle);
  vm.setProp(vm.global, 'host_get_bar', getBarHandle);

  // Indicator host functions
  const smaHandle = vm.newFunction('host_sma', (pHandle, offsetHandle) => {
    if (!currentCtx) return vm.null;
    const val = currentCtx.sma ? currentCtx.sma(vm.dump(pHandle) || 14, vm.dump(offsetHandle) || 0) : null;
    return val !== null && !isNaN(val) ? vm.newNumber(val) : vm.null;
  });
  activeHandles.push(smaHandle);
  vm.setProp(vm.global, 'host_sma', smaHandle);

  const emaHandle = vm.newFunction('host_ema', (pHandle, offsetHandle) => {
    if (!currentCtx) return vm.null;
    const val = currentCtx.ema ? currentCtx.ema(vm.dump(pHandle) || 14, vm.dump(offsetHandle) || 0) : null;
    return val !== null && !isNaN(val) ? vm.newNumber(val) : vm.null;
  });
  activeHandles.push(emaHandle);
  vm.setProp(vm.global, 'host_ema', emaHandle);

  const rsiHandle = vm.newFunction('host_rsi', (pHandle, offsetHandle) => {
    if (!currentCtx) return vm.null;
    const val = currentCtx.rsi ? currentCtx.rsi(vm.dump(pHandle) || 14, vm.dump(offsetHandle) || 0) : null;
    return val !== null && !isNaN(val) ? vm.newNumber(val) : vm.null;
  });
  activeHandles.push(rsiHandle);
  vm.setProp(vm.global, 'host_rsi', rsiHandle);

  const atrHandle = vm.newFunction('host_atr', (pHandle, offsetHandle) => {
    if (!currentCtx) return vm.null;
    const val = currentCtx.atr ? currentCtx.atr(vm.dump(pHandle) || 14, vm.dump(offsetHandle) || 0) : null;
    return val !== null && !isNaN(val) ? vm.newNumber(val) : vm.null;
  });
  activeHandles.push(atrHandle);
  vm.setProp(vm.global, 'host_atr', atrHandle);

  const donchianHandle = vm.newFunction('host_donchian', (pHandle, offsetHandle) => {
    if (!currentCtx) return vm.null;
    const res = currentCtx.donchian ? currentCtx.donchian(vm.dump(pHandle) || 20, vm.dump(offsetHandle) || 0) : null;
    if (!res) return vm.null;
    const obj = vm.newObject();
    vm.setProp(obj, 'high', vm.newNumber(res.high));
    vm.setProp(obj, 'low', vm.newNumber(res.low));
    vm.setProp(obj, 'middle', vm.newNumber(res.middle));
    return obj;
  });
  activeHandles.push(donchianHandle);
  vm.setProp(vm.global, 'host_donchian', donchianHandle);

  const bollingerHandle = vm.newFunction('host_bollinger', (pHandle, stdHandle, offsetHandle) => {
    if (!currentCtx) return vm.null;
    const res = currentCtx.bollinger ? currentCtx.bollinger(vm.dump(pHandle) || 20, vm.dump(stdHandle) || 2.0, vm.dump(offsetHandle) || 0) : null;
    if (!res) return vm.null;
    const obj = vm.newObject();
    vm.setProp(obj, 'middle', vm.newNumber(res.middle));
    vm.setProp(obj, 'upper', vm.newNumber(res.upper));
    vm.setProp(obj, 'lower', vm.newNumber(res.lower));
    return obj;
  });
  activeHandles.push(bollingerHandle);
  vm.setProp(vm.global, 'host_bollinger', bollingerHandle);

  const crossHandle = vm.newFunction('host_crossover', (c1H, c2H, p1H, p2H) => {
    const c1 = vm.dump(c1H);
    const c2 = vm.dump(c2H);
    const p1 = vm.dump(p1H);
    const p2 = vm.dump(p2H);
    return vm.newNumber((p1 <= p2 && c1 > c2) ? 1 : 0);
  });
  activeHandles.push(crossHandle);
  vm.setProp(vm.global, 'host_crossover', crossHandle);

  // Compile ONCE
  const harnessCode = `
    var module = { exports: {} };
    var exports = module.exports;
    ${jsCode}
    var __strategy = (module.exports && module.exports.strategy) || (exports && exports.strategy) || (typeof strategy !== 'undefined' ? strategy : null);
    if (!__strategy) {
      throw new Error("Strategy object not found in exports. Please export 'const strategy = {...}'.");
    }
    if (typeof __strategy.onBar !== 'function') {
      throw new Error("Strategy must define an onBar(ctx, bar) function.");
    }

    var __currentBarIndex = 0;
    var __ctx = {
      params: ${JSON.stringify(params)},
      warmupPeriod: 20,
      barIndex: 0,
      currentBar: null,
      balance: 10000,
      equity: 10000,
      accountBalance: 10000,
      accountEquity: 10000,
      openPositions: Object.freeze([]),
      data: new Proxy([], {
        get(target, prop) {
          if (prop === 'length') return __currentBarIndex + 1;
          var n = Number(prop);
          if (!isNaN(n)) {
            if (n > __currentBarIndex) {
              throw new Error("CANARY_LOOKAHEAD_VIOLATION: Attempted access to future bar index " + n + " while on bar " + __currentBarIndex);
            }
            return host_get_bar(n);
          }
          return target[prop];
        }
      }),
      buy: function(size, sl, tp, comment) { host_buy(size, sl, tp, comment); },
      sell: function(size, sl, tp, comment) { host_sell(size, sl, tp, comment); },
      close: function(ticket) { host_close(ticket); },
      modify: function(ticket, sl, tp) { host_modify(ticket, sl, tp); },
      sma: function(period, offset) { return host_sma(period, offset || 0); },
      ema: function(period, offset) { return host_ema(period, offset || 0); },
      rsi: function(period, offset) { return host_rsi(period, offset || 0); },
      atr: function(period, offset) { return host_atr(period, offset || 0); },
      donchian: function(period, offset) { return host_donchian(period, offset || 0); },
      bollinger: function(period, stdDev, offset) { return host_bollinger(period, stdDev || 2.0, offset || 0); },
      crossover: function(c1, c2, p1, p2) { return host_crossover(c1, c2, p1, p2) === 1; }
    };

    if (__strategy.init) {
      __strategy.init(__ctx);
    }

    var __onBarFn = __strategy.onBar;

    function __dispatchBar(idx, bal, eq, posJson) {
      __currentBarIndex = idx;
      var bar = host_get_bar(idx);
      if (!bar) return;
      __ctx.barIndex = idx;
      __ctx.currentBar = bar;
      __ctx.balance = bal;
      __ctx.equity = eq;
      __ctx.accountBalance = bal;
      __ctx.accountEquity = eq;
      try {
        var parsed = JSON.parse(posJson);
        __ctx.openPositions = Object.freeze(Array.isArray(parsed) ? parsed.map(function(p) { return Object.freeze(p); }) : []);
      } catch(e) {
        __ctx.openPositions = Object.freeze([]);
      }
      __onBarFn(__ctx, bar);
    }
  `;

  currentBarDeadline = Date.now() + 3000;
  const compileRes = vm.evalCode(harnessCode);
  if (compileRes.error) {
    const errorMsg = vm.dump(compileRes.error);
    compileRes.error.dispose();
    const errStr = typeof errorMsg === 'string' ? errorMsg : (errorMsg?.message || JSON.stringify(errorMsg));
    vm.dispose();
    throw new Error(`Strategy compilation error: ${errStr}`);
  }
  compileRes.value.dispose();

  return {
    strategyLogic: (ctx: any, _params: Record<string, any>) => {
      currentCtx = ctx;
      currentBarDeadline = Date.now() + barTimeoutMs;
      const posJson = JSON.stringify(ctx.openPositions || []);
      const dispatchCode = `__dispatchBar(${ctx.barIndex}, ${ctx.accountBalance}, ${ctx.accountEquity}, ${JSON.stringify(posJson)})`;
      const res = vm.evalCode(dispatchCode);
      if (res.error) {
        const errorMsg = vm.dump(res.error);
        res.error.dispose();
        const errStr = typeof errorMsg === 'string' ? errorMsg : (errorMsg?.message || JSON.stringify(errorMsg));
        throw new Error(`Execution error on bar ${ctx.barIndex}: ${errStr}`);
      }
      res.value.dispose();
    },
    dispose: () => {
      currentBarDeadline = 0;
      for (const h of activeHandles) {
        try {
          if (h && typeof h.dispose === 'function') h.dispose();
        } catch (_) {}
      }
      try {
        vm.dispose();
      } catch (_) {}
    },
  };
}
