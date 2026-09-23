"""Aggregate causal-direction checks on generated history (kit/07 Phase 1).

Pure in-memory generation — no database required.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal

import pytest

from quickcart.simulator.config import SimulatorConfig
from quickcart.simulator.generator import generate_history


@pytest.fixture(scope="module")
def history():
    cfg = SimulatorConfig(seed=7, stores=4, products=400, customers=1500, riders=16, orders=6000)
    return generate_history(cfg)


@pytest.mark.unit
def test_weekend_demand_exceeds_weekday(history) -> None:
    per_day: dict[date, int] = defaultdict(int)
    for row in history.orders:
        per_day[row[13].date()] += 1
    weekend = [n for d, n in per_day.items() if d.weekday() >= 5]
    weekday = [n for d, n in per_day.items() if d.weekday() < 5]
    assert sum(weekend) / len(weekend) > sum(weekday) / len(weekday)


@pytest.mark.unit
def test_peak_hours_outsell_offpeak(history) -> None:
    peak = sum(1 for row in history.orders if row[13].hour in (12, 13, 14, 18, 19, 20, 21, 22))
    offpeak = sum(1 for row in history.orders if 2 <= row[13].hour <= 6)
    assert peak > offpeak * 1.5


@pytest.mark.unit
def test_rain_increases_delivery_minutes(history) -> None:
    weather = {(day, store): condition for day, store, condition in history.weather_series}
    orders = {row[0]: row for row in history.orders}
    ride_minutes: dict[str, list[float]] = defaultdict(list)
    for d in history.deliveries:
        if d[6] is None or d[5] is None:
            continue
        order = orders[d[1]]
        condition = weather[(order[13].date(), order[2])]
        ride_minutes[condition].append((d[6] - d[5]).total_seconds() / 60.0)
    assert len(ride_minutes["RAIN"]) >= 30
    assert len(ride_minutes["CLEAR"]) >= 30
    rain_mean = sum(ride_minutes["RAIN"]) / len(ride_minutes["RAIN"])
    clear_mean = sum(ride_minutes["CLEAR"]) / len(ride_minutes["CLEAR"])
    assert rain_mean > clear_mean


@pytest.mark.unit
def test_bigger_baskets_take_longer_to_pick(history) -> None:
    units: dict[int, int] = defaultdict(int)
    for row in history.order_items:
        units[row[1]] += row[3]
    pick: dict[str, list[float]] = defaultdict(list)
    for d in history.deliveries:
        if d[5] is None or d[4] is None:
            continue
        bucket = "big" if units[d[1]] >= 5 else "small" if units[d[1]] <= 2 else None
        if bucket:
            pick[bucket].append((d[5] - d[4]).total_seconds() / 60.0)
    assert len(pick["big"]) >= 20 and len(pick["small"]) >= 20
    big_mean = sum(pick["big"]) / len(pick["big"])
    small_mean = sum(pick["small"]) / len(pick["small"])
    assert big_mean > small_mean * 1.2


@pytest.mark.unit
def test_every_order_has_items_and_nonnegative_money(history) -> None:
    order_ids_with_items = {row[1] for row in history.order_items}
    all_order_ids = {row[0] for row in history.orders}
    assert order_ids_with_items == all_order_ids
    for row in history.orders:
        assert row[6] >= Decimal("0.00")  # subtotal
        assert row[11] >= Decimal("0.00")  # total_amount


@pytest.mark.unit
def test_promo_orders_carry_a_benefit(history) -> None:
    promo_rows = [row for row in history.orders if row[4] is not None]
    assert promo_rows
    for row in promo_rows:
        assert row[8] > Decimal("0.00") or row[9] == Decimal("0.00")


@pytest.mark.unit
def test_cancelled_orders_have_no_delivery_time(history) -> None:
    cancelled = [d for d in history.deliveries if d[9] == "CANCELLED"]
    delivered = [d for d in history.deliveries if d[9] == "DELIVERED"]
    assert cancelled and delivered
    assert all(d[6] is None for d in cancelled)
    assert all(d[6] is not None for d in delivered)
