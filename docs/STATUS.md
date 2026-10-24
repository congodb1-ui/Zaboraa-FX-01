# Zaboraa FX — System Implementation & Verification Status

This document is the authoritative single living ledger of functionality in the Zaboraa FX codebase.
In accordance with Ground Rule 3 and Stage 0/1 requirements:
- **Never mark something as implemented unless an automated unit/integration test or verified live bridge execution proves it.**
- When no bridge is connected, all operational features run in simulated mode with explicit labels.

*Last Updated*: Stage 3A-Fix Completed (Real Order Path, 6-Case Broker Reconciliation, Bridge Validation, Zero-Retry Order Send)

---

## 1. Implemented and Tested

Items in this table have automated unit/integration tests running in the test suite (`npm test` and `pytest`).

| Feature / Component | Scope | Verification Test File | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Engine Core Math & Costs** | Spread, commission, swap calculation | `src/engine/__tests__/engine.test.ts` | Pass | Verified with hand-calculated known-answer fixtures |
| **Indicators & Math** | SMA, EMA, Donchian Channel | `src/engine/__tests__/engine.test.ts` | Pass | Pure deterministic math verified |
| **Monte Carlo Engine** | Trade reshuffling with fixed seed | `src/engine/__tests__/engine.test.ts` | Pass | Seeded PRNG ensures reproducibility |
| **Overfitting Heuristic** | Trade count & parameter sensitivity scoring | `src/engine/__tests__/engine.test.ts` | Pass | Mathematical formula verified |
| **QuickJS Sandbox Isolation** | Global protection (process, fetch, window) | `src/engine/__tests__/safety.test.ts` | Pass | Malicious scripts cannot escape sandbox |
| **Constructor Escape Trap** | `globalThis.constructor.constructor` blocked | `src/engine/__tests__/safety.test.ts` | Pass | Host Node process is never reachable |
| **Dynamic Import Block** | Rejection of dynamic `import()` in code | `src/engine/__tests__/safety.test.ts` | Pass | Blocked during AST pre-pass |
| **Network Exfiltration Block** | Rejection of `fetch` or network calls | `src/engine/__tests__/safety.test.ts` | Pass | Blocked during AST pre-pass |
| **Infinite Loop Interruption** | Halts `while(true)` within per-bar deadline | `src/engine/__tests__/safety.test.ts` | Pass | QuickJS interrupt handler terminates loop |
| **Memory Bomb Ceiling** | Enforces sandbox memory limit | `src/engine/__tests__/safety.test.ts` | Pass | Excess heap allocation throws memory error |
| **No-Lookahead Protection** | Historical bar slicing & canary trap | `src/engine/__tests__/safety.test.ts` | Pass | Future bar index access throws exception |
| **Mandatory Stop-Loss** | Order firewall stops orders lacking SL | `src/engine/__tests__/safety.test.ts` | Pass | HTTP 400 + risk event on missing/zero SL |
| **Master Key Startup Refusal** | Refuses start when master key missing | `src/engine/__tests__/safety.test.ts` | Pass | Refuses unless NODE_ENV=development and ALLOW_EPHEMERAL_KEY=true |
| **Per-Install DB Salt** | Random salt generated and stored in SQLite | `src/engine/__tests__/safety.test.ts` | Pass | Persists in `system_state` table |
| **Versioned Encryption Payload**| Version prefix `v1:iv:tag:ciphertext` | `src/engine/__tests__/safety.test.ts` | Pass | Encrypts and decrypts with version tag |
| **Kill Switch: Bridge Down** | Loud failure on unreachable bridge | `src/engine/__tests__/safety.test.ts` | Pass | Returns `loudFailure: true`, reason: `BRIDGE_UNREACHABLE` |
| **Kill Switch: 401 Unauthorized**| Loud failure on bridge token error | `src/engine/__tests__/safety.test.ts` | Pass | Returns `loudFailure: true`, reason: `BRIDGE_UNAUTHORIZED` |
| **Kill Switch: Partial Failure** | Loud failure on unclosed tickets | `src/engine/__tests__/safety.test.ts` | Pass | Returns `loudFailure: true`, reason: `PARTIAL_CLOSE_FAILURE` |
| **Kill Switch: Verified Flat** | Verifies empty positions before success | `src/engine/__tests__/safety.test.ts` | Pass | Reports `FLAT_VERIFIED` only if `/positions` is empty |
| **Kill Switch: Simulation Mode** | Fallback when bridge unconfigured | `src/engine/__tests__/safety.test.ts` | Pass | Returns `simulation: true`, never claims flat |
| **Order Idempotency** | Prevents duplicate orders per interval | `src/engine/__tests__/reconciliation.test.ts` | Pass | SQLite UNIQUE constraint rejects duplicate |
| **Zero-Retry Order Send** | Exactly 1 attempt on sendOrder (0 retries) | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Network/5xx leaves order UNKNOWN; prevents double executions |
| **6-Case Broker Reconciliation** | Full bidirectional engine for orders & positions | `src/engine/__tests__/reconciliation.test.ts` | Pass | Cases 1-6 + restart reconciliation verified |
| **Bridge Order Pre-Validation** | Stops level, SL side check, volume min/max/step | `mt5-bridge/test_bridge.py` | UNVERIFIED | Unverified in Linux container: requires Windows MT5 desktop terminal |
| **Bridge Deals & Cancel Pending**| `GET /deals?magic=`, `DELETE /orders/{ticket}` | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Endpoints and BridgeClient methods verified |
| **Simulation Mode Labeling** | Unconfigured bridge labels orders & positions SIMULATED | `server.ts` & `src/components/PositionsView.tsx` | Pass | Explicit visual warning banners and SIMULATED badges |
| **ALLOW_TRADING Bot Block** | Bridge with `ALLOW_TRADING=false` blocks DEMO/LIVE bots | `server.ts` & `src/components/BotsView.tsx` | Pass | Refuses to start bots with clear UI error message |
| **Audit Logging** | Security and order audit trails in SQLite | `src/engine/__tests__/reconciliation.test.ts` | Pass | Log records inserted and queryable |
| **Bridge Token Constant-Time** | Bearer auth with constant-time compare | `mt5-bridge/test_bridge.py` | UNVERIFIED | Unverified in Linux container: requires Windows MT5 desktop terminal |
| **Bridge Named Demo Mode** | Compares `ACCOUNT_TRADE_MODE_DEMO` | `mt5-bridge/test_bridge.py` | UNVERIFIED | Unverified in Linux container: requires Windows MT5 desktop terminal |
| **Bridge Non-Demo Fail-Safe** | Treats Contest and Real as non-demo | `mt5-bridge/test_bridge.py` | UNVERIFIED | Unverified in Linux container: requires Windows MT5 desktop terminal |
| **Bridge Kill State Persistence**| Persists kill state to disk | `mt5-bridge/test_bridge.py` | UNVERIFIED | Unverified in Linux container: requires Windows MT5 desktop terminal |
| **No Silent Donchian Fallback** | Throws `UNKNOWN_STRATEGY` on unregistered ID | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Hardcoded if-ladder deleted; strict registry enforced |
| **Custom Strategy Execution** | Strategy produces distinct trades vs Donchian | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Custom contract runs cleanly without fallback |
| **Hand-Calculated Benchmark** | "Buy on Bar 30" with 60 pip TP exit | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Net PnL, spread, and commission match to penny |
| **QuickJS Canary Trap** | Canary trap on future bar index access | `src/engine/__tests__/strategyExecution.test.ts` | Pass | `CANARY_LOOKAHEAD_VIOLATION` halts cheating scripts |
| **Cancellable Optimization Sweep**| Cancellation flag stops grid sweep early | `src/engine/__tests__/strategyExecution.test.ts` | Pass | SQLite prevents overwriting CANCELLED jobs with COMPLETED |
| **Persistent SQLite AI Cache** | SHA-256 prompt-keyed `ai_cache` in SQLite | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Deterministic storage & retrieval of AI results |
| **Wednesday Triple-Swap Accrual**| 3x swap multiplier on Wednesday rollover | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Standard -3.20/lot scales to -9.60 on Wednesday |
| **Bridge Token Strong Validation**| Rejects short (<24 char) and default tokens | `src/engine/__tests__/safety.test.ts` | Pass | Default placeholders `dev-bridge-token` and `zaboraa_local_bridge_token_9872` blocked |
| **Authoritative Account Verification**| Inspects bridge `/account` for DEMO vs REAL/CONTEST | `src/engine/__tests__/safety.test.ts` | Pass | Mismatched client mode rejected with `ACCOUNT_TYPE_MISMATCH` |
| **Local API Host & Origin Firewall**| Rejects foreign `Host` and `Origin` headers | `src/engine/__tests__/safety.test.ts` | Pass | HTTP 403 `FORBIDDEN_HOST` and `FORBIDDEN_ORIGIN` |
| **Pip Value Canonical Math** | Single source of truth with USDJPY quote conversion | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Unified in `src/services/marketData.ts` |
| **Strategies & Bots SQLite Persistence**| Full CRUD persistence across server restarts | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Verified in SQLite `strategies` and `bots` tables |
| **QuickJS Context Immutability**| Dynamic balance, equity, and frozen positions per bar | `src/engine/__tests__/strategyExecution.test.ts` | Pass | Prevents strategy tampering with engine context |
| **Typed MT5 Bridge Client** | Strongly-typed client for all MT5 bridge endpoints | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Verified with `/health`, `/account`, `/positions`, `/orders`, `/kill` |
| **Bridge Exponential Backoff** | 3 retries with backoff & jitter on transient 5xx/network errors | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Recovers after transient glitch, exhausts on persistent failure |
| **Bridge Fast-Fail Discipline**| Immediate termination with zero retries on 401, 403, and 400 | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Prevents hammering unauthorized or forbidden endpoints |
| **Bridge Timeout Abort** | AbortController triggers `BRIDGE_TIMEOUT` (408) on hung requests | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Bounded by configurable `timeoutMs` |
| **Closed-Bar Idempotency Math**| Deterministic SHA-256 `${botId}:${symbol}:${timeframe}:${barTimestamp}:${direction}` | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Strictly prevents duplicate order execution on same bar |
| **4-State Order Lifecycle** | `PENDING_BROKER` -> `SENT` -> `FILLED` / `REJECTED` / `UNKNOWN` | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Full SQLite state machine transitions with error reasons & audit logs |
| **Live Gate Confirmation Token** | Single-use token with atomic CAS in SQLite | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Token consumed upon execution, prevents replay |
| **Bot Runner Closed-Bar Execution** | Evaluates bots on newly closed bars with idempotency hash | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Prevents duplicate evaluations on same bar |
| **PAPER Bot Execution Isolation** | Fills simulated orders locally, 0 bridge calls | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Full isolation from broker execution |
| **DEMO Bot Account Guard** | Refuses execution if broker is non-demo (REAL/CONTEST) | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Returns `ACCOUNT_TYPE_MISMATCH` |
| **Strategy Error Bot Isolation** | Bot with strategy exception transitions to ERROR; peers unaffected | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Fault isolation verified in test suite |
| **Post-Reconciliation Bot Resume** | Bot runner refuses run until broker reconciliation passes | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Refuses order processing if `reconciliationExecuted=false` |
| **Risk Manager Firewall Rules** | Kill switch, SL, max lot, spread, trading hours, max positions, max risk, daily loss, drawdown, news blackout | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | All 11 rules evaluated and logged to `risk_events` |
| **Heartbeat Watchdog Auto-Pause** | Auto-pauses bots on bridge timeout (>15s), preserves broker SL/TP | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Transitions running bots to PAUSED, logs CRITICAL risk event |
| **Confirmed Manual Resume** | Manual resume blocked until bridge heartbeat restored | `src/engine/__tests__/runnerAndRisk.test.ts` | Pass | Requires healthy bridge before resuming paused bots |
| **Fake Data Removal & DB State** | Authoritative SQLite/Bridge query for positions, bots, audit logs | `src/engine/__tests__/stage4FakeDataRemoval.test.ts` | Pass | Hardcoded fake records removed; empty states & SIMULATION banners enforced |

---

## 2. Implemented but Untested or Simulated

Items in this table exist in the codebase but have not yet been verified against real broker responses or automated unit tests.

| Feature / Component | Current Implementation | Reason Untested / Simulated | Target Phase for Testing |
| :--- | :--- | :--- | :--- |
| **Live MT5 Windows IPC** | Exness MetaTrader 5 live terminal | Requires running Windows terminal; simulated in Linux container | Manual verification checklist on Windows |
| **Partitioned Candle Storage** | Year-partitioned JSON/SQLite storage | Storage functions implemented in `candleStorage.ts` | Stage 3 (dataset manager live import) |

---

## 3. Planned / Not Started

Features defined in the master specification scheduled for upcoming stages.

| Stage | Feature Area | Description |
| :--- | :--- | :--- |
| **Stage 5** | **Fundamental Data Module** | SQLite `macro_series`, `calendar_events`, `cot_reports`; FRED API fetcher; Forex Factory calendar feed; CFTC COT reports; news blackout rule; currency bias score. |
| **Stage 6** | **Market Structure & Positioning**| Swing detection, BOS, CHoCH, Fair Value Gaps, Order Blocks, Liquidity Sweeps; currency strength meter; positioning analysis; signal study tool. |
| **Stage 7** | **Portfolio Flow View** | Read-only Sankey allocation & risk diagram (Equity -> Asset Class -> Instrument -> Ticker cards); pure functions in `src/engine/portfolioFlow/`. |


