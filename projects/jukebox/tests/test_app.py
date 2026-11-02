"""End-to-end tests: the full assessment pipeline and the dashboard API on synthetic cached data.

No network: a temporary data cache is filled with synthetic SPY, VUAG.L and T-bill series.
"""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from toolkit.data import store


@pytest.fixture()
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "CACHE", tmp_path / "cache")
    rng = np.random.default_rng(42)
    idx = pd.bdate_range("2008-01-02", periods=252 * 12)

    def write(symbol, currency, n):
        px = 100 * np.cumprod(1 + 0.0004 + 0.011 * rng.standard_normal(n))
        df = pd.DataFrame({"open": px, "high": px, "low": px, "close": px, "adj_close": px,
                           "volume": 1e6, "dividend": 0.0, "split": 1.0}, index=idx[-n:])
        df.index.name = "date"
        store._write("prices", symbol, df, {"symbol": symbol, "source": "test", "currency": currency,
                                            "quality": {"ok": True, "issues": []}})

    write("SPY", "USD", len(idx))
    write("VUAG.L", "GBP", 252 * 5)
    tbill = pd.DataFrame({"DGS3MO": 2.0}, index=idx)
    store._write("fred", "DGS3MO", tbill, {"series": "DGS3MO", "source": "test"})
    return tmp_path


@pytest.fixture()
def client(cache):
    from app import server
    server._cache.clear()
    return TestClient(server.app)


def test_assessment_end_to_end(client):
    r = client.get("/api/assessment/trend-sma")
    assert r.status_code == 200
    rep = r.json()
    assert rep["lookahead_check"] is True
    assert rep["walk_forward"]["trials_per_window"] == 5
    assert rep["comparison"]["walk_forward"]["years"] == pytest.approx(2, abs=0.05)  # 12y data - 10y training
    assert rep["signal"]["target"] in (0.0, 1.0)
    assert rep["trade_price"]["currency"] == "GBP"
    assert rep["monte_carlo"]["one_year"]["paths"] == 2000
    assert {d.get("symbol") or d.get("series") for d in rep["data"]} == {"SPY", "VUAG.L", "DGS3MO"}


def test_ticket_endpoint_and_validation(client):
    ok = client.post("/api/ticket/trend-sma", json={"account_value": 10000, "current_units": 0})
    assert ok.status_code == 200
    t = ok.json()
    assert t["action"] in ("BUY", "HOLD") and t["currency"] == "GBP" and t["symbol"] == "VUAG.L"
    bad = client.post("/api/ticket/trend-sma", json={"account_value": -5})
    assert bad.status_code == 422


def test_unknown_strategy_and_missing_data(client, cache, monkeypatch):
    assert client.get("/api/assessment/nope").status_code == 404
    assert client.get("/api/assessment/buy-hold").status_code == 404
    monkeypatch.setattr(store, "CACHE", cache / "empty")
    from app import server
    server._cache.clear()
    r = client.get("/api/assessment/trend-sma")
    assert r.status_code == 409 and "npm run data" in r.json()["detail"]


def test_failed_data_update_keeps_the_old_data(client, monkeypatch):
    from app import server

    def boom():
        raise RuntimeError("no network")
    monkeypatch.setattr(server.pipeline, "update_data", boom)
    r = client.post("/api/update-data")
    assert r.status_code == 502 and "no network" in r.json()["detail"]
    assert client.get("/api/assessment/trend-sma").status_code == 200


def test_dashboard_page_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "Jukebox" in r.text
    assert client.get("/static/app.js").status_code == 200
