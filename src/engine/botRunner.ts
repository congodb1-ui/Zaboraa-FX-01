import {
  Bot,
  Candle,
  SymbolName,
  Timeframe,
  OrderRecord,
  RiskSettings,
  Position,
} from '../types/forex';
import {
  getDb,
  getAllBots,
  getBotById,
  updateBotStatusDb,
  saveBot,
  logOrderIntent,
  updateOrderStatus,
  insertRiskEvent,
  insertAuditLog,
  getNoNewOrdersFlag,
  getStrategyById,
  consumeLiveToken,
} from '../services/db';
import { hashContent } from '../services/crypto';
import { evaluateOrderRisk, RiskEvaluationContext } from './riskManager';
import { getStrategyExecutor, BUILT_IN_STRATEGIES } from '../services/builtInStrategies';
import { getQuickJS, QuickJSStrategySandbox } from './quickjsSandbox';
import { transpileStrategyCode } from './transpiler';
import { BridgeClient, executeOrderThroughBridge } from '../services/bridgeClient';
import { calculatePipValue, SYMBOL_SPECS } from '../services/marketData';

export interface BotCycleResult {
  botId: string;
  status: 'PROCESSED' | 'SKIPPED' | 'ERROR' | 'HALTED';
  newBarProcessed?: boolean;
  barTime?: number;
  signal?: { action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD'; price: number; reason: string };
  orderResult?: {
    success: boolean;
    orderId?: string;
    ticket?: number;
    status: string;
    error?: string;
  };
  error?: string;
}

export interface BotRunnerConfig {
  riskSettings: RiskSettings;
  bridgeClient?: BridgeClient;
  authoritativeAccountMode?: 'DEMO' | 'REAL' | 'CONTEST';
  reconciliationExecuted: boolean;
  getAccountSnapshot: () => {
    balance: number;
    equity: number;
    peakEquity?: number;
    login: string;
    mode: string;
  };
}

export class BotRunner {
  // Track last evaluated closed-bar timestamp per bot
  private lastEvaluatedBarTimes: Map<string, number> = new Map();
  private config: BotRunnerConfig;

  constructor(config: BotRunnerConfig) {
    this.config = config;
  }

  public updateConfig(newConfig: Partial<BotRunnerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public setLastEvaluatedBar(botId: string, barTime: number): void {
    this.lastEvaluatedBarTimes.set(botId, barTime);
  }

  public getLastEvaluatedBar(botId: string): number | undefined {
    return this.lastEvaluatedBarTimes.get(botId);
  }

  /**
   * Process a closed bar for a specific bot.
   * Handles strategy execution, risk manager gating, and order dispatch.
   * Any strategy failure sets that bot to ERROR without stopping other bots.
   */
  public async evaluateBotOnClosedBar(
    bot: Bot,
    closedCandles: Candle[],
    currentSpreadPips?: number
  ): Promise<BotCycleResult> {
    // 1. Bot must be in RUNNING state
    if (bot.status !== 'RUNNING') {
      return {
        botId: bot.id,
        status: 'SKIPPED',
        error: `Bot is in ${bot.status} state, not RUNNING`,
      };
    }

    // 2. Honour global no_new_orders flag
    if (getNoNewOrdersFlag()) {
      return {
        botId: bot.id,
        status: 'HALTED',
        error: 'Global emergency halt (no_new_orders) is active',
      };
    }

    if (!closedCandles || closedCandles.length === 0) {
      return {
        botId: bot.id,
        status: 'SKIPPED',
        error: 'No candle data available',
      };
    }

    // Identify the latest closed bar
    const latestClosedBar = closedCandles[closedCandles.length - 1];
    const lastProcessedTime = this.lastEvaluatedBarTimes.get(bot.id) || 0;

    // Bar time check (detect each new closed bar from candle data, not wall clock)
    if (latestClosedBar.time <= lastProcessedTime) {
      return {
        botId: bot.id,
        status: 'SKIPPED',
        barTime: latestClosedBar.time,
      };
    }

    let emittedSignal: { action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD'; price: number; reason: string } | null = null;
    let orderParams: { size: number; sl: number; tp?: number; comment?: string } | null = null;

    // 3. Execute Strategy within isolated sandbox or built-in executor
    try {
      const isBuiltIn = BUILT_IN_STRATEGIES.some((s) => s.id === bot.strategyId);

      if (!isBuiltIn) {
        const savedStrat = getStrategyById(bot.strategyId);
        if (savedStrat && savedStrat.strategy.code) {
          // Run custom strategy in QuickJS sandbox with per-bar timeout
          let transpiledJs = savedStrat.transpiledJs;
          if (!transpiledJs) {
            const transpiled = transpileStrategyCode(savedStrat.strategy.code);
            transpiledJs = transpiled.jsCode;
          }

          const quickjs = await getQuickJS();
          const sandbox = new QuickJSStrategySandbox(quickjs, {
            barTimeoutMs: 50,
          });

          const contextSnapshot = {
            balance: this.config.getAccountSnapshot().balance,
            equity: this.config.getAccountSnapshot().equity,
            openPositions: [],
          };

          await sandbox.executeBacktest(
            transpiledJs,
            closedCandles,
            bot.params || {},
            contextSnapshot,
            (signal: any) => {
              if (signal.action === 'BUY' || signal.action === 'SELL') {
                emittedSignal = {
                  action: signal.action,
                  price: signal.price || latestClosedBar.close,
                  reason: signal.comment || 'Custom Strategy Signal',
                };
                orderParams = {
                  size: signal.size || bot.riskLimits.maxLotSize,
                  sl: signal.sl,
                  tp: signal.tp,
                  comment: signal.comment,
                };
              }
            }
          );
        } else {
          throw new Error(`UNKNOWN_STRATEGY: Strategy '${bot.strategyId}' is not registered`);
        }
      } else {
        // Built-in strategy execution
        const builtInExec = getStrategyExecutor(bot.strategyId);
        const ctx: any = {
          data: closedCandles,
          currentBar: latestClosedBar,
          barIndex: closedCandles.length - 1,
          params: bot.params || {},
          openPositions: [],
          accountBalance: this.config.getAccountSnapshot().balance,
          accountEquity: this.config.getAccountSnapshot().equity,
          buy: (size?: number, sl?: number, tp?: number, comment?: string) => {
            emittedSignal = { action: 'BUY', price: latestClosedBar.close, reason: comment || 'Strategy BUY Signal' };
            orderParams = { size: size || bot.riskLimits.maxLotSize, sl: sl || 0, tp, comment };
          },
          sell: (size?: number, sl?: number, tp?: number, comment?: string) => {
            emittedSignal = { action: 'SELL', price: latestClosedBar.close, reason: comment || 'Strategy SELL Signal' };
            orderParams = { size: size || bot.riskLimits.maxLotSize, sl: sl || 0, tp, comment };
          },
          closePosition: () => {},
          modifyPosition: () => {},
        };

        builtInExec(ctx, bot.params || {});
      }

      // Mark this closed bar as evaluated
      this.lastEvaluatedBarTimes.set(bot.id, latestClosedBar.time);
    } catch (strategyErr: any) {
      // Isolate failure: strategy error or timeout puts THIS bot into ERROR state
      updateBotStatusDb(bot.id, 'ERROR');

      insertRiskEvent({
        id: `risk_bot_err_${Date.now()}_${bot.id}`,
        timestamp: new Date().toISOString(),
        actor: 'BotRunner',
        action: 'BOT_STRATEGY_EXCEPTION',
        entity: `Bot ${bot.name} (${bot.id})`,
        details: `Strategy execution threw an exception on bar ${latestClosedBar.time}: ${strategyErr?.message || 'Unknown error'}. Bot placed in ERROR state.`,
        severity: 'CRITICAL',
        status: 'ERROR',
      });

      return {
        botId: bot.id,
        status: 'ERROR',
        barTime: latestClosedBar.time,
        error: strategyErr?.message || 'Strategy execution error',
      };
    }

    if (!emittedSignal || !orderParams) {
      return {
        botId: bot.id,
        status: 'PROCESSED',
        newBarProcessed: true,
        barTime: latestClosedBar.time,
        signal: { action: 'HOLD', price: latestClosedBar.close, reason: 'No signal on closed bar' },
      };
    }

    const targetSignal = emittedSignal as { action: 'BUY' | 'SELL'; price: number; reason: string };
    const targetParams = orderParams as { size: number; sl: number; tp?: number; comment?: string };

    // 4. Evaluate through Risk Manager
    const accountSnap = this.config.getAccountSnapshot();
    const effectiveSpread = currentSpreadPips ?? SYMBOL_SPECS[bot.symbol]?.spreadPips ?? 1.0;

    const riskContext: RiskEvaluationContext = {
      account: {
        balance: accountSnap.balance,
        equity: accountSnap.equity,
        peakEquity: accountSnap.peakEquity,
        login: accountSnap.login,
        mode: accountSnap.mode,
      },
      currentSpreadPips: effectiveSpread,
      evaluationTimeUtc: new Date(latestClosedBar.time * 1000),
    };

    const riskCheck = evaluateOrderRisk(
      {
        symbol: bot.symbol,
        side: targetSignal.action,
        volume: targetParams.size,
        price: targetSignal.price,
        sl: targetParams.sl,
        tp: targetParams.tp,
        botId: bot.id,
      },
      this.config.riskSettings,
      riskContext
    );

    if (!riskCheck.allowed) {
      return {
        botId: bot.id,
        status: 'PROCESSED',
        newBarProcessed: true,
        barTime: latestClosedBar.time,
        signal: targetSignal,
        orderResult: {
          success: false,
          status: 'BLOCKED_BY_RISK_MANAGER',
          error: `[${riskCheck.reasonCode}] ${riskCheck.details}`,
        },
      };
    }

    // 5. Order Route & Idempotency Key
    // Include closed bar time in idempotency key to prevent double executions on the same bar
    const idempotencyKey = hashContent(`${bot.id}:${bot.symbol}:${latestClosedBar.time}:${targetSignal.action}`);
    const orderId = `ord_bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const orderRecord: OrderRecord = {
      id: orderId,
      idempotencyKey,
      botId: bot.id,
      magicNumber: 1001,
      symbol: bot.symbol,
      side: targetSignal.action,
      volume: targetParams.size,
      intentPrice: targetSignal.price,
      sl: targetParams.sl,
      tp: targetParams.tp,
      status: 'PENDING_BROKER',
      comment: targetParams.comment || `zfx_${bot.id}_${latestClosedBar.time}`,
      createdAt: new Date().toISOString(),
    };

    // Attempt to log order intent in SQLite
    try {
      logOrderIntent(orderRecord);
    } catch (err: any) {
      if (err?.message && err.message.includes('UNIQUE constraint failed')) {
        return {
          botId: bot.id,
          status: 'PROCESSED',
          newBarProcessed: true,
          barTime: latestClosedBar.time,
          signal: targetSignal,
          orderResult: {
            success: false,
            status: 'DUPLICATE_ORDER_INTENT',
            error: 'Duplicate order intent on this closed bar timestamp',
          },
        };
      }
      throw err;
    }

    // 6. Dispatch by Bot Mode (PAPER vs DEMO vs LIVE)
    if (bot.mode === 'PAPER') {
      // PAPER mode: Simulated fills at live bridge prices; NEVER calls the bridge order endpoint
      const simFillPrice = targetSignal.price;
      updateOrderStatus(orderId, 'SIMULATED', undefined, simFillPrice, 'PAPER TRADING: simulated fill');

      insertAuditLog({
        id: `aud_paper_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'PaperEngine',
        action: 'ORDER_PAPER_FILLED',
        entity: `${bot.symbol} ${targetSignal.action} ${targetParams.size}L`,
        details: `Simulated fill at ${simFillPrice} on closed bar ${latestClosedBar.time}. Bridge order endpoint was not called.`,
        status: 'SUCCESS',
      });

      return {
        botId: bot.id,
        status: 'PROCESSED',
        newBarProcessed: true,
        barTime: latestClosedBar.time,
        signal: targetSignal,
        orderResult: {
          success: true,
          orderId,
          status: 'SIMULATED',
        },
      };
    }

    if (bot.mode === 'DEMO_LIVE') {
      // DEMO mode: authoritatively verify that broker account is DEMO
      const authorAccountType = this.config.authoritativeAccountMode || 'DEMO';
      if (authorAccountType !== 'DEMO') {
        updateOrderStatus(orderId, 'REJECTED', undefined, undefined, 'DEMO bot refused non-demo account');

        insertRiskEvent({
          id: `risk_demo_refusal_${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: 'BotRunner',
          action: 'DEMO_BOT_REFUSED_NON_DEMO',
          entity: `${bot.symbol} (Bot: ${bot.id})`,
          details: `Refused order: Bot is configured for DEMO_LIVE but authoritative broker account is ${authorAccountType}.`,
          severity: 'CRITICAL',
          status: 'REJECTED',
        });

        return {
          botId: bot.id,
          status: 'PROCESSED',
          newBarProcessed: true,
          barTime: latestClosedBar.time,
          signal: targetSignal,
          orderResult: {
            success: false,
            orderId,
            status: 'REJECTED',
            error: `ACCOUNT_TYPE_MISMATCH: Authoritative broker account is ${authorAccountType}`,
          },
        };
      }

      // If bridge client is configured, dispatch through bridge
      if (this.config.bridgeClient) {
        const execution = await executeOrderThroughBridge(this.config.bridgeClient, orderRecord, {
          botMode: 'DEMO_LIVE',
          accountLogin: accountSnap.login,
          riskLimits: bot.riskLimits,
        });

        return {
          botId: bot.id,
          status: 'PROCESSED',
          newBarProcessed: true,
          barTime: latestClosedBar.time,
          signal: targetSignal,
          orderResult: {
            success: execution.success,
            orderId: execution.order.id,
            ticket: execution.order.ticket,
            status: execution.order.status,
            error: execution.error,
          },
        };
      }

      // Bridge client unconfigured fallback
      updateOrderStatus(orderId, 'SIMULATED', undefined, targetSignal.price, 'SIMULATION: no bridge connected');
      return {
        botId: bot.id,
        status: 'PROCESSED',
        newBarProcessed: true,
        barTime: latestClosedBar.time,
        signal: targetSignal,
        orderResult: {
          success: true,
          orderId,
          status: 'SIMULATED',
        },
      };
    }

    if (bot.mode === 'LIVE') {
      // LIVE mode: requires server ALLOW_LIVE=true
      if (process.env.ALLOW_LIVE !== 'true') {
        updateOrderStatus(orderId, 'REJECTED', undefined, undefined, 'LIVE_TRADING_DISABLED');
        return {
          botId: bot.id,
          status: 'PROCESSED',
          newBarProcessed: true,
          barTime: latestClosedBar.time,
          signal: targetSignal,
          orderResult: {
            success: false,
            orderId,
            status: 'REJECTED',
            error: 'LIVE_TRADING_DISABLED: server ALLOW_LIVE=true required',
          },
        };
      }

      // Dispatch through bridge with live verification
      if (this.config.bridgeClient) {
        const execution = await executeOrderThroughBridge(this.config.bridgeClient, orderRecord, {
          botMode: 'LIVE',
          accountLogin: accountSnap.login,
          riskLimits: bot.riskLimits,
        });

        return {
          botId: bot.id,
          status: 'PROCESSED',
          newBarProcessed: true,
          barTime: latestClosedBar.time,
          signal: targetSignal,
          orderResult: {
            success: execution.success,
            orderId: execution.order.id,
            ticket: execution.order.ticket,
            status: execution.order.status,
            error: execution.error,
          },
        };
      }
    }

    return {
      botId: bot.id,
      status: 'PROCESSED',
      newBarProcessed: true,
      barTime: latestClosedBar.time,
      signal: targetSignal,
    };
  }

  /**
   * Run one full execution cycle across all bots.
   * Isolates failures so one failing bot does not stop or affect any other bots.
   */
  public async runCycle(
    candlesBySymbolTf: Map<string, Candle[]>,
    spreadBySymbol?: Map<SymbolName, number>
  ): Promise<BotCycleResult[]> {
    const allBots = getAllBots();
    const results: BotCycleResult[] = [];

    for (const bot of allBots) {
      if (bot.status !== 'RUNNING') continue;

      const key = `${bot.symbol}:${bot.timeframe}`;
      const candles = candlesBySymbolTf.get(key) || [];
      const spread = spreadBySymbol?.get(bot.symbol);

      try {
        const res = await this.evaluateBotOnClosedBar(bot, candles, spread);
        results.push(res);
      } catch (err: any) {
        // Absolute isolation catch-all
        updateBotStatusDb(bot.id, 'ERROR');
        results.push({
          botId: bot.id,
          status: 'ERROR',
          error: err?.message || 'Unexpected bot runner error',
        });
      }
    }

    return results;
  }

  /**
   * Resume bots safely after server restart ONLY after broker reconciliation has completed.
   */
  public resumeBotsAfterReconciliation(reconciliationSuccess: boolean): {
    resumedCount: number;
    skippedReason?: string;
  } {
    if (!reconciliationSuccess) {
      return {
        resumedCount: 0,
        skippedReason: 'RECONCILIATION_NOT_COMPLETE: Bots will not resume until broker reconciliation succeeds.',
      };
    }

    const allBots = getAllBots();
    let resumed = 0;

    for (const bot of allBots) {
      if (bot.status === 'RUNNING') {
        resumed++;
      }
    }

    insertAuditLog({
      id: `aud_runner_resume_${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: 'BotRunner',
      action: 'BOTS_RESUMED_POST_RECONCILIATION',
      entity: `Active Bots (${resumed})`,
      details: `Reconciliation verified. Bot runner initialized for ${resumed} running bots.`,
      status: 'SUCCESS',
    });

    return { resumedCount: resumed };
  }
}
