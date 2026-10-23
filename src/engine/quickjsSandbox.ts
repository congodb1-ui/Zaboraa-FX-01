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
}

export class QuickJSStrategySandbox {
  private QuickJS: QuickJSWASMModule;
  private memoryLimitBytes: number;
  private barTimeoutMs: number;

  constructor(QuickJS: QuickJSWASMModule, options?: QuickJSSandboxOptions) {
    this.QuickJS = QuickJS;
    const envMemoryMb = process.env.SANDBOX_MEMORY_MB ? parseInt(process.env.SANDBOX_MEMORY_MB, 10) : 32;
    const envTimeoutMs = process.env.SANDBOX_BAR_TIMEOUT_MS ? parseInt(process.env.SANDBOX_BAR_TIMEOUT_MS, 10) : 50;
    this.memoryLimitBytes = options?.memoryLimitBytes ?? envMemoryMb * 1024 * 1024;
    this.barTimeoutMs = options?.barTimeoutMs ?? envTimeoutMs;
  }

  /**
   * Runs the strategy over a sequence of candles with zero lookahead,
   * fresh VM per run, strictly bound host functions, and handle cleanup.
   */
  public async executeBacktest(
    jsCode: string,
    candles: Candle[],
    params: Record<string, any>,
    accountState: { balance: number; equity: number; openPositions: Position[] },
    onSignal: (signal: SandboxOrderSignal) => void
  ): Promise<{ executedBars: number; totalSignals: number; executionTimeMs: number }> {
    const startTime = Date.now();
    let executedBars = 0;
    let totalSignals = 0;

    // Create fresh VM context for this run
    const vm = this.QuickJS.newContext();
    const runtime = vm.runtime;
    runtime.setMemoryLimit(this.memoryLimitBytes);

    let currentBarDeadline = 0;
    runtime.setInterruptHandler(() => {
      if (currentBarDeadline > 0 && Date.now() > currentBarDeadline) {
        return true; // Interrupt and terminate execution
      }
      return false;
    });

    const activeHandles: any[] = [];
    let currentBarIndex = 0;

    try {
      // Expose whitelisted host function: host_buy(size, sl, tp, comment)
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

      // Expose whitelisted host function: host_sell(size, sl, tp, comment)
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

      // Expose whitelisted host function: host_close(ticket)
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

      // Expose whitelisted host function: host_modify(ticket, sl, tp)
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

      // BOUNDS-CHECKED getBar(index): strictly enforces that code cannot read future bars (no lookahead)
      const getBarHandle = vm.newFunction('host_get_bar', (idxHandle) => {
        const idx = vm.dump(idxHandle);
        if (typeof idx !== 'number' || idx < 0 || idx > currentBarIndex) {
          // CANARY / LOOKAHEAD TRAP: Attempting to read index > currentBarIndex returns undefined or throws
          return vm.undefined;
        }
        const b = candles[idx];
        if (!b) return vm.undefined;

        // Return a fresh bar object to QuickJS
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

      // Evaluate the user's transpiled JavaScript strategy code
      // We wrap the code so module.exports captures `strategy`
      const harnessCode = `
        var module = { exports: {} };
        var exports = module.exports;
        ${jsCode}
        var __strategy = (module.exports && module.exports.strategy) || (exports && exports.strategy) || (typeof strategy !== 'undefined' ? strategy : null);
        if (!__strategy) {
          throw new Error("Strategy object not found in exports. Please export 'const strategy = {...}'.");
        }
      `;

      currentBarDeadline = Date.now() + 2000; // 2s initialization deadline
      const compileRes = vm.evalCode(harnessCode);
      if (compileRes.error) {
        const errorMsg = vm.dump(compileRes.error);
        compileRes.error.dispose();
        const errStr = typeof errorMsg === 'string' ? errorMsg : (errorMsg?.message || JSON.stringify(errorMsg));
        throw new Error(`Strategy evaluation error: ${errStr}`);
      }
      compileRes.value.dispose();

      // Initialize strategy if init exists
      const initCode = `
        var __ctx = {
          params: ${JSON.stringify(params)},
          warmupPeriod: 20,
          accountBalance: ${accountState.balance},
          accountEquity: ${accountState.equity},
        };
        if (__strategy.init) {
          __strategy.init(__ctx);
        }
      `;
      currentBarDeadline = Date.now() + 1000;
      const initRes = vm.evalCode(initCode);
      if (initRes.error) {
        const errorMsg = vm.dump(initRes.error);
        initRes.error.dispose();
        throw new Error(`Strategy init error: ${JSON.stringify(errorMsg)}`);
      }
      initRes.value.dispose();

      // Step through each bar: ONLY bars up to currentBarIndex are accessible
      const totalCandles = candles.length;
      for (let i = 0; i < totalCandles; i++) {
        currentBarIndex = i;
        const currentBar = candles[i];

        // Prepare bar dispatch in QuickJS
        // Note: ctx.data is proxied via host_get_bar with bounds checking
        const onBarCall = `
          (function() {
            var bar = host_get_bar(${i});
            if (!bar) return;
            var barCtx = {
              barIndex: ${i},
              currentBar: bar,
              params: __ctx.params,
              accountBalance: __ctx.accountBalance,
              accountEquity: __ctx.accountEquity,
              data: new Proxy([], {
                get(target, prop) {
                  if (prop === 'length') return ${i + 1};
                  var n = Number(prop);
                  if (!isNaN(n)) {
                    if (n > ${i}) {
                      throw new Error("CANARY_LOOKAHEAD_VIOLATION: Attempted access to future bar index " + n + " while on bar " + ${i});
                    }
                    return host_get_bar(n);
                  }
                  return target[prop];
                }
              }),
              buy: function(size, sl, tp, comment) { host_buy(size, sl, tp, comment); },
              sell: function(size, sl, tp, comment) { host_sell(size, sl, tp, comment); },
              close: function(ticket) { host_close(ticket); },
              modify: function(ticket, sl, tp) { host_modify(ticket, sl, tp); }
            };
            if (__strategy.onBar) {
              __strategy.onBar(barCtx, bar);
            }
          })();
        `;

        currentBarDeadline = Date.now() + this.barTimeoutMs;
        const barRes = vm.evalCode(onBarCall);
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
      // Clean up all allocated handles and context
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
