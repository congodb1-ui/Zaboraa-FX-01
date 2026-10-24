# Implementation Plan: Priority 1 – Correctness, Honesty & Engine Rigor (Revised)

This revised plan incorporates all amendments requested for Priority 1. It establishes rigorous mathematical verification for the backtesting engine via Vitest known-answer test suites, isolates strategy execution inside sandboxed Web Workers, provides a read-only localhost MT5 Python bridge service in `/mt5-bridge` with dynamic UTC offset detection, enforces strict 3-tier data provenance without synthetic deception, and standardizes demo-safe credentials (`Exness-MT5Trial9`).

***

## User Review & Critical Decisions

> [!IMPORTANT]
> The following 7 confirmed amendments govern this implementation:

1. **Known-Answer Vitest Test Suite & Settings Diagnostics**:
   - Engine math verified across hand-calculated cases:
     - (a) Spread cost deduction
     - (b) Commission per lot calculation
     - (c) Swap rollover for both long and short positions accumulated over multi-day spans
     - (d) Maximum drawdown ($ amount and %) on a hand-constructed equity curve
     - (e) Conservative SL/TP intrabar conflict rule tested for **both long and short trades** (worst case triggered first)
   - Handled via `vitest` for `npm test`.
   - Settings view features an interactive **Engine Mathematical Self-Test Card** rendering each test by name with `PASS/FAIL` and exact **Expected vs Actual** values.
2. **Deterministic No-Lookahead Mutation Proof**:
   - In addition to checking data slice lengths, the test suite executes a strategy across $N$ bars, mutates all subsequent bars after bar $i$ with extreme random price spikes, re-runs the strategy, and mathematically verifies that every trading decision made up to bar $i$ remains 100% identical. Also validates that all technical indicators calculated at bar $i$ consume only bars $0..i$.
3. **Web Worker Strategy Execution & Limited Sandbox Notice**:
   - Eliminates server-side `eval` / `new Function`. All user and AI-converted TypeScript strategy code executes exclusively inside a client-side browser **Web Worker** with an execution timeout, completely isolated with zero access to DOM, `localStorage`, `fetch`, or sockets.
   - Pre-execution AST/regex static analysis blocks smoke tests and execution if forbidden global identifiers (`window`, `document`, `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`) are detected.
   - A clear notice in Strategy Studio states: *"Client-side Web Worker sandbox active. File, DOM, and network access are restricted."*
4. **Hardened Standalone MT5 Bridge (`/mt5-bridge`)**:
   - Binds exclusively to `127.0.0.1:8001` with Bearer token authentication required on every endpoint. CORS restricted to the applet origin.
   - Includes `ALLOW_TRADING=false` in `.env.example`. While `false`, `/orders` and any modify/close operations return HTTP 403 Forbidden. The bridge operates in read-only market data and account monitoring mode.
   - `/health` and `/account` endpoints report: Account Mode (`DEMO` vs `REAL`), Server Name, Terminal Running state, Algo Trading permission state, and the broker server time offset from UTC.
   - Detects broker time offset dynamically and stores it alongside candle datasets; normalizes all stored candle timestamps to UTC.
   - `README.md` documents that the web app must run locally alongside the bridge (or the browser must have direct network access to localhost:8001), clarifying that cloud preview containers cannot connect to a user's local machine without port tunneling.
5. **Rigorous 3-Tier Data Provenance & Empty Catalog**:
   - Catalog initializes empty by default.
   - Provenance is explicitly tagged with exactly three labels:
     1. `MT5 BRIDGE` (from live bridge; displays broker server, account type, and UTC offset)
     2. `USER CSV` (user-supplied unverified file; displays uploaded file name and import date)
     3. `SIMULATED` (research restricted; permanently blocked from Live bot mode and research data exports)
   - Backtests on empty datasets are explicitly blocked with clear guidance. Every backtest report header displays: Source, Symbol, Timeframe, Date Range, Bar Count, and UTC offset.
6. **Demo Placeholder Credentials**:
   - All references to `Exness-Real21` and live login numbers are replaced with demo placeholders (`Exness-MT5Trial9`, login `50192834`).
7. **Bridge Diagnostics & Localhost Guidance in Settings**:
   - When the bridge is unreachable, Settings presents an actionable diagnostic guide detailing exact Windows setup and launch commands:
     ```powershell
     cd mt5-bridge
     python -m venv .venv
     .venv\Scripts\activate
     pip install -r requirements.txt
     uvicorn main:app --host 127.0.0.1 --port 8001
     ```

***

## 1. Overview & Core Concept

### What It Delivers
Zaboraa FX establishes uncompromising research integrity. Strategy code is written and evaluated exclusively in TypeScript using the unified `StrategyContract`. Traders can verify every formula using the built-in known-answer self-test panel and rely on a clean Python MT5 bridge service that protects real accounts by default.

***

## 2. User Experience & Visual Design

### Key User Flows
1. **Engine Self-Test Verification**:
   - User navigates to **Settings & Bridge**.
   - The **"Engine Mathematical Self-Test"** widget displays results for Pip Math, Friction Deductions (Spread, Commission, Rollover Swap), Intrabar Worst-Case SL Conflicts (Long & Short), No-Lookahead Bar Mutation Invariance, and Max Drawdown calculation.
   - Each row displays the Test Name, Status (`PASS` / `FAIL`), Expected Value, and Actual Value computed by the engine.
2. **Importing Research Data**:
   - Data Manager opens with an empty catalog.
   - User chooses **Import CSV** (unverified file import with column mapper) or connects to the local **MT5 Bridge**.
   - Datasets are labeled with their authentic provenance badge (`USER CSV` or `MT5 BRIDGE`).
3. **TypeScript Strategy Studio & Web Worker Sandbox**:
   - Strategy Studio displays TypeScript strategy code conforming to `init(ctx)` and `onBar(ctx, bar)`.
   - When running a backtest or smoke test, code is compiled and passed to an isolated Web Worker. If execution exceeds 3000ms or contains illegal tokens, it halts with a clear explanation.
4. **MT5 Bridge Connection & Diagnostics**:
   - In Settings, the user tests `http://127.0.0.1:8001`.
   - If connected, it displays real terminal status, broker time offset, and demo account info.
   - If offline, it renders step-by-step PowerShell commands for local setup.

***

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Vitest for Unit Testing & Settings Diagnostic Telemetry
- *Chosen Approach*: Install `vitest` as devDependency and wire `npm test` to run the known-answer test suite. Export the test suite functions so the React Settings component can also run them in the browser and display expected vs actual values.
- *Why*: Allows automated CI/CLI verification via terminal while giving non-developer traders full transparency in the UI.

### Decision 2: Web Worker Strategy Sandbox vs Server Eval
- *Chosen Approach*: Use Web Workers with `Blob` URLs for strategy execution.
- *Why*: Server-side `eval` or `new Function` on AI-generated or user-pasted code is a severe security vulnerability. Web Workers run in a distinct thread in the browser with zero DOM or network access.

### Decision 3: Read-Only MT5 Bridge on 127.0.0.1
- *Chosen Approach*: Default `ALLOW_TRADING=false` with 403 Forbidden protection on all order/modify endpoints. Binds strictly to loopback (`127.0.0.1`).
- *Why*: Prevents accidental execution on live accounts during early development and eliminates open network port exposure.

***

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Zaboraa FX Web Portal                           │
│  (React 19 + TypeScript + Vite + Tailwind CSS · Port 3000)             │
├────────────────────────────────────────────────────────────────────────┤
│ • Settings: Vitest Known-Answer Runner (Expected vs Actual Telemetry) │
│ • Strategy Studio: TypeScript Contract + Web Worker Sandbox Runner     │
│ • Data Manager: Empty Catalog + User CSV Parser + MT5 Sync             │
│ • Backtesting Engine: Bar-by-bar runner with Provenance Header Badge   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Bearer Token HTTP / WS (Port 8001)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      /mt5-bridge (Python FastAPI)                      │
│            (Bound to 127.0.0.1:8001 · ALLOW_TRADING=false)             │
├────────────────────────────────────────────────────────────────────────┤
│ • main.py: CORS restricted, Bearer Token Auth, 403 on trading endpoints│
│ • /health, /account, /symbols, /candles (UTC offset detection)         │
│ • MetaTrader5 Python package -> Exness MT5 Terminal (Demo Trial)       │
└────────────────────────────────────────────────────────────────────────┘
```

### Known-Answer Verification Matrix
| Test Case | Inputs | Expected Output | Actual Validation |
| :--- | :--- | :--- | :--- |
| **EURUSD Pip Math** | 1.0 lot, 10 pips @ 1.08500 | Exactly $100.00 | $100.00 |
| **USDJPY Pip Math** | 1.0 lot, 10 pips @ 150.000 | Exactly $66.67 | $66.67 |
| **XAUUSD Pip Math** | 1.0 lot, $1.00 move (100 pt) | Exactly $100.00 | $100.00 |
| **Friction Deductions** | Spread (1.0 pip) + Comm ($7) + Swap 3 days | Exact cumulative sum | Match exact dollar sum |
| **Intrabar SL/TP Conflict (Long)** | Bar High >= TP & Low <= SL | SL executed (Worst Case) | SL logged |
| **Intrabar SL/TP Conflict (Short)** | Bar Low <= TP & High >= SL | SL executed (Worst Case) | SL logged |
| **No Look-Ahead Bar Mutation** | Mutate bars after $i$ | Identical decisions $\le i$ | Decision parity 100% |
| **Max Drawdown Hand Curve** | Curve: 10000 -> 12000 -> 9000 -> 11000 | Peak $12k, Min $9k = $3,000 (25.0%) | 25.0% ($3,000) |

***

## Implementation Checklist

1. **Test Infrastructure & Known-Answer Engine Tests (`src/engine/knownAnswerTests.ts` & `src/engine/__tests__/engine.test.ts`)**:
   - Install `vitest` as devDependency and add `"test": "vitest run"` in `package.json`.
   - Implement hand-calculated test cases: Pip Math (EURUSD, USDJPY, XAUUSD), Spread/Commission/Multi-day Swap, Worst-Case Intrabar SL/TP for both Long and Short, Drawdown math, and Lookahead Bar Mutation invariance.
   - Render interactive table in `SettingsView.tsx` with Test Name, Status, Expected, and Actual values.
2. **Strategy Contract & Web Worker Sandbox (`src/engine/workerSandbox.ts` & `src/types/forex.ts`)**:
   - Update `StrategyContract` in TypeScript.
   - Implement Web Worker runner that executes strategy code in isolated thread with 3000ms timeout and AST safety checks.
   - Update built-in strategies and Strategy Studio editor to TypeScript.
3. **Data Provenance & Empty Catalog (`src/components/DataManagerView.tsx` & `src/components/BacktestView.tsx`)**:
   - Initialize Data Manager with empty catalog by default.
   - Implement CSV import modal with column mapping (Time, Open, High, Low, Close, Volume).
   - Enforce 3 provenance labels: `MT5 BRIDGE`, `USER CSV`, and `SIMULATED`.
   - Display verified data provenance banner on backtest reports; block backtests on empty data.
4. **Standalone Python MT5 Bridge Service (`/mt5-bridge/`)**:
   - Create `main.py` bound strictly to `127.0.0.1:8001` with Bearer auth, `ALLOW_TRADING=false` (returns 403 on order routes), dynamic UTC offset detection, and CORS restriction.
   - Create `requirements.txt`, `.env.example`, and `README.md` detailing Windows local setup and cloud preview limitations.
   - Add bridge unreachable diagnostic guide in `SettingsView.tsx`.
5. **Credential Sanitization & Demo Placeholders**:
   - Replace all `Exness-Real21` and live login numbers with demo safe placeholders (`Exness-MT5Trial9`, login `50192834`).
