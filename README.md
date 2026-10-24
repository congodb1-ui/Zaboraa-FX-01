# Zaboraa FX — Automated Forex & Precious Metals Trading Portal

**Zaboraa FX** is an automated trading, quantitative research, and backtesting portal designed for Forex and Precious Metals (Gold/XAUUSD). It connects directly to an **Exness MetaTrader 5 (MT5)** desktop terminal on Windows via a local Python bridge, evaluates algorithmic trading strategies in a secure **QuickJS sandbox**, models realistic transaction costs (spread, commission, swap, slippage), and provides automated execution with strict risk guardrails and an emergency kill switch.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Zaboraa FX Portal                    │
├──────────────────────────┬─────────────────────────────┤
│ Frontend (React 19/Vite) │ Backend (Express/Node.js)   │
│ - Live Dashboard & Charts│ - REST API (/api/*)         │
│ - Strategy Studio        │ - QuickJS Strategy Sandbox  │
│ - Backtest & Optimizer   │ - Native SQLite Database    │
│ - Realtime Risk Display  │ - Vite Development Server   │
└────────────┬─────────────┴──────────────┬──────────────┘
             │                            │
             │ HTTP Bearer Token          │ Local Filesystem
             ▼                            ▼
┌──────────────────────────┐    ┌─────────────────────────┐
│ MT5 Python Bridge        │    │ Local Storage           │
│ (FastAPI / 127.0.0.1)    │    │ - data/*.sqlite (WAL)   │
│ - Exness Terminal IPC    │    │ - docs/STATUS.md        │
└──────────────────────────┘    └─────────────────────────┘
```

---

## Windows Local Setup Guide

Follow these exact steps to set up and run Zaboraa FX on a Windows 10/11 machine with Exness MetaTrader 5.

### 1. Prerequisites

1. **Operating System**: Windows 10 or 11 (64-bit).
2. **MetaTrader 5 Terminal**: Install the [Exness MetaTrader 5 Terminal](https://www.exness.com/metatrader-5/) and log in to your **Demo Account** (e.g. `Exness-MT5Trial9`).
   - Enable Algorithmic Trading in MT5: Go to **Tools -> Options -> Expert Advisors**, check **"Allow algorithmic trading"**, and ensure the **"Algo Trading"** button on the main toolbar is active/green.
3. **Node.js**: Install **Node.js >= 22.13** (required for native `node:sqlite`). Verify with:
   ```powershell
   node --version
   ```
4. **Python**: Install **Python 3.10, 3.11, or 3.12** (ensure *"Add python.exe to PATH"* is checked during installation). Verify with:
   ```powershell
   python --version
   ```

---

### 2. Configure Environment (`.env`)

In the project root folder, copy `.env.example` to create your local `.env` file:

```powershell
copy .env.example .env
```

Open `.env` in your text editor and configure:
- `BRIDGE_TOKEN`: Set a strong random secret token (at least 24 characters), e.g.:
  ```text
  BRIDGE_TOKEN=zfx_super_secure_bridge_token_2026_x9
  ```
- `ENCRYPTION_MASTER_KEY`: A 32-byte hex key for encrypting live tokens and sensitive state.
- `GEMINI_API_KEY`: (Optional) Your Google AI Studio API key if using Pine Script AI conversion.
- `ALLOW_LIVE=false`: Keep set to `false` for paper/demo trading.

Also copy the bridge environment file inside `mt5-bridge/`:
```powershell
cd mt5-bridge
copy .env.example .env
```
Ensure `BRIDGE_TOKEN` in `mt5-bridge/.env` matches the `BRIDGE_TOKEN` in the root `.env`. Return to root:
```powershell
cd ..
```

---

### 3. Launch MT5 Python Bridge (Terminal 1)

Open a Windows PowerShell terminal to start the local MT5 bridge daemon:

```powershell
# 1. Navigate to the bridge directory
cd mt5-bridge

# 2. Create virtual environment
python -m venv .venv

# 3. Activate virtual environment
.venv\Scripts\activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Start the bridge on 127.0.0.1:8001
uvicorn main:app --host 127.0.0.1 --port 8001
```

When successfully launched, you will see:
```text
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     MetaTrader5 connected: Exness-MT5Trial9, Account: [MASKED], Mode: DEMO
INFO:     Uvicorn running on http://127.0.0.1:8001 (Press CTRL+C to quit)
```

#### Diagnostic Demo Account Verification:
To verify that your Exness account is recognized as a genuine DEMO account, you can run this one-line check in Python:
```powershell
python -c "import MetaTrader5 as mt5; mt5.initialize(); print('trade_mode:', mt5.account_info().trade_mode, 'DEMO_CONSTANT:', mt5.ACCOUNT_TRADE_MODE_DEMO)"
```
If both numbers match, your terminal is confirmed in DEMO mode.

---


### 4. Launch Zaboraa FX Web Portal (Terminal 2)

Open a second Windows PowerShell terminal in the project root:

```powershell
# 1. Install Node.js dependencies
npm install

# 2. Start the development server
npm run dev
```

The server will start on `http://127.0.0.1:3000`. Open your browser to:
`http://localhost:3000`

---

### 5. Running Automated Tests & Quality Checks

Run the complete test suite and verification commands:

```powershell
# Run all Vitest unit and safety tests
npm test

# Run TypeScript static type checking
npm run lint

# Build production Vite assets
npm run build
```

---

## Safety Ground Rules

1. **Simulation Default**: If the MT5 bridge is offline or unreachable, the portal automatically operates in simulation mode with visible `"SIMULATION: no broker connected"` indicators.
2. **Mandatory Stop-Loss**: Every order must specify a valid, broker-verified Stop-Loss (`sl > 0`). Orders lacking SL are blocked immediately.
3. **Emergency Kill Switch**: One-click kill switch closes all positions, cancels pending orders, and engages a persistent `no_new_orders` halt in SQLite.
4. **Sandboxed Strategies**: All trading strategies execute inside a restricted QuickJS WebAssembly sandbox with no access to system APIs, filesystem, or outbound network calls.
5. **Living Verification Status**: Refer to `docs/STATUS.md` for the current status of all tested vs planned features.
