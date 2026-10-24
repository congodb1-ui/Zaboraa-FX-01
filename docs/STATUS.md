# Zaboraa FX — System Implementation & Verification Status

This document is the authoritative single living ledger of functionality in the Zaboraa FX codebase.
In accordance with Ground Rule 3 and Stage 0/1 requirements:
- **Never mark something as implemented unless an automated unit/integration test or verified live bridge execution proves it.**
- When no bridge is connected, all operational features run in simulated mode with explicit labels.

*Last Updated*: Stage 3A Completed (Bridge Client, 4-State Order Lifecycle, Closed-Bar Idempotency)

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
| **Startup Reconciliation** | Orphaned order resolution upon restart | `src/engine/__tests__/reconciliation.test.ts` | Pass | Resolves pending orders to `UNKNOWN` on boot |
| **Audit Logging** | Security and order audit trails in SQLite | `src/engine/__tests__/reconciliation.test.ts` | Pass | Log records inserted and queryable |
| **Bridge Token Constant-Time** | Bearer auth with constant-time compare | `mt5-bridge/test_bridge.py` | Pass | Missing or mismatched token rejected |
| **Bridge Named Demo Mode** | Compares `ACCOUNT_TRADE_MODE_DEMO` | `mt5-bridge/test_bridge.py` | Pass | Demo mode verified via named constant |
| **Bridge Non-Demo Fail-Safe** | Treats Contest and Real as non-demo | `mt5-bridge/test_bridge.py` | Pass | Blocks non-demo orders if `ALLOW_LIVE=false` |
| **Bridge Kill State Persistence**| Persists kill state to disk | `mt5-bridge/test_bridge.py` | Pass | Blocks new orders until `/kill/reset` called |
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
| **End-to-End Bridge Routing** | Coordinated SQLite state machine and BridgeClient execution | `src/engine/__tests__/bridgeClient.test.ts` | Pass | Transitions orders to FILLED on success, REJECTED on 4xx, UNKNOWN on timeout |

---

## 2. Implemented but Untested or Simulated

Items in this table exist in the codebase but have not yet been verified against real broker responses or automated unit tests.

| Feature / Component | Current Implementation | Reason Untested / Simulated | Target Phase for Testing |
| :--- | :--- | :--- | :--- |
| **Live MT5 Windows IPC** | Exness MetaTrader 5 live terminal | Requires running Windows terminal; simulated in Linux container | Manual verification checklist on Windows |
| **Partitioned Candle Storage** | Year-partitioned JSON/SQLite storage | Storage functions implemented in `candleStorage.ts` | Stage 3 (dataset manager live import) |
| **Browser UI Views** | Dashboard, Markets, Positions, Bots | Uses simulated demo account when bridge offline | Stage 4 (remove fake data & enforce badges) |

---

## 3. Planned / Not Started

Features defined in the master specification scheduled for upcoming stages.

| Stage | Feature Area | Description |
| :--- | :--- | :--- |
| **Stage 3B** | **Bot Runner & Watchdog** | Server-side bot runner with persistent interval scheduling; bridge heartbeat watchdog with auto-pause; risk manager firewall (daily max loss, max drawdown, per-trade risk). |
| **Stage 4** | **Remove Fake Data** | Purge hardcoded mock positions and random price simulator; require explicit "SIMULATION: no broker connected" banner across UI. |
| **Stage 5** | **Fundamental Data Module** | SQLite `macro_series`, `calendar_events`, `cot_reports`; FRED API fetcher; Forex Factory calendar feed; CFTC COT reports; news blackout rule; currency bias score. |
| **Stage 6** | **Market Structure & Positioning**| Swing detection, BOS, CHoCH, Fair Value Gaps, Order Blocks, Liquidity Sweeps; currency strength meter; positioning analysis; signal study tool. |


