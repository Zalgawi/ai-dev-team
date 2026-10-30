"""Today's signal and a manual order ticket. Decision support only: the human places every order.

Research runs on the instrument with the longest clean history (e.g. SPY), but UK retail accounts
generally can't buy US-domiciled ETFs (no PRIIPs key information document), so the ticket is sized
in a UK-listed UCITS equivalent the human can actually buy (e.g. VUAG on the LSE, priced in GBP).
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import pandas as pd


@dataclass
class Signal:
    as_of: str                 # date of the close the signal uses
    target: float              # target weight now (0 = cash, 1 = fully invested)
    previous: float            # target at the previous close
    changed: bool
    since: str                 # date the current target started
    detail: dict

    def to_dict(self) -> dict:
        return asdict(self)


def latest(targets: pd.Series, detail: dict | None = None) -> Signal:
    t = targets.dropna()
    if t.empty:
        raise ValueError("No target weights to read a signal from.")
    now, prev = float(t.iloc[-1]), float(t.iloc[-2]) if len(t) > 1 else 0.0
    runs = t.ne(t.shift()).cumsum()
    since = t[runs == runs.iloc[-1]].index[0]
    return Signal(str(t.index[-1].date()), now, prev, now != prev, str(since.date()), detail or {})


@dataclass
class Ticket:
    action: str                # BUY, SELL or HOLD
    symbol: str
    units: int                 # to buy or sell (positive)
    current_units: int
    target_units: int
    price: float               # last close of the trading instrument
    currency: str
    limit: float | None        # suggested limit price
    value: float               # approximate value of the order
    est_cost: float            # commission + half-spread estimate
    target_weight: float
    notes: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def ticket(signal: Signal, symbol: str, price: float, currency: str, account_value: float,
           current_units: int = 0, max_allocation: float = 1.0, limit_buffer: float = 0.005,
           commission: float = 3.0, spread_bps: float = 5.0) -> Ticket:
    """Sizes the order that moves the account to the signal's target weight, in whole units.

    `max_allocation` caps the share of the account this strategy may use (position sizing is the
    human's choice; see the Kelly figures as an upper bound, never a target). `commission` is a flat
    estimate per order in the account currency; IBKR's UK tiered pricing is usually a few pounds."""
    if account_value <= 0 or price <= 0:
        raise ValueError("account value and price must be positive")
    if current_units < 0:
        raise ValueError("current units can't be negative")
    weight = max(0.0, min(1.0, signal.target)) * max(0.0, min(1.0, max_allocation))
    target_units = math.floor(weight * account_value / price)
    delta = target_units - current_units
    action = "BUY" if delta > 0 else "SELL" if delta < 0 else "HOLD"
    units = abs(delta)
    value = units * price
    limit = None
    if action == "BUY":
        limit = round(price * (1 + limit_buffer), 2)
    elif action == "SELL":
        limit = round(price * (1 - limit_buffer), 2)
    est_cost = (commission + value * spread_bps / 20_000) if units else 0.0

    notes = [f"Signal from the close of {signal.as_of}; check the live price before trading.",
             "If the price has moved more than 2% since that close, recheck the signal first.",
             "You place this order yourself in IBKR. Nothing is sent automatically."]
    if action != "HOLD" and value < 20 * commission:
        notes.append("This order is small relative to the commission; consider skipping it.")
    if weight < signal.target:
        notes.append(f"Capped at {max_allocation:.0%} of the account by your allocation limit.")
    return Ticket(action, symbol, units, current_units, target_units, round(price, 4), currency, limit,
                  round(value, 2), round(est_cost, 2), weight, notes)
