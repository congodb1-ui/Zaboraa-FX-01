# Zaboraa FX — System Implementation & Verification Status

This document is the authoritative single living ledger of functionality in the Zaboraa FX codebase.
In accordance with Ground Rule 3 and Stage 0/1 requirements:
- **Never mark something as implemented unless an automated unit/integration test or verified live bridge execution proves it.**
- When no bridge is connected, all operational features run in simulated mode with explicit labels.

*Last Updated*: Stage 2 (One Real Strategy Execution Path & Safety Architecture)

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

---

## 2. Implemented but Untested or Simulated

Items in this table exist in the codebase but have not yet been verified against real broker responses or automated unit tests.

| Feature / Component | Current Implementation | Reason Untested / Simulated | Target Phase for Testing |
| :--- | :--- | :--- | :--- |
| **Live MT5 Windows IPC** | Exness MetaTrader 5 live terminal | Requires running Windows terminal; simulated in Linux container | Manual verification checklist on Windows |
| **Live Gate Confirmation Token** | Single-use token with CAS in SQLite | Token endpoint implemented and checked in order flow | Stage 3 (full bot runner live gate) |
| **Partitioned Candle Storage** | Year-partitioned JSON/SQLite storage | Storage functions implemented in `candleStorage.ts` | Stage 3 (dataset manager live import) |
| **Browser UI Views** | Dashboard, Markets, Positions, Bots | Uses simulated demo account when bridge offline | Stage 4 (remove fake data & enforce badges) |

---

## 3. Planned / Not Started

Features defined in the master specification scheduled for upcoming stages.

| Stage | Feature Area | Description |
| :--- | :--- | :--- |
| **Stage 3** | **Live Execution & Reconciliation**| Typed `bridgeClient.ts`; 4-state order lifecycle (`PENDING_BROKER` -> `SENT` -> `FILLED` / `REJECTED` / `UNKNOWN`); closed-bar idempotency key; deals/positions startup reconciliation; server-side bot runner with persistent interval scheduling; risk manager firewall (daily max loss, per-trade risk); bridge heartbeat watchdog. |
| **Stage 4** | **Remove Fake Data** | Purge hardcoded mock positions and random price simulator; require explicit "SIMULATION: no broker connected" banner across UI. |
| **Stage 5** | **Fundamental Data Module** | SQLite `macro_series`, `calendar_events`, `cot_reports`; FRED API fetcher; Forex Factory calendar feed; CFTC COT reports; news blackout rule; currency bias score. |
| **Stage 6** | **Market Structure & Positioning**| Swing detection, BOS, CHoCH, Fair Value Gaps, Order Blocks, Liquidity Sweeps; currency strength meter; positioning analysis; signal study tool. |

