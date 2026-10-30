"""Jukebox dashboard: a local web app (http://127.0.0.1:8050) over the research toolkit.

Decision support only. It shows signals, evidence and risk, and sizes order tickets that the human
places by hand. It never sends orders anywhere.
"""
from __future__ import annotations

import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from toolkit import data, pipeline, signals
from toolkit.strategies import REGISTRY

STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Jukebox", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

_lock = threading.Lock()
_cache: dict[tuple[str, str], dict] = {}


def _data_key() -> str:
    return "|".join(f"{m.get('symbol') or m.get('series')}:{m.get('sha256')}" for m in data.snapshot())


def assessment(strategy_id: str) -> dict:
    if strategy_id not in REGISTRY or strategy_id == "buy-hold":
        raise HTTPException(404, f"Unknown strategy {strategy_id}")
    key = (strategy_id, _data_key())
    with _lock:
        if key not in _cache:
            try:
                _cache.clear()
                _cache[key] = pipeline.assess(strategy_id)
            except FileNotFoundError as e:
                raise HTTPException(409, f"{e}. Use 'Update data' first.") from e
        return _cache[key]


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/strategies")
def strategies() -> list[dict]:
    return [{"id": s.id, "name": s.name, "description": s.description}
            for s in REGISTRY.values() if s.id != "buy-hold"]


@app.get("/api/assessment/{strategy_id}")
def get_assessment(strategy_id: str) -> dict:
    return assessment(strategy_id)


class TicketRequest(BaseModel):
    account_value: float = Field(gt=0, description="Account value in the trading currency")
    current_units: int = Field(ge=0, default=0)
    max_allocation: float = Field(gt=0, le=1, default=1.0)
    commission: float = Field(ge=0, default=3.0)


@app.post("/api/ticket/{strategy_id}")
def make_ticket(strategy_id: str, req: TicketRequest) -> dict:
    rep = assessment(strategy_id)
    s = rep["signal"]
    sig = signals.Signal(s["as_of"], s["target"], s["previous"], s["changed"], s["since"], s["detail"])
    tp = rep["trade_price"]
    t = signals.ticket(sig, tp["symbol"], tp["price"], tp["currency"], req.account_value,
                       req.current_units, req.max_allocation, commission=req.commission)
    return {**t.to_dict(), "price_as_of": tp["as_of"]}


@app.post("/api/update-data")
def update_data() -> dict:
    try:
        rows = pipeline.update_data()
    except Exception as e:  # network or source failure: report, keep the old cache
        raise HTTPException(502, f"Data update failed: {e}") from e
    with _lock:
        _cache.clear()
    return {"updated": rows}
