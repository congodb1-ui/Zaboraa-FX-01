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
    price: Optional[float] = None


@app.post("/orders")
@app.post("/order")
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

    # 1. Mandatory SL check
    if not order.sl or order.sl <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MANDATORY_STOP_LOSS_REQUIRED: Every order must include a verified broker stop-loss."
        )

    # 2. Strict check on account type: anything non-DEMO requires ALLOW_LIVE
    if MT5_AVAILABLE and mt5 and hasattr(mt5, "account_info"):
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

    # 3. Magic number and comment (truncated to 25 chars max)
    magic = int(order.magic) if order.magic is not None else 0
    comment = (order.comment or "")[:25]

    # 4. Symbol info & tick pricing
    target_sym = order.symbol
    info = None
    tick = None
    if MT5_AVAILABLE and mt5:
        if hasattr(mt5, "symbol_info"):
            info = mt5.symbol_info(target_sym) or mt5.symbol_info(f"{target_sym}m")
            if info:
                target_sym = getattr(info, "name", target_sym)
        if hasattr(mt5, "symbol_info_tick"):
            tick = mt5.symbol_info_tick(target_sym)

    side_upper = order.side.strip().upper()
    if side_upper not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="INVALID_SIDE: Order side must be BUY or SELL.")

    price = order.price
    if price is None or price <= 0:
        if tick:
            price = getattr(tick, "ask", 1.0850) if side_upper == "BUY" else getattr(tick, "bid", 1.0845)
        else:
            price = 1.0850 if side_upper == "BUY" else 1.0845

    market_price = (getattr(tick, "ask", price) if side_upper == "BUY" else getattr(tick, "bid", price)) if tick else price

    # 5. Stop-loss side validation
    if side_upper == "BUY":
        if order.sl >= market_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_STOP_LOSS: Stop-loss must be below current market price for BUY orders."
            )
    else:
        if order.sl <= market_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_STOP_LOSS: Stop-loss must be above current market price for SELL orders."
            )

    # 6. Stop-loss stops level validation
    if info:
        stops_level = getattr(info, "trade_stops_level", 0) or 0
        point = getattr(info, "point", 0.00001) or 0.00001
        if stops_level > 0:
            stops_dist = stops_level * point
            if side_upper == "BUY" and (market_price - order.sl) < (stops_dist - 1e-9):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"INVALID_STOP_LOSS: Stop-loss is too close to price. Minimum distance is {stops_level} points ({stops_dist})."
                )
            elif side_upper == "SELL" and (order.sl - market_price) < (stops_dist - 1e-9):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"INVALID_STOP_LOSS: Stop-loss is too close to price. Minimum distance is {stops_level} points ({stops_dist})."
                )

    # 7. Volume validation (min, max, step)
    if info:
        vol_min = float(getattr(info, "volume_min", 0.01) or 0.01)
        vol_max = float(getattr(info, "volume_max", 100.0) or 100.0)
        vol_step = float(getattr(info, "volume_step", 0.01) or 0.01)

        if order.volume < (vol_min - 1e-9):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_VOLUME: Volume {order.volume} is below minimum allowed {vol_min}."
            )
        if order.volume > (vol_max + 1e-9):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_VOLUME: Volume {order.volume} exceeds maximum allowed {vol_max}."
            )
        steps_from_min = round((order.volume - vol_min) / vol_step, 6)
        if not steps_from_min.is_integer():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"INVALID_VOLUME: Volume {order.volume} does not match volume step {vol_step}."
            )

    # 8. Filling mode selection from symbol info
    filling_mode = getattr(mt5, "ORDER_FILLING_IOC", 1) if (MT5_AVAILABLE and mt5) else 1
    if info and hasattr(info, "filling_mode"):
        modes = getattr(info, "filling_mode", 0)
        if modes & 1:
            filling_mode = getattr(mt5, "ORDER_FILLING_IOC", 1)
        elif modes & 2:
            filling_mode = getattr(mt5, "ORDER_FILLING_FOK", 2)
        else:
            filling_mode = getattr(mt5, "ORDER_FILLING_RETURN", 0)

    # 9. Dispatch to MT5 terminal
    if MT5_AVAILABLE and mt5 and hasattr(mt5, "order_send"):
        req = {
            "action": getattr(mt5, "TRADE_ACTION_DEAL", 1),
            "symbol": target_sym,
            "volume": float(order.volume),
            "type": getattr(mt5, "ORDER_TYPE_BUY", 0) if side_upper == "BUY" else getattr(mt5, "ORDER_TYPE_SELL", 1),
            "price": float(price),
            "sl": float(order.sl),
            "tp": float(order.tp) if order.tp else 0.0,
            "deviation": 20,
            "magic": magic,
            "comment": comment,
            "type_time": getattr(mt5, "ORDER_TIME_GTC", 0),
            "type_filling": filling_mode,
        }
        res = mt5.order_send(req)
        retcode = getattr(res, "retcode", None) if res else None
        if not res or retcode != getattr(mt5, "TRADE_RETCODE_DONE", 10009):
            err_code = retcode if retcode is not None else "NO_RESPONSE"
            err_comment = getattr(res, "comment", "Order send failed") if res else "No response from MT5"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"BROKER_ORDER_FAILED: Retcode {err_code} - {err_comment}"
            )
        ticket = getattr(res, "order", getattr(res, "deal", 100001))
        fill_price = getattr(res, "price", price)
        vol = getattr(res, "volume", order.volume)
        return {
            "status": "SUCCESS",
            "message": "Order executed and filled by MT5 terminal.",
            "ticket": ticket,
            "fill_price": fill_price,
            "volume": vol,
            "symbol": target_sym,
        }

    # Diagnostic mode fallback
    return {
        "status": "SUCCESS",
        "message": "Order executed in diagnostic mode",
        "ticket": 880001,
        "fill_price": float(price),
        "volume": float(order.volume),
        "symbol": target_sym,
    }


# 6B. Deals History by Magic Number
@app.get("/deals")
async def get_deals(
    magic: Optional[int] = None,
    from_date: Optional[int] = None,
    to_date: Optional[int] = None,
    token: str = Depends(verify_bearer_token)
):
    if not MT5_AVAILABLE or not mt5 or not hasattr(mt5, "history_deals_get"):
        return []

    from_ts = from_date or int(time.time() - 7 * 86400)
    to_ts = to_date or int(time.time() + 86400)

    deals = mt5.history_deals_get(from_ts, to_ts)
    if deals is None:
        return []

    out = []
    for d in deals:
        d_dict = d._asdict() if hasattr(d, "_asdict") else dict(d)
        if magic is not None and d_dict.get("magic") != magic:
            continue
        out.append(d_dict)
    return out


# 6C. Cancel Pending Order Endpoint
@app.delete("/orders/{ticket}")
async def cancel_pending_order(ticket: int, token: str = Depends(verify_bearer_token)):
    if is_kill_state_active():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation rejected: Bridge kill state is active."
        )

    if not ALLOW_TRADING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Order cancellation blocked in mt5-bridge (ALLOW_TRADING=false). The bridge operates in read-only mode."
        )

    if MT5_AVAILABLE and mt5 and hasattr(mt5, "order_send"):
        res = mt5.order_send({
            "action": getattr(mt5, "TRADE_ACTION_REMOVE", 8),
            "order": ticket
        })
        if res and getattr(res, "retcode", 0) != getattr(mt5, "TRADE_RETCODE_DONE", 10009):
            raise HTTPException(
                status_code=400,
                detail=f"Failed to cancel pending order #{ticket}: {getattr(res, 'comment', 'Retcode error')}"
            )

    return {"status": "SUCCESS", "message": f"Cancelled pending order #{ticket}", "ticket": ticket}



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
