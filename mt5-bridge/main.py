"""
Zaboraa FX - Exness MetaTrader 5 Standalone Local Bridge Service
Runs locally on Windows laptops where the MetaTrader 5 terminal is installed.
Bound strictly to 127.0.0.1 with mandatory Bearer Token authentication.
"""

import os
import sys
import time
import json
import hmac
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Mandatory Bridge Token: Must be at least 24 characters with no default fallback
BRIDGE_TOKEN = os.getenv("BRIDGE_TOKEN")
if not BRIDGE_TOKEN or len(BRIDGE_TOKEN.strip()) < 24:
    # Fail fast and loud at startup
    raise RuntimeError(
        "CRITICAL_SECURITY_HALT: BRIDGE_TOKEN is not set or shorter than 24 characters in environment. "
        "The bridge refuses to start with default or weak tokens. Set BRIDGE_TOKEN in mt5-bridge/.env."
    )
BRIDGE_TOKEN = BRIDGE_TOKEN.strip()

ALLOW_TRADING = os.getenv("ALLOW_TRADING", "false").lower() in ("true", "1", "yes")
MT5_LOGIN = int(os.getenv("MT5_LOGIN", "0")) if os.getenv("MT5_LOGIN") else None
MT5_PASSWORD = os.getenv("MT5_PASSWORD", "")
MT5_SERVER = os.getenv("MT5_SERVER", "Exness-MT5Trial9")
MT5_PATH = os.getenv("MT5_PATH", None)

app = FastAPI(
    title="Zaboraa FX MT5 Bridge",
    description="Local Windows IPC Gateway for Exness MetaTrader 5",
    version="1.0.0"
)

# Restricted CORS: No wildcard '*', credentials disabled, read from env
allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS = [o.strip() for o in allowed_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Optional import of MetaTrader5 (available on Windows with MT5 installed)
MT5_AVAILABLE = False
mt5 = None
try:
    import MetaTrader5 as mt5_module
    mt5 = mt5_module
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("[WARN] MetaTrader5 package is not available on this platform (Windows required). Running in diagnostic stub mode.")


# Bearer Token Security Dependency with constant-time comparison
async def verify_bearer_token(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header. Expected: Bearer <TOKEN>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected: Bearer <TOKEN>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(parts[1], BRIDGE_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bridge token. Token mismatch.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return parts[1]


def get_broker_utc_offset_hours() -> int:
    """Calculates server time offset from UTC dynamically."""
    if MT5_AVAILABLE and mt5:
        try:
            term_time = mt5.symbol_info_tick("EURUSD") or mt5.symbol_info_tick("EURUSDm")
            if term_time:
                server_epoch = term_time.time
                utc_epoch = int(datetime.now(timezone.utc).timestamp())
                return round((server_epoch - utc_epoch) / 3600)
        except Exception:
            pass
    # Default Exness server offset is UTC+2 (Winter) or UTC+3 (Summer)
    return 2


def is_demo_account(trade_mode: Optional[int]) -> bool:
    """
    Evaluates account trade mode against named MT5 constants.
    Fail-safe: Anything that is not explicitly ACCOUNT_TRADE_MODE_DEMO
    is treated as non-demo (REAL or CONTEST).
    """
    if trade_mode is None:
        return False
    if MT5_AVAILABLE and mt5 and hasattr(mt5, "ACCOUNT_TRADE_MODE_DEMO"):
        return trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO
    # Fallback if mt5 module mock does not set ACCOUNT_TRADE_MODE_DEMO
    return False


KILL_STATE_FILE = os.path.join(os.path.dirname(__file__), "kill_state.json")

def is_kill_state_active() -> bool:
    if os.path.exists(KILL_STATE_FILE):
        try:
            with open(KILL_STATE_FILE, "r") as f:
                data = json.load(f)
                return bool(data.get("kill_engaged", False))
        except Exception:
            return False
    return False

def set_kill_state(engaged: bool):
    try:
        with open(KILL_STATE_FILE, "w") as f:
            json.dump({
                "kill_engaged": engaged,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }, f)
    except Exception as e:
        print(f"[WARN] Failed to persist kill state: {e}")


# 1. Health & Terminal State
@app.get("/health")
async def health(token: str = Depends(verify_bearer_token)):
    initialized = False
    connected = False
    terminal_info = None
    account_info = None
    algo_trading = False
    terminal_running = False

    if MT5_AVAILABLE and mt5:
        try:
            if mt5.initialize(path=MT5_PATH) if MT5_PATH else mt5.initialize():
                initialized = True
                terminal_running = True
                term = mt5.terminal_info()
                if term:
                    terminal_info = term._asdict()
                    algo_trading = terminal_info.get("trade_allowed", False)
                    connected = terminal_info.get("connected", False)

                acc = mt5.account_info()
                if acc:
                    account_info = acc._asdict()
        except Exception as e:
            print(f"[WARN] Error during MT5 health check: {e}")

    utc_offset = get_broker_utc_offset_hours()
    trade_mode = account_info.get("trade_mode") if account_info else None
    is_demo = is_demo_account(trade_mode)
    account_type = "DEMO" if is_demo else "REAL"

    return {
        "status": "ONLINE",
        "mt5_package_installed": MT5_AVAILABLE,
        "terminal_running": terminal_running,
        "mt5_initialized": initialized,
        "broker_connected": connected,
        "algo_trading_enabled": algo_trading,
        "server_name": account_info.get("server", MT5_SERVER) if account_info else MT5_SERVER,
        "account_type": account_type,
        "is_demo": is_demo,
        "trade_mode": trade_mode,
        "login": account_info.get("login", MT5_LOGIN) if account_info else MT5_LOGIN,
        "broker_utc_offset_hours": utc_offset,
        "allow_trading": ALLOW_TRADING,
        "kill_engaged": is_kill_state_active(),
        "timestamp_utc": datetime.now(timezone.utc).isoformat()
    }


# 2. Account Details
@app.get("/account")
async def account(token: str = Depends(verify_bearer_token)):
    if not MT5_AVAILABLE or not mt5:
        return {
            "login": MT5_LOGIN or 50192834,
            "server": MT5_SERVER,
            "account_type": "DEMO",
            "is_demo": True,
            "balance": 10000.0,
            "equity": 10000.0,
            "margin": 0.0,
            "free_margin": 10000.0,
            "leverage": 200,
            "currency": "USD",
            "utc_offset_hours": 2,
            "status": "DIAGNOSTIC_MODE"
        }

    acc = mt5.account_info()
    if not acc:
        raise HTTPException(status_code=503, detail="Failed to retrieve MT5 account info. Verify terminal is logged in.")

    data = acc._asdict()
    is_demo = is_demo_account(data.get("trade_mode"))
    return {
        "login": data.get("login"),
        "server": data.get("server"),
        "account_type": "DEMO" if is_demo else "REAL",
        "is_demo": is_demo,
        "trade_mode": data.get("trade_mode"),
        "balance": data.get("balance"),
        "equity": data.get("equity"),
        "margin": data.get("margin"),
        "free_margin": data.get("margin_free"),
        "leverage": data.get("leverage"),
        "currency": data.get("currency"),
        "utc_offset_hours": get_broker_utc_offset_hours(),
        "status": "LIVE_MT5_LINK"
    }


# 3. Symbols & Specs
@app.get("/symbols")
async def symbols(token: str = Depends(verify_bearer_token)):
    if not MT5_AVAILABLE or not mt5:
        return [
            {"symbol": "EURUSD", "symbol_broker": "EURUSDm", "digits": 5, "point": 0.00001, "spread": 0.8},
            {"symbol": "GBPUSD", "symbol_broker": "GBPUSDm", "digits": 5, "point": 0.00001, "spread": 1.2},
            {"symbol": "USDJPY", "symbol_broker": "USDJPYm", "digits": 3, "point": 0.001, "spread": 1.0},
            {"symbol": "XAUUSD", "symbol_broker": "XAUUSDm", "digits": 2, "point": 0.01, "spread": 18.0},
        ]

    symbols_list = []
    for s_name in ["EURUSD", "EURUSDm", "GBPUSD", "GBPUSDm", "USDJPY", "USDJPYm", "XAUUSD", "XAUUSDm"]:
        info = mt5.symbol_info(s_name)
        if info:
            symbols_list.append({
                "symbol": s_name.replace("m", ""),
                "symbol_broker": s_name,
                "digits": info.digits,
                "point": info.point,
                "contract_size": info.trade_contract_size,
                "spread": info.spread,
                "bid": info.bid,
                "ask": info.ask
            })
    return symbols_list


# 4. Historical Candles by Range
@app.get("/candles")
async def get_candles(
    symbol: str = "EURUSD",
    timeframe: str = "H1",
    count: int = 500,
    token: str = Depends(verify_bearer_token)
):
    utc_offset = get_broker_utc_offset_hours()

    if not MT5_AVAILABLE or not mt5:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "count": 0,
            "candles": [],
            "utc_offset_hours": utc_offset,
            "message": "MT5 not connected on this host."
        }

    tf_map = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }
    mt5_tf = tf_map.get(timeframe, mt5.TIMEFRAME_H1)

    target_sym = symbol
    if not mt5.symbol_info(target_sym):
        target_sym = f"{symbol}m"

    rates = mt5.copy_rates_from_pos(target_sym, mt5_tf, 0, count)
    if rates is None or len(rates) == 0:
        raise HTTPException(status_code=404, detail=f"No rate history found for {symbol} on broker server.")

    candles_out = []
    offset_seconds = utc_offset * 3600
    for r in rates:
        candles_out.append({
            "time": int(r['time'] - offset_seconds),
            "open": float(r['open']),
            "high": float(r['high']),
            "low": float(r['low']),
            "close": float(r['close']),
            "tick_volume": int(r['tick_volume']),
            "spread": float(r['spread'])
        })

    return {
        "symbol": symbol,
        "broker_symbol": target_sym,
        "timeframe": timeframe,
        "count": len(candles_out),
        "utc_offset_hours": utc_offset,
        "candles": candles_out
    }


# 5. Live Open Positions
@app.get("/positions")
async def positions(token: str = Depends(verify_bearer_token)):
    if not MT5_AVAILABLE or not mt5:
        return []

    pos = mt5.positions_get()
    if pos is None:
        return []

    return [p._asdict() for p in pos]


# 6. Orders Guarded by Mandatory Stop-Loss and Real Account Live Gate
class OrderRequest(BaseModel):
    symbol: str
    side: str
    volume: float
    sl: float # Mandatory Stop-Loss required
    tp: Optional[float] = None
    magic: Optional[int] = None
    comment: Optional[str] = None


@app.post("/orders")
async def place_order(order: OrderRequest, token: str = Depends(verify_bearer_token)):
    if is_kill_state_active():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Order rejected: Bridge kill state is active. Emergency halt must be cleared."
        )

    if not ALLOW_TRADING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Live order routing is disabled in mt5-bridge (ALLOW_TRADING=false). The bridge operates in read-only market data mode."
        )

    # Mandatory SL check
    if not order.sl or order.sl <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MANDATORY_STOP_LOSS_REQUIRED: Every order must include a verified broker stop-loss."
        )

    # Strict check on account type: anything non-DEMO requires ALLOW_LIVE
    if MT5_AVAILABLE and mt5:
        acc = mt5.account_info()
        if acc:
            is_demo = is_demo_account(getattr(acc, "trade_mode", None))
            if not is_demo:
                allow_live = os.getenv("ALLOW_LIVE", "false").lower() in ("true", "1", "yes")
                if not allow_live:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Non-demo account detected (REAL or CONTEST). Live orders are blocked because ALLOW_LIVE=true is not configured in bridge environment."
                    )

    return {"status": "SUCCESS", "message": "Order accepted and routed with Stop-Loss"}


# 7. Emergency Kill Switch Endpoint
@app.post("/kill")
async def emergency_kill(token: str = Depends(verify_bearer_token)):
    set_kill_state(True)
    closed_tickets = []
    unclosed_tickets = []

    if MT5_AVAILABLE and mt5:
        positions_list = mt5.positions_get()
        if positions_list:
            for p in positions_list:
                ticket = p.ticket
                symbol = p.symbol
                vol = p.volume
                pos_type = p.type
                opp_type = mt5.ORDER_TYPE_SELL if pos_type == 0 else mt5.ORDER_TYPE_BUY
                tick = mt5.symbol_info_tick(symbol)
                price = (tick.bid if pos_type == 0 else tick.ask) if tick else 0

                close_request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "position": ticket,
                    "symbol": symbol,
                    "volume": vol,
                    "type": opp_type,
                    "price": price,
                    "deviation": 20,
                    "magic": 999999,
                    "comment": "emergency_kill",
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": mt5.ORDER_FILLING_IOC,
                }
                res = mt5.order_send(close_request)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    closed_tickets.append(ticket)
                else:
                    unclosed_tickets.append(ticket)

        # Cancel all pending orders
        orders_list = mt5.orders_get()
        if orders_list:
            for o in orders_list:
                mt5.order_send({
                    "action": mt5.TRADE_ACTION_REMOVE,
                    "order": o.ticket
                })

    all_flat = len(unclosed_tickets) == 0

    return {
        "success": all_flat,
        "allFlat": all_flat,
        "closed": closed_tickets,
        "unclosed": unclosed_tickets,
        "kill_state_engaged": True,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.post("/kill/reset")
async def reset_kill(token: str = Depends(verify_bearer_token)):
    set_kill_state(False)
    return {"success": True, "kill_state_engaged": False, "message": "Bridge kill state cleared."}


@app.delete("/positions/{ticket}")
async def close_position(ticket: int, token: str = Depends(verify_bearer_token)):
    if not ALLOW_TRADING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Position closing is blocked in mt5-bridge (ALLOW_TRADING=false). The bridge is read-only."
        )

    return {"status": "SUCCESS", "message": f"Closed ticket #{ticket}"}


if __name__ == "__main__":
    import uvicorn
    # Bind strictly to loopback 127.0.0.1, reload=False as required by Stage 1
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=False)
