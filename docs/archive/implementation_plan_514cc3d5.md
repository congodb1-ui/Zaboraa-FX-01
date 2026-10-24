# Zaboraa FX: Safety, Persistence, Optimization & Verification Architecture (Final Specification)

Zaboraa FX is a systematic Forex and precious metals trading portal and quantitative research environment. This plan governs the complete architectural blueprint for Priorities 2 through 5: WebAssembly QuickJS sandboxing with TypeScript source maps and bounds-checked no-lookahead bar isolation, node:sqlite relational persistence with pre-logged order intent and MT5 magic numbers, cryptographically bound single-use live gates, a failsafe emergency kill switch with persistent halts and loud failure handling, heuristic overfitting diagnostics, seeded Monte Carlo analysis, and rigorous automated test verification.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The architectural amendments have been synthesized into this comprehensive specification:
> 1. **QuickJS Sandboxing & Zero-Lookahead Isolation**: User/AI TypeScript is transpiled to JavaScript via `typescript.transpileModule` with source maps before execution. The trusted accounting and risk engine runs in Node.js. QuickJS executes strictly `onBar` (and `init`) in a fresh WebAssembly VM per run, with all VM handles explicitly disposed (`handle.dispose()`). The sandbox **never receives the full dataset**—only closed historical bars up to the current bar (`ctx.data[0...i]`) via a bounds-checked host function (`getBar(index)` where `index <= currentBarIndex`). A canary look-ahead test ensures future indices return `null`/throw. Configurable memory (`SANDBOX_MEMORY_MB`, default 32MB) and bar execution limits (`SANDBOX_BAR_TIMEOUT_MS`, default 50ms) are enforced, with **no total ceiling for optimization jobs**.
> 2. **Order Lifecycle State Machine & Startup Resolution**: Orders follow an explicit state machine: `PENDING_BROKER` $\to$ `SENT` $\to$ `FILLED` / `REJECTED` / `UNKNOWN`. Order intent is written to SQLite **before** sending to MT5. Deterministic idempotency keys are computed as `SHA-256(bot_id + ":" + symbol + ":" + bar_time + ":" + signal_action)`. Orders carry an MT5 magic number (bot ID) and a short comment tag ($<31$ chars). On startup, pending orders are resolved against MT5 open positions by magic number; adopted positions without a broker Stop-Loss are immediately flagged and protected or closed.
> 3. **Emergency Kill Switch & Persistent Halt**: Engaging the kill switch halts all bots and persists a `no_new_orders = true` flag in SQLite (blocking order opens only; liquidations and cancellations are always permitted even if database writes fail). All pending orders are cancelled first. The bridge `/kill` endpoint (authenticated via `Authorization: Bearer <BRIDGE_TOKEN>`) liquidates market positions and persists its kill state to disk (`kill_state.json`). Active verification retries up to 5 times (10s timeout); if any position fails to close, the UI enters a **loud failure state** with a prominent **"Retry Now"** button and detailed ticket alerts. The flag clears only via confirmed manual user reset.
> 4. **Storage Architecture & WAL Pinning**: Native Node 22 (`node:sqlite`, pinned Node $\ge 22.13$) with `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = FULL;`. Explicit relational tables: `system_state`, `strategies`, `jobs`, `bots`, `orders`, `live_tokens` (atomic single-use via CAS + 60s TTL), `risk_events`, `trades`, `backtest_results`, and `data_catalog` (with SHA-256 hashes). Partitioned candle files (`/data/candles/{symbol}/{timeframe}/{year}.json`) use atomic `.tmp` writes and renames.
> 5. **Heuristic Overfitting Score & Seeded Simulations**: Overfitting terms are capped at 100. Uses trades-per-parameter ($N_{\text{trades\_IS}} / N_{\text{params}}$), sample size, trial count ($N_{\text{trials}}$), out-of-sample decay, and parameter sensitivity (with random-search distance-weighted nearest-neighbor fallback). Monte Carlo implements both trade order reshuffling (without replacement) and bootstrap resampling (with replacement) with a stored/overridable Mulberry32 seed. Random parameter search is seeded, and parallel optimization results are sorted deterministically.
> 6. **Secret Management & Live Gate**: The master key is derived via `scrypt` once at server startup. The MT5 password is never stored in the portal or database. The live gate generates single-use tokens bound to `bot_id`, `account_login`, and a SHA-256 hash of `risk_limits`. The bridge re-checks account mode (`DEMO` vs `REAL`) and requires `ALLOW_LIVE=true`. Missing master key causes immediate fail-closed behavior.
> 7. **Comprehensive Automated Tests**: Vitest suite verifies sandbox escapes, canary look-ahead traps, live gate protections, kill switch partial failure/closed market behavior, and bidirectional position reconciliation on restart.

---

## 1. Overview & Core Concept

- **What It Does**: Provides systematic FX and metals traders with a secure environment to translate TradingView Pine scripts into TypeScript, backtest against broker data with realistic transaction costs (spread, commission, swap, slippage), optimize parameters using walk-forward analysis and 2D heatmaps, and operate automated trading bots across PAPER, DEMO, and LIVE modes.
- **Target Audience**: Quantitative FX traders, algorithmic developers, and systematic researchers using Exness and MetaTrader 5 who demand mathematical rigor, execution safety, and protection against overfitted curves or unhedged broker risk.
- **Key Value**: Guarantees execution safety through WebAssembly sandboxing, protects capital with multi-layer stop-loss enforcement, provides verifiable data provenance, and detects overfitted strategies prior to capital deployment.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. *First-Launch Risk Disclosure*: Users encounter a mandatory Risk Disclaimer highlighting the risks of leveraged FX trading and the limits of historical backtesting. The disclaimer requires deliberate acknowledgment before live or demo trading controls unlock. A quiet risk notice persists in the footer.
  2. *Pine Script Converter & TV Verification*: Users paste Pine Script (v4/v5/v6). Gemini 3.8 Flash translates the logic into the Zaboraa FX TypeScript contract. The UI flags lookahead hazards (`barmerge.lookahead_on`), repainting patterns, and indicator-only scripts. Users can upload their TradingView "List of Trades" CSV to run an empirical side-by-side comparison (trade count, timestamp alignment, and net P&L divergence) before approving and saving.
  3. *Strategy Studio, Heatmaps & Walk-Forward*: Users select a strategy and launch parameter optimization. The UI provides Grid and Random parameter searches, In-Sample (70%) vs Out-of-Sample (30%) splits, and Walk-Forward Analysis. An interactive 2D parameter heatmap visualizes profit factor or Sharpe ratio across parameter pairs, accompanied by a quantitative Overfitting Warning Score and plain-language explanation.
  4. *Data Manager & Integrity Health Check*: Download jobs from the local MT5 bridge or custom CSV imports display live progress bars. The automated integrity engine audits datasets for timestamp gaps, duplicates, and invalid OHLC bars ($H < L$, $O > H$, $C > H$, $L > C$), presenting a clear health report and maintaining a dataset catalog with SHA-256 integrity hashes.
  5. *Live Bot Deployment & Kill Switch*: Bots operate in PAPER or DEMO by default. Promoting a bot to LIVE triggers the Live Safety Gate Modal: the user must type the exact account login, verify risk limits, and acknowledge that hard stop-losses will be transmitted to the broker. The Global Emergency Kill Switch can be triggered instantly from any view, issuing liquidation requests to MT5 and verifying that the account is 100% flat before logging completion.
  6. *Backtest Reports & Export*: Completed backtests display full cost attribution (spread, commission, swap, slippage), Maximum Adverse Excursion (MAE) and Maximum Favorable Excursion (MFE) scatter distributions, performance grouped by hour of the day and weekday, and a one-click standalone downloadable HTML report.

- **Visual Identity & Theme**:
  - *Canvas & Surfaces*: Neutral dark slate canvas (`#090D16`), deep panel containers (`#0F172A`, `#1E293B`), and hairline dividers (`#334155`).
  - *Typography*: Display headers in `Plus Jakarta Sans`, scannable body text at 13px–15px, and strict tabular numerals in `JetBrains Mono` (`font-mono tabular-nums`) for all rates, lot sizes, P&L values, and timestamps.
  - *Discipline*: Clean unboxed metadata separated by typographic dividers (`·`, `/`). Zero candy badges, no fake compiler status tickers, and no roleplay labels.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: QuickJS WebAssembly Sandbox with TypeScript Transpilation & Bounds Checking**
  - *Chosen Approach*: Strategies are written in TypeScript, transpiled via `typescript.transpileModule` with source maps, and executed inside a standalone WebAssembly instance of QuickJS via `quickjs-emscripten`. Memory is hard-capped at 32MB (configurable via `SANDBOX_MEMORY_MB`). Infinite loops are terminated via `setInterruptHandler` checking a 50ms per-bar deadline (`SANDBOX_BAR_TIMEOUT_MS`). The trusted backtest engine remains in Node.js, while QuickJS executes only the `onBar` handler via whitelisted host bindings (`buy`, `sell`, `close`, `modify`). Bars are exposed strictly up to the current bar index via a bounds-checked host function.
  - *Why*: Eliminates host escape risks while preventing lookahead data leakage. Individual bar handlers cannot stall the thread, while optimization jobs have no arbitrary total time ceiling.

- **Decision 2: Order State Machine & Pre-Logged Intent**
  - *Chosen Approach*: Orders progress through `PENDING_BROKER` $\to$ `SENT` $\to$ `FILLED`/`REJECTED`/`UNKNOWN`. Intent is written to SQLite before network transmission to MT5. Orders carry an MT5 magic number and deterministic idempotency key.
  - *Why*: Prevents orphaned or unacknowledged trades during network drops or bridge restarts.

- **Decision 3: Zero Portal Storage of MT5 Passwords & Scrypt Key Derivation**
  - *Chosen Approach*: The MT5 account password is never stored in the database or server memory. Portal secrets (API tokens, webhook URLs) are encrypted with AES-256-GCM using keys derived via `scrypt` once at startup from `ENCRYPTION_MASTER_KEY` with a random 12-byte IV per record. The server fails closed if the master key is missing.

- **Decision 4: Built-in `node:sqlite` Persistence with WAL & FULL Sync**
  - *Chosen Approach*: Relational persistence uses Node 22's native `node:sqlite` (`DatabaseSync`), requiring zero native build tools, with `WAL` journal mode and `FULL` synchronous pragma.

- **Decision 5: Failsafe Kill Switch with Loud Failure State & "Retry Now"**
  - *Chosen Approach*: The kill switch halts bots and persists `no_new_orders = true` in SQLite (affecting new opens only). Liquidation proceeds even if database writes fail. The bridge `/kill` endpoint is called with the bearer token and persists kill state to disk. If positions remain open, a loud failure banner appears with a "Retry Now" affordance.

---

## 4. Technical Architecture, Schema & Mathematical Formulations

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER CLIENT                                  │
│  React 19 + Tailwind CSS + Lucide Icons + Tabular Numerals (JetBrains Mono)  │
│                                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────────────┐ │
│  │ Strategy     │ │ Optimization │ │ Data Manager │ │ Live Bots &         │ │
│  │ Studio & TV  │ │ (Heatmap/MC) │ │ & Integrity  │ │ Typed Safety Modal  │ │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────┼────────────────────┼─────────────┘
          │                │                │                    │
          ▼                ▼                ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          EXPRESS SERVER (server.ts)                          │
│                                                                              │
│  ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐  │
│  │ /api/strategies      │ │ /api/jobs            │ │ /api/live/gate       │  │
│  │ (TS Transpile + AST) │ │ (Job Queue Manager)  │ │ (Bound Token Gen)    │  │
│  └──────────┬───────────┘ └──────────┬───────────┘ └──────────┬───────────┘  │
│             │                        │                        │              │
│  ┌──────────▼────────────────────────▼───────────┐ ┌──────────▼───────────┐  │
│  │      QuickJS WebAssembly Execution VM         │ │ MT5 Bridge Client    │  │
│  │  - onBar Host Whitelist (buy/sell/close/mod)  │ │ - Order Intent Log   │  │
│  │  - Bounds-Checked Bar Window (No Lookahead)   │ │ - Magic Number Tag   │  │
│  │  - Configurable Memory (32MB) & Bar Timeout   │ │ - Authenticated /kill│  │
│  └──────────────────────┬────────────────────────┘ └──────────┬───────────┘  │
│                         │                                     │              │
│  ┌──────────────────────▼─────────────────────────────────────▼───────────┐  │
│  │               node:sqlite (WAL + FULL sync) & Storage Layer            │  │
│  │                                                                        │  │
│  │   ┌─────────────────────────────┐       ┌───────────────────────────┐  │  │
│  │   │  SQLite Relational DB       │       │ Atomic Partitioned Store  │  │  │
│  │   │  (strategies, bots, orders, │       │ /data/candles/            │  │  │
│  │   │   live_tokens, risk, trades)│       │ {sym}/{tf}/{year}.json    │  │  │
│  │   └─────────────────────────────┘       └───────────────────────────┘  │  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### SQLite Schema (`node:sqlite`)
- **`system_state`**: `key TEXT PRIMARY KEY`, `value TEXT`, `updated_at TEXT` (holds `no_new_orders` flag, global risk limits).
- **`strategies`**: `id TEXT PRIMARY KEY`, `name TEXT`, `code TEXT`, `transpiled_js TEXT`, `version TEXT`, `params_schema TEXT`, `author TEXT`, `source_url TEXT`, `license TEXT`, `pine_source TEXT`, `verified_tv INTEGER`, `created_at TEXT`, `updated_at TEXT`.
- **`jobs`**: `id TEXT PRIMARY KEY`, `type TEXT`, `status TEXT`, `progress REAL`, `params_json TEXT`, `result_json TEXT`, `error_message TEXT`, `created_at TEXT`, `completed_at TEXT`.
- **`bots`**: `id TEXT PRIMARY KEY`, `magic_number INTEGER UNIQUE`, `name TEXT`, `strategy_id TEXT`, `account_login TEXT`, `symbol TEXT`, `timeframe TEXT`, `mode TEXT`, `status TEXT`, `params_json TEXT`, `risk_limits_json TEXT`, `today_pnl REAL`, `total_pnl REAL`, `last_reconciled_at TEXT`.
- **`orders`**: `id TEXT PRIMARY KEY`, `idempotency_key TEXT UNIQUE`, `bot_id TEXT`, `magic_number INTEGER`, `ticket INTEGER`, `symbol TEXT`, `side TEXT`, `volume REAL`, `intent_price REAL`, `fill_price REAL`, `sl REAL`, `tp REAL`, `status TEXT` (`PENDING_BROKER` | `SENT` | `FILLED` | `REJECTED` | `UNKNOWN`), `comment TEXT`, `created_at TEXT`, `filled_at TEXT`.
- **`live_tokens`**: `token TEXT PRIMARY KEY`, `bot_id TEXT`, `account_login TEXT`, `risk_hash TEXT`, `created_at TEXT`, `expires_at TEXT`, `used_at TEXT`.
- **`risk_events`**: `id TEXT PRIMARY KEY`, `timestamp TEXT`, `actor TEXT`, `action TEXT`, `entity TEXT`, `details TEXT`, `severity TEXT`, `status TEXT`.
- **`trades`**: `id TEXT PRIMARY KEY`, `bot_id TEXT`, `ticket INTEGER`, `symbol TEXT`, `side TEXT`, `volume REAL`, `open_price REAL`, `close_price REAL`, `sl REAL`, `tp REAL`, `pnl REAL`, `swap REAL`, `commission REAL`, `slippage_pips REAL`, `open_time INTEGER`, `close_time INTEGER`, `magic_number INTEGER`, `idempotency_key TEXT UNIQUE`.
- **`backtest_results`**: `id TEXT PRIMARY KEY`, `strategy_id TEXT`, `symbol TEXT`, `timeframe TEXT`, `period_start TEXT`, `period_end TEXT`, `mc_seed INTEGER`, `metrics_json TEXT`, `trades_json TEXT`, `chart_equity_json TEXT`, `overfitting_json TEXT`, `created_at TEXT`.
- **`data_catalog`**: `id TEXT PRIMARY KEY`, `symbol TEXT`, `timeframe TEXT`, `year INTEGER`, `file_path TEXT`, `sha256_hash TEXT`, `first_candle_time INTEGER`, `last_candle_time INTEGER`, `candle_count INTEGER`, `gap_count INTEGER`, `updated_at TEXT`.
- **`audit_log`**: `id TEXT PRIMARY KEY`, `timestamp TEXT`, `actor TEXT`, `action TEXT`, `entity TEXT`, `details TEXT`, `status TEXT`.

### Heuristic Overfitting Score Formula

The Heuristic Overfitting Score ($S_{\text{overfit}} \in [0, 100]$) combines five heuristic penalty terms, with each term explicitly capped at 100:

$$S_{\text{overfit}} = \min\left(100, \; \sum_{i=1}^{5} w_i \cdot T_i\right)$$

Heuristic weights: $w_1 = 0.35, w_2 = 0.25, w_3 = 0.20, w_4 = 0.10, w_5 = 0.10$:

1. **Out-of-Sample Degradation ($T_{\text{OOS}} \le 100$)**:
   $$T_{\text{OOS}} = \min\left(100, \; \max\left(0, \; \frac{\text{Sharpe}_{\text{IS}} - \text{Sharpe}_{\text{OOS}}}{\max(0.01, \text{Sharpe}_{\text{IS}})}\right) \times 100\right)$$

2. **Parameter Sensitivity ($T_{\text{sens}} \le 100$)**:
   - *Grid Search*: Coefficient of variation among adjacent parameter neighbors:
     $$T_{\text{sens}} = \min\left(100, \; \frac{\sigma(\text{Sharpe}_{\text{neighbors}})}{\max(0.1, |\mu(\text{Sharpe}_{\text{neighbors}})|)} \times 100\right)$$
   - *Random Search Fallback*: Distance-weighted $k$-nearest neighbors in normalized parameter space ($k=4$).

3. **Trades-per-Parameter Penalty ($T_{\text{TPP}} \le 100$)**:
   $$T_{\text{TPP}} = \min\left(100, \; \max\left(0, \; 100 \times \left(1 - \frac{N_{\text{trades\_IS}} / \max(1, N_{\text{params}})}{30}\right)\right)\right)$$
   *(Full penalty if fewer than 30 closed trades per parameter).*

4. **Trial-Count Penalty ($T_{\text{trials}} \le 100$)**:
   $$T_{\text{trials}} = \min\left(100, \; \max\left(0, \; \frac{\log_{10}(\max(1, N_{\text{trials}}))}{\log_{10}(1000)} \times 100\right)\right)$$
   *(Accounts for data snooping over hundreds of tested iterations).*

5. **Sample Size Penalty ($T_{\text{sample}} \le 100$)**:
   $$T_{\text{sample}} = \min\left(100, \; \max\left(0, \; 100 \times \left(1 - \frac{N_{\text{trades\_IS}}}{150}\right)\right)\right)$$

**Descriptive Labels (No Absolute Safety Claims)**:
- **$< 25$**: Lower Estimated Overfitting Risk (well-balanced sample and stable parameter neighborhoods).
- **$25 - 50$**: Moderate Empirical Divergence (noticeable out-of-sample decay or neighbor variation).
- **$> 50$**: Elevated Overfitting Indication (high sensitivity or low trade-to-parameter ratio).

### Monte Carlo Resampling & Shuffling
- **Reshuffling (without replacement)**: Permutes the chronological order of trades to evaluate maximum drawdown clusters and sequence risk.
- **Bootstrapping (with replacement)**: Generates 1,000 synthetic performance equity curves to establish 95% confidence intervals for Sharpe, drawdown, and win rate.
- **Deterministic Seed**: Mulberry32 PRNG seeded by backtest ID (stored in DB and user-overridable) ensures 100% reproducible curves. Random search parameter exploration is similarly seeded.

---

## 5. Verification & Test Plan

Automated Vitest test suite (`src/engine/__tests__/safety.test.ts` & `src/engine/__tests__/reconciliation.test.ts`):

1. **Sandbox Security & No-Lookahead Canary**:
   - Verify that attempts to access `process`, `fs`, `eval`, or global constructors are rejected either at AST transpile or inside QuickJS.
   - Canary look-ahead test: verify that strategy attempting to read `getBar(currentBarIndex + 1)` receives `undefined` or throws an error.
   - Verify QuickJS handles are disposed and memory is reclaimed across runs.
2. **Order State Machine & Reconciliation**:
   - Verify order progression: `PENDING_BROKER` $\to$ `SENT` $\to$ `FILLED`.
   - Verify startup resolution of pending orders by magic number.
   - Bidirectional reconciliation tests:
     - *Direction A (MT5 has position not in DB)*: MT5 has open position with bot magic number -> DB reconciles by adopting the trade into tracking, flagging missing SL.
     - *Direction B (DB has position closed in MT5)*: DB has open position, MT5 reports position closed -> DB reconciles by marking order closed with exit price and timestamp.
3. **Failsafe Kill-Switch & Partial Failure**:
   - Trigger kill-switch; verify `no_new_orders` is set in SQLite immediately (blocking opens only).
   - Mock MT5 bridge returning partial liquidation failure (e.g. ticket 101 closed, ticket 102 rejected due to closed market).
   - Verify kill-switch retries 5 times, times out, and enters the **loud failure state** with the "Retry Now" button and retained unclosed tickets.
4. **Server-Side Live Trading Gate**:
   - Order submission rejected without single-use confirmation token cryptographically matching `bot_id + account_login + risk_hash`.
   - Rejects live orders if bridge reports `account_type: "DEMO"` or `ALLOW_LIVE != 'true'`.
   - Rejects orders missing hard broker-side Stop-Loss.
   - Fails closed if `ENCRYPTION_MASTER_KEY` is missing.
