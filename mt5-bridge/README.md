# Zaboraa FX – MetaTrader 5 (MT5) Local Bridge

The **MT5 Bridge** is a lightweight Python service (FastAPI) that links the **Zaboraa FX** web portal directly to your local **Exness MetaTrader 5** desktop terminal on Windows.

> [!IMPORTANT]
> **Host Environment Notice**:
> The `MetaTrader5` Python package communicates via Windows IPC pipes and **requires Windows 10/11 with the MetaTrader 5 desktop terminal running**.
>
> **Cloud Preview vs Local Reachability**:
> When running Zaboraa FX in a cloud-hosted development environment (e.g. AI Studio preview), the cloud server cannot directly reach `127.0.0.1:8001` on your laptop. For live MT5 bridge connectivity, run Zaboraa FX locally on your machine or clone the repository to your Windows PC.

---

## 1. Quick Setup on Windows

### Prerequisites
1. **Windows 10 or 11** 64-bit.
2. **MetaTrader 5 Desktop Terminal** (Exness branded) installed and logged in.
3. **Python 3.10, 3.11, or 3.12** installed (ensure "Add python.exe to PATH" is checked).

### Step-by-Step Launch Commands
Open Windows **PowerShell** or Command Prompt:

```powershell
# 1. Navigate to the bridge directory
cd mt5-bridge

# 2. Create a virtual environment
python -m venv .venv

# 3. Activate the virtual environment
.venv\Scripts\activate

# 4. Install required dependencies
pip install -r requirements.txt

# 5. Create your .env file
copy .env.example .env

# 6. Start the bridge service on 127.0.0.1:8001
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

When successfully started, you will see:
```text
INFO:     Uvicorn running on http://127.0.0.1:8001 (Press CTRL+C to quit)
```

---

## 2. Security & Read-Only Safety

- **Localhost Binding**: Binds exclusively to `127.0.0.1`. Never exposes ports to public networks.
- **Bearer Token**: Every request requires the header:
  `Authorization: Bearer <BRIDGE_TOKEN>`
- **Read-Only Mode (`ALLOW_TRADING=false`)**:
  By default, `ALLOW_TRADING` is set to `false` in `.env`. All endpoints attempting to submit (`POST /orders`) or modify/close positions will return **HTTP 403 Forbidden**. The bridge operates in read-only market data and account monitoring mode until you explicitly opt in.

---

## 3. Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Terminal status, account type (`DEMO`/`REAL`), algo trading permission, and UTC offset |
| `GET` | `/account` | Live balance, equity, margin, leverage, and currency |
| `GET` | `/symbols` | Broker symbol specs (EURUSD vs EURUSDm), contract sizes, and live spreads |
| `GET` | `/candles` | Query broker rates range via `copy_rates_from_pos`, normalized to UTC |
| `GET` | `/positions` | List open positions currently held in the MT5 terminal |
| `POST` | `/orders` | Submit order (requires `ALLOW_TRADING=true`) |
| `DELETE` | `/positions/{ticket}` | Close position (requires `ALLOW_TRADING=true`) |

---

## 4. Troubleshooting & Diagnostic Guide

### A. Terminal is not running
- **Symptom**: `/health` reports `"terminal_running": false` or `mt5.initialize() returned False`.
- **Fix**: Open the MetaTrader 5 terminal on your Windows desktop and log in before launching the bridge. If installed in a custom folder, set `MT5_PATH` in `.env`.

### B. Algo Trading Disabled
- **Symptom**: `/health` reports `"algo_trading_enabled": false`.
- **Fix**: In the MT5 desktop menu, go to **Tools -> Options -> Expert Advisors**, and check **"Allow algorithmic trading"**. Also ensure the main toolbar button **"Algo Trading"** is green/active.

### C. Wrong Server or Invalid Account
- **Symptom**: Account details do not load or connection drops.
- **Fix**: In MT5 terminal, confirm the exact server name shown in the bottom right corner (e.g. `Exness-MT5Trial9` or `Exness-Demo`), and update `MT5_SERVER` in `.env`.

### D. Symbol Suffix Mismatch (`EURUSD` vs `EURUSDm`)
- **Symptom**: `/candles` returns 404 "Symbol not found".
- **Fix**: Exness standard accounts append `m` (e.g. `EURUSDm`, `XAUUSDm`), while raw/zero accounts do not. The bridge auto-resolves this, but verify your account type in the MT5 Market Watch window.
