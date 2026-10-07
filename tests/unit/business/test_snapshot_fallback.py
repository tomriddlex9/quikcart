"""Serving snapshot: pure plan building plus the Postgres-fallback job on a canned connection."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest

from quickcart.business import snapshot as snap
from quickcart.business.snapshot import (
    CategoryFact,
    InventoryFact,
    SnapshotInputs,
    StoreHourFact,
    build_plan,
    window_days,
)
from tests.unit.business.fakes import AS_OF, FakeOpsConn
from tests.unit.business.fakes import hour as _hour

BASELINE = AS_OF - timedelta(days=7)


def _inputs(**overrides: Any) -> SnapshotInputs:
    facts = [
        StoreHourFact(
            hour=_hour(AS_OF, 9),
            store_id=1,
            orders=10,
            cancelled=2,
            gmv=Decimal("1600.00"),
            delivered=8,
            late=2,
            timed_deliveries=8,
            delivery_minutes_sum=Decimal("200"),
        ),
        StoreHourFact(
            hour=_hour(AS_OF, 10),
            store_id=1,
            orders=5,
            cancelled=0,
            gmv=Decimal("900.00"),
            delivered=4,
            late=0,
            timed_deliveries=4,
            delivery_minutes_sum=Decimal("80"),
        ),
        StoreHourFact(
            hour=_hour(AS_OF, 9),
            store_id=2,
            orders=5,
            cancelled=1,
            gmv=Decimal("500.00"),
            delivered=0,
        ),
        StoreHourFact(  # same weekday last week: the baseline
            hour=_hour(BASELINE, 9),
            store_id=1,
            orders=20,
            cancelled=0,
            gmv=Decimal("4000.00"),
            delivered=20,
            late=0,
            timed_deliveries=20,
            delivery_minutes_sum=Decimal("400"),
        ),
    ]
    base = SnapshotInputs(
        source="postgres",
        as_of=AS_OF,
        days=window_days(AS_OF, 14),
        store_ids=[1, 2, 3],
        hour_facts=facts,
        payments={(_hour(AS_OF, 9), 1): (10, 1), (_hour(AS_OF, 9), 2): (5, 0)},
        customers={(AS_OF, None): 12, (AS_OF, 1): 9, (AS_OF, 2): 4},
        repeat={AS_OF: (3, 12)},
        inventory={
            None: InventoryFact(below_reorder=4, top_lines=20, top_below=2),
            1: InventoryFact(below_reorder=3, top_lines=10, top_below=2),
        },
        categories=[CategoryFact(AS_OF, "Dairy", Decimal("1200.00"), 40, 9)],
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def _daily(plan: snap.SnapshotPlan, scope: tuple[str, str], key: str, day: date) -> Any:
    rows = [
        r
        for r in plan.daily
        if (r.scope_type, r.scope_value) == scope and r.metric_key == key and r.day == day
    ]
    assert len(rows) == 1, (scope, key, day, rows)
    return rows[0]


def test_global_metrics_follow_the_registry_definitions() -> None:
    plan = build_plan(_inputs())
    g = ("global", "all")
    assert _daily(plan, g, "sales_gmv", AS_OF).value == Decimal("3000.0000")
    assert _daily(plan, g, "orders", AS_OF).value == 20
    # basket = GMV / (orders - cancelled) = 3000 / 17
    assert _daily(plan, g, "average_basket", AS_OF).value == Decimal("176.4706")
    assert _daily(plan, g, "cancel_rate", AS_OF).value == Decimal("0.1500")
    # late = 2 / delivered 12 ; on_time is exactly 1 - late
    late = _daily(plan, g, "late_rate", AS_OF).value
    on_time = _daily(plan, g, "on_time_rate", AS_OF).value
    assert late == Decimal("0.1667")
    assert on_time == Decimal("1") - late
    assert _daily(plan, g, "avg_delivery_minutes", AS_OF).value == Decimal("23.3333")
    assert _daily(plan, g, "payment_failure_rate", AS_OF).value == Decimal("0.0667")


def test_rates_are_null_when_the_denominator_is_zero() -> None:
    plan = build_plan(_inputs())
    store2 = ("store", "2")  # no deliveries
    assert _daily(plan, store2, "late_rate", AS_OF).value is None
    assert _daily(plan, store2, "on_time_rate", AS_OF).value is None
    assert _daily(plan, store2, "avg_delivery_minutes", AS_OF).value is None
    store3 = ("store", "3")  # no orders at all
    assert _daily(plan, store3, "orders", AS_OF).value == 0
    assert _daily(plan, store3, "average_basket", AS_OF).value is None
    assert _daily(plan, store3, "cancel_rate", AS_OF).value is None


def test_every_day_in_the_window_is_written_for_every_scope() -> None:
    plan = build_plan(_inputs())
    days = {r.day for r in plan.daily if r.metric_key == "orders"}
    assert days == set(window_days(AS_OF, 14))
    scopes = {(r.scope_type, r.scope_value) for r in plan.daily if r.metric_key == "orders"}
    assert scopes == {("global", "all"), ("store", "1"), ("store", "2"), ("store", "3")}


def test_customers_repeat_and_inventory_metrics() -> None:
    plan = build_plan(_inputs())
    g = ("global", "all")
    assert _daily(plan, g, "active_customers", AS_OF).value == 12
    assert _daily(plan, ("store", "3"), "active_customers", AS_OF).value == 0
    assert _daily(plan, g, "repeat_rate", AS_OF).value == Decimal("0.2500")
    assert _daily(plan, g, "stockout_risk_count", AS_OF).value == 4
    assert _daily(plan, g, "availability_bestsellers", AS_OF).value == Decimal("0.9000")
    store_avail = _daily(plan, ("store", "1"), "availability_bestsellers", AS_OF)
    assert store_avail.value == Decimal("0.8000")
    # inventory is a current reading: only the as-of day carries it
    assert not [r for r in plan.daily if r.metric_key == "stockout_risk_count" and r.day != AS_OF]


def test_hourly_rows_cover_sales_and_orders() -> None:
    plan = build_plan(_inputs())
    nine = [r for r in plan.hourly if r.scope_type == "global" and r.hour_start == _hour(AS_OF, 9)]
    assert {r.metric_key: r.value for r in nine} == {
        "sales_gmv": Decimal("2100.0000"),
        "orders": Decimal(15),
    }


def test_scorecards_one_row_per_store_day_with_health() -> None:
    plan = build_plan(_inputs())
    cards = {(c.store_id, c.day): c for c in plan.scorecards}
    assert len(cards) == 3 * 14
    store1 = cards[(1, AS_OF)]
    assert store1.values["sales"] == Decimal("2500.0000")
    assert store1.values["on_time_rate"] == Decimal("0.8333")
    assert store1.values["stockout_risk_count"] == 3
    # sales fell 37.5 % vs the baseline day and on-time is under the watch line
    assert store1.health_status == "bad"
    assert cards[(3, AS_OF)].values["orders"] == 0


def test_plan_is_deterministic_for_idempotent_upserts() -> None:
    first, second = build_plan(_inputs()), build_plan(_inputs())
    assert first.daily == second.daily
    keys = [(r.scope_type, r.scope_value, r.metric_key, r.day) for r in first.daily]
    assert len(keys) == len(set(keys)), "metric_daily keys must be unique per run"
    hour_keys = [(r.scope_type, r.scope_value, r.metric_key, r.hour_start) for r in first.hourly]
    assert len(hour_keys) == len(set(hour_keys))


def test_window_days_is_oldest_first_and_ends_at_as_of() -> None:
    days = window_days(AS_OF, 14)
    assert len(days) == 14 and days[-1] == AS_OF and days[0] == AS_OF - timedelta(days=13)


# --- job on a canned connection (Postgres fallback) -----------------------------------------


def test_run_serving_snapshot_without_readers_computes_from_postgres() -> None:
    conn = FakeOpsConn()
    run_id = snap.run_serving_snapshot(conn, None, days=14)  # type: ignore[arg-type]

    assert run_id == 7
    upserts = {sql.split("INTO ")[1].split(" ")[0]: rows for sql, rows in conn.bulk}
    assert set(upserts) == {
        "serving.metric_daily",
        "serving.metric_hourly",
        "serving.store_scorecard",
        "serving.category_daily",
    }
    assert all("ON CONFLICT" in sql for sql, _ in conn.bulk), "writes must be idempotent upserts"
    daily = upserts["serving.metric_daily"]
    sales = [r for r in daily if r[:4] == ("global", "all", "sales_gmv", AS_OF)]
    assert len(sales) == 1 and sales[0][4] == Decimal("300.0000") and sales[0][-1] == 7
    finish = [s for s in conn.statements if "status = 'succeeded'" in s]
    assert len(finish) == 1


def test_gold_facts_are_used_when_readers_are_available(monkeypatch: pytest.MonkeyPatch) -> None:
    gold_fact = StoreHourFact(
        hour=_hour(AS_OF, 11),
        store_id=2,
        orders=50,
        cancelled=0,
        gmv=Decimal("9999.00"),
    )
    monkeypatch.setattr(snap, "collect_gold_hour_facts", lambda readers, days: (AS_OF, [gold_fact]))
    conn = FakeOpsConn()

    snap.run_serving_snapshot(conn, object(), days=14)  # type: ignore[arg-type]

    daily = dict(conn.bulk)[next(sql for sql, _ in conn.bulk if "metric_daily" in sql)]
    gmv = [r for r in daily if r[:4] == ("global", "all", "sales_gmv", AS_OF)]
    assert gmv[0][4] == Decimal("9999.0000")  # Gold's number, not the Postgres rows
    assert any("'succeeded'" in s for s in conn.statements)


def test_unreadable_gold_falls_back_to_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(readers: Any, days: int) -> Any:
        raise RuntimeError("delta table missing")

    monkeypatch.setattr(snap, "collect_gold_hour_facts", broken)
    conn = FakeOpsConn()

    inputs = snap._collect_inputs(conn, object(), 14)  # type: ignore[arg-type]

    assert inputs.source == "postgres"
    assert "delta table missing" in inputs.detail["gold_error"]


def test_failed_run_is_marked_failed_and_reraised() -> None:
    conn = FakeOpsConn(fail_on="FROM payments")
    with pytest.raises(RuntimeError, match="boom"):
        snap.run_serving_snapshot(conn, None, days=14)  # type: ignore[arg-type]
    assert any("status = 'failed'" in s for s in conn.statements)
    assert not conn.bulk, "nothing is written when collection fails"


def test_window_must_cover_a_week_for_comparison() -> None:
    with pytest.raises(ValueError, match="at least 8"):
        snap.run_serving_snapshot(FakeOpsConn(), None, days=5)  # type: ignore[arg-type]
