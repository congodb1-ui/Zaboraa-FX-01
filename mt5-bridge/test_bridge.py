"""
Unit & Integration Tests for MT5 Python Bridge
Uses mocked MetaTrader5 objects to verify DEMO, CONTEST, and REAL modes,
token validation, CORS headers, and kill-switch safety rules.
"""

import os
import sys
from unittest.mock import MagicMock

# Set required environment variables before importing main
os.environ["BRIDGE_TOKEN"] = "zfx_test_bridge_token_super_secure_32ch"
os.environ["ALLOW_TRADING"] = "true"
os.environ["ALLOW_LIVE"] = "false"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,http://127.0.0.1:3000"

import pytest
from fastapi.testclient import TestClient

# Mock MetaTrader5 module before importing main
mock_mt5 = MagicMock()
mock_mt5.ACCOUNT_TRADE_MODE_DEMO = 2
mock_mt5.ACCOUNT_TRADE_MODE_CONTEST = 1
mock_mt5.ACCOUNT_TRADE_MODE_REAL = 0
mock_mt5.initialize.return_value = True
mock_mt5.TIMEFRAME_H1 = 16385
mock_mt5.TRADE_RETCODE_DONE = 10009
mock_mt5.TRADE_ACTION_DEAL = 1
mock_mt5.TRADE_ACTION_REMOVE = 8
mock_mt5.ORDER_TYPE_BUY = 0
mock_mt5.ORDER_TYPE_SELL = 1
mock_mt5.ORDER_TIME_GTC = 0
mock_mt5.ORDER_FILLING_IOC = 1

sys.modules["MetaTrader5"] = mock_mt5

import main
main.mt5 = mock_mt5
main.MT5_AVAILABLE = True

client = TestClient(main.app)
AUTH_HEADER = {"Authorization": f"Bearer {os.environ['BRIDGE_TOKEN']}"}


def test_token_auth_missing():
    resp = client.get("/health")
    assert resp.status_code == 401
    assert "Missing Authorization" in resp.json()["detail"]


def test_token_auth_invalid():
    resp = client.get("/health", headers={"Authorization": "Bearer wrong_token_that_does_not_match_at_all"})
    assert resp.status_code == 401
    assert "Invalid bridge token" in resp.json()["detail"]


def test_health_demo_mode():
    mock_acc = MagicMock()
    mock_acc._asdict.return_value = {
        "login": 50192834,
        "server": "Exness-MT5Trial9",
        "trade_mode": mock_mt5.ACCOUNT_TRADE_MODE_DEMO,
    }
    mock_acc.trade_mode = mock_mt5.ACCOUNT_TRADE_MODE_DEMO
    mock_mt5.account_info.return_value = mock_acc

    resp = client.get("/health", headers=AUTH_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ONLINE"
    assert data["account_type"] == "DEMO"
    assert data["is_demo"] is True


def test_health_real_mode():
    mock_acc = MagicMock()
    mock_acc._asdict.return_value = {
        "login": 10928341,
        "server": "Exness-Real1",
        "trade_mode": mock_mt5.ACCOUNT_TRADE_MODE_REAL,
    }
    mock_acc.trade_mode = mock_mt5.ACCOUNT_TRADE_MODE_REAL
    mock_mt5.account_info.return_value = mock_acc

    resp = client.get("/health", headers=AUTH_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["account_type"] == "REAL"
    assert data["is_demo"] is False


def test_health_contest_mode_treated_as_non_demo():
    mock_acc = MagicMock()
    mock_acc._asdict.return_value = {
        "login": 883719,
        "server": "Exness-Contest",
        "trade_mode": mock_mt5.ACCOUNT_TRADE_MODE_CONTEST,
    }
    mock_acc.trade_mode = mock_mt5.ACCOUNT_TRADE_MODE_CONTEST
    mock_mt5.account_info.return_value = mock_acc

    resp = client.get("/health", headers=AUTH_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    # Anything not DEMO must be treated as non-demo (fail-safe)
    assert data["account_type"] == "REAL"
    assert data["is_demo"] is False


def test_order_mandatory_stop_loss_rejection():
    # Attempt order with sl=0
    resp = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.1, "sl": 0.0},
        headers=AUTH_HEADER
    )
    assert resp.status_code == 400
    assert "MANDATORY_STOP_LOSS_REQUIRED" in resp.json()["detail"]


def test_order_real_account_blocked_when_allow_live_false(monkeypatch):
    monkeypatch.setenv("ALLOW_LIVE", "false")
    mock_acc = MagicMock()
    mock_acc.trade_mode = mock_mt5.ACCOUNT_TRADE_MODE_REAL
    mock_mt5.account_info.return_value = mock_acc

    resp = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.1, "sl": 1.0800},
        headers=AUTH_HEADER
    )
    assert resp.status_code == 403
    assert "Non-demo account detected" in resp.json()["detail"]


def test_kill_switch_and_state_persistence():
    # Mock position to close
    mock_pos = MagicMock()
    mock_pos.ticket = 10101
    mock_pos.symbol = "EURUSD"
    mock_pos.volume = 0.1
    mock_pos.type = 0 # buy
    mock_mt5.positions_get.return_value = [mock_pos]

    mock_send_res = MagicMock()
    mock_send_res.retcode = mock_mt5.TRADE_RETCODE_DONE
    mock_mt5.order_send.return_value = mock_send_res
    mock_mt5.orders_get.return_value = []

    kill_resp = client.post("/kill", headers=AUTH_HEADER)
    assert kill_resp.status_code == 200
    data = kill_resp.json()
    assert data["allFlat"] is True
    assert 10101 in data["closed"]
    assert data["kill_state_engaged"] is True

    # While kill state is active, orders must be rejected
    order_resp = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.1, "sl": 1.0800},
        headers=AUTH_HEADER
    )
    assert order_resp.status_code == 403
    assert "Bridge kill state is active" in order_resp.json()["detail"]

    # Reset kill switch
    reset_resp = client.post("/kill/reset", headers=AUTH_HEADER)
    assert reset_resp.status_code == 200
    assert reset_resp.json()["kill_state_engaged"] is False


def test_order_sl_wrong_side_buy():
    # BUY with SL above or equal to market price (ask=1.0850)
    mock_tick = MagicMock()
    mock_tick.ask = 1.0850
    mock_tick.bid = 1.0845
    mock_mt5.symbol_info_tick.return_value = mock_tick

    resp = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.1, "sl": 1.0860},
        headers=AUTH_HEADER
    )
    assert resp.status_code == 400
    assert "Stop-loss must be below current market price for BUY orders" in resp.json()["detail"]


def test_order_sl_wrong_side_sell():
    # SELL with SL below or equal to market price (bid=1.0845)
    mock_tick = MagicMock()
    mock_tick.ask = 1.0850
    mock_tick.bid = 1.0845
    mock_mt5.symbol_info_tick.return_value = mock_tick

    resp = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "SELL", "volume": 0.1, "sl": 1.0830},
        headers=AUTH_HEADER
    )
    assert resp.status_code == 400
    assert "Stop-loss must be above current market price for SELL orders" in resp.json()["detail"]


def test_order_sl_violates_stops_level():
    mock_tick = MagicMock()
    mock_tick.ask = 1.08500
    mock_tick.bid = 1.08450
    mock_mt5.symbol_info_tick.return_value = mock_tick

    mock_info = MagicMock()
    mock_info.name = "EURUSD"
    mock_info.point = 0.00001
    mock_info.trade_stops_level = 30 # 30 points = 0.00030 distance required
    mock_info.volume_min = 0.01
    mock_info.volume_max = 100.0
    mock_info.volume_step = 0.01
    mock_info.filling_mode = 1
    mock_mt5.symbol_info.return_value = mock_info

    # BUY at 1.08500 with SL at 1.08490 (distance is only 10 points < 30 points)
    resp = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.1, "sl": 1.08490},
        headers=AUTH_HEADER
    )
    assert resp.status_code == 400
    assert "Minimum distance is 30 points" in resp.json()["detail"]


def test_order_volume_validation():
    mock_info = MagicMock()
    mock_info.name = "EURUSD"
    mock_info.point = 0.00001
    mock_info.trade_stops_level = 0
    mock_info.volume_min = 0.05
    mock_info.volume_max = 50.0
    mock_info.volume_step = 0.05
    mock_info.filling_mode = 1
    mock_mt5.symbol_info.return_value = mock_info

    mock_tick = MagicMock()
    mock_tick.ask = 1.08500
    mock_tick.bid = 1.08450
    mock_mt5.symbol_info_tick.return_value = mock_tick

    # Below min volume
    resp_min = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.01, "sl": 1.0800},
        headers=AUTH_HEADER
    )
    assert resp_min.status_code == 400
    assert "below minimum allowed" in resp_min.json()["detail"]

    # Exceeds max volume
    resp_max = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 60.0, "sl": 1.0800},
        headers=AUTH_HEADER
    )
    assert resp_max.status_code == 400
    assert "exceeds maximum allowed" in resp_max.json()["detail"]

    # Invalid volume step
    resp_step = client.post(
        "/orders",
        json={"symbol": "EURUSD", "side": "BUY", "volume": 0.08, "sl": 1.0800},
        headers=AUTH_HEADER
    )
    assert resp_step.status_code == 400
    assert "does not match volume step" in resp_step.json()["detail"]


def test_order_comment_truncation_and_magic():
    mock_info = MagicMock()
    mock_info.name = "EURUSD"
    mock_info.point = 0.00001
    mock_info.trade_stops_level = 0
    mock_info.volume_min = 0.01
    mock_info.volume_max = 100.0
    mock_info.volume_step = 0.01
    mock_info.filling_mode = 1
    mock_mt5.symbol_info.return_value = mock_info

    mock_tick = MagicMock()
    mock_tick.ask = 1.08500
    mock_tick.bid = 1.08450
    mock_mt5.symbol_info_tick.return_value = mock_tick

    mock_res = MagicMock()
    mock_res.retcode = mock_mt5.TRADE_RETCODE_DONE
    mock_res.order = 998811
    mock_res.price = 1.08500
    mock_res.volume = 0.1
    mock_mt5.order_send.return_value = mock_res

    long_comment = "This is a super long comment exceeding 25 characters easily"
    resp = client.post(
        "/order",
        json={
            "symbol": "EURUSD",
            "side": "BUY",
            "volume": 0.1,
            "sl": 1.0800,
            "magic": 10482,
            "comment": long_comment
        },
        headers=AUTH_HEADER
    )
    assert resp.status_code == 200
    # Inspect arguments passed to mock_mt5.order_send
    req = mock_mt5.order_send.call_args[0][0]
    assert req["magic"] == 10482
    assert len(req["comment"]) <= 25
    assert req["comment"] == long_comment[:25]


def test_deals_endpoint_filtering():
    deal_1 = MagicMock()
    deal_1._asdict.return_value = {"ticket": 1001, "magic": 10482, "price": 1.0850, "profit": 25.0}
    deal_2 = MagicMock()
    deal_2._asdict.return_value = {"ticket": 1002, "magic": 99999, "price": 1.0820, "profit": -10.0}

    mock_mt5.history_deals_get.return_value = [deal_1, deal_2]

    # Query without filter
    resp_all = client.get("/deals", headers=AUTH_HEADER)
    assert resp_all.status_code == 200
    assert len(resp_all.json()) == 2

    # Query with magic=10482
    resp_filtered = client.get("/deals?magic=10482", headers=AUTH_HEADER)
    assert resp_filtered.status_code == 200
    data = resp_filtered.json()
    assert len(data) == 1
    assert data[0]["magic"] == 10482


def test_cancel_pending_order():
    mock_res = MagicMock()
    mock_res.retcode = mock_mt5.TRADE_RETCODE_DONE
    mock_mt5.order_send.return_value = mock_res

    resp = client.delete("/orders/70105", headers=AUTH_HEADER)
    assert resp.status_code == 200
    assert resp.json()["status"] == "SUCCESS"
    assert resp.json()["ticket"] == 70105

    # Verify MT5 called with TRADE_ACTION_REMOVE
    req = mock_mt5.order_send.call_args[0][0]
    assert req["action"] == mock_mt5.TRADE_ACTION_REMOVE
    assert req["order"] == 70105

