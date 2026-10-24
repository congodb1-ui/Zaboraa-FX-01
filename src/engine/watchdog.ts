import { getAllBots, updateBotStatusDb, insertRiskEvent, insertAuditLog } from '../services/db';

export interface WatchdogStatus {
  isTripped: boolean;
  lastHeartbeatTime: number;
  lastHeartbeatIso: string;
  secondsSinceLastHeartbeat: number;
  timeoutSeconds: number;
  pausedBotIds: string[];
  bannerMessage: string | null;
}

export class HeartbeatWatchdog {
  private lastHeartbeatTime: number = Date.now();
  private timeoutMs: number;
  private isTripped: boolean = false;
  private pausedBotIds: Set<string> = new Set();
  private checkTimer: any = null;

  constructor(options?: { timeoutMs?: number; autoStart?: boolean }) {
    this.timeoutMs = options?.timeoutMs ?? 15000; // 15 seconds default
    if (options?.autoStart) {
      this.start();
    }
  }

  public setTimeoutMs(ms: number) {
    this.timeoutMs = ms;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Called whenever a successful response or health check is received from MT5 bridge
   */
  public recordHeartbeat(): void {
    this.lastHeartbeatTime = Date.now();
  }

  /**
   * Set simulated last heartbeat time (useful for unit testing timeout triggers)
   */
  public _setLastHeartbeatForTest(timestampMs: number): void {
    this.lastHeartbeatTime = timestampMs;
  }

  /**
   * Evaluate heartbeat freshness and trigger auto-pause if expired
   */
  public checkHeartbeat(): boolean {
    const elapsed = Date.now() - this.lastHeartbeatTime;

    if (elapsed > this.timeoutMs && !this.isTripped) {
      this.tripWatchdog(elapsed);
      return false;
    }

    return !this.isTripped;
  }

  /**
   * Trips the watchdog: pauses all running bots, records risk event, preserves broker-side SL
   */
  private tripWatchdog(elapsedMs: number): void {
    this.isTripped = true;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);

    try {
      const allBots = getAllBots();
      const runningBots = allBots.filter((b) => b.status === 'RUNNING');

      this.pausedBotIds.clear();
      for (const bot of runningBots) {
        updateBotStatusDb(bot.id, 'PAUSED');
        this.pausedBotIds.add(bot.id);
      }

      insertRiskEvent({
        id: `risk_watchdog_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'HeartbeatWatchdog',
        action: 'WATCHDOG_HEARTBEAT_TIMEOUT',
        entity: `Active Bots (${runningBots.length})`,
        details: `Bridge heartbeat missing for ${elapsedSec}s (exceeds ${this.timeoutMs / 1000}s limit). ` +
          `Paused ${runningBots.length} bots. Broker-side stop-losses remain in place on terminal. Manual confirmed resume required.`,
        severity: 'CRITICAL',
        status: 'ENGAGED',
      });
    } catch (err: any) {
      console.error('[WATCHDOG] Error pausing bots on heartbeat timeout:', err);
    }
  }

  /**
   * Manual confirmed resume.
   * Bots pause automatically on timeout, but resume ONLY after a manual confirmed resume.
   * Refuses to resume if bridge is currently disconnected or expired.
   */
  public confirmManualResume(options?: { allowOfflineForTest?: boolean }): {
    success: boolean;
    error?: string;
    resumedBotIds: string[];
  } {
    const elapsed = Date.now() - this.lastHeartbeatTime;

    if (elapsed > this.timeoutMs && !options?.allowOfflineForTest) {
      return {
        success: false,
        error: `Cannot resume bots: MT5 bridge heartbeat is still offline (last seen ${(elapsed / 1000).toFixed(1)}s ago). Re-establish bridge connection first.`,
        resumedBotIds: [],
      };
    }

    const resumed: string[] = [];
    try {
      for (const botId of this.pausedBotIds) {
        updateBotStatusDb(botId, 'RUNNING');
        resumed.push(botId);
      }

      this.isTripped = false;
      this.pausedBotIds.clear();

      insertAuditLog({
        id: `aud_wd_resume_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Trader',
        action: 'WATCHDOG_MANUAL_RESUME',
        entity: `Resumed Bots (${resumed.length})`,
        details: `Manual confirmed resume executed. ${resumed.length} bots returned to RUNNING status.`,
        status: 'SUCCESS',
      });

      return {
        success: true,
        resumedBotIds: resumed,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        resumedBotIds: resumed,
      };
    }
  }

  public getStatus(): WatchdogStatus {
    const elapsed = Date.now() - this.lastHeartbeatTime;
    const timeoutSec = this.timeoutMs / 1000;

    return {
      isTripped: this.isTripped,
      lastHeartbeatTime: this.lastHeartbeatTime,
      lastHeartbeatIso: new Date(this.lastHeartbeatTime).toISOString(),
      secondsSinceLastHeartbeat: Math.round(elapsed / 1000),
      timeoutSeconds: timeoutSec,
      pausedBotIds: Array.from(this.pausedBotIds),
      bannerMessage: this.isTripped
        ? `WATCHDOG PAUSE: MT5 Bridge heartbeat missing for >${timeoutSec}s. All trading bots paused. Broker-side SL/TP remain active. Manual confirmed resume required.`
        : null,
    };
  }

  public start(intervalMs = 2000): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => {
      this.checkHeartbeat();
    }, intervalMs);
  }

  public stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}

// Global singleton instance for application use
export const globalWatchdog = new HeartbeatWatchdog({ timeoutMs: 15000 });
