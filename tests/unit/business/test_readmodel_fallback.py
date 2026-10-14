"""ReadModel serves live SQL (same builder as the snapshot) until serving.* exists."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from quickcart.api.business.readmodel import ReadModel
from quickcart.api.business.service import BusinessService
from tests.unit.business.fakes import AS_OF, FakeOpsConn


def test_missing_serving_schema_falls_back_to_live_sql() -> None:
    conn = FakeOpsConn(serving_missing=True)
    rm = ReadModel(conn)  # type: ignore[arg-type]

    as_of = rm.as_of()
    assert as_of.source == "live_sql" and as_of.day == AS_OF and as_of.snapshot_run_id is None

    series = rm.metric_series("global", "all", [AS_OF, AS_OF - timedelta(days=7)])
    assert series["sales_gmv"][AS_OF] == Decimal("300.0000")
    assert series["orders"][AS_OF] == 4
    assert series["late_rate"][AS_OF] == Decimal("0.3333")
    assert series["on_time_rate"][AS_OF] == Decimal("0.6667")

    days = rm.store_days([AS_OF])
    assert days[AS_OF][1].values["sales_gmv"] == 300.0
    assert rm.category_sales([AS_OF])[0]["category"] == "Dairy"
    assert rm.hourly_trend("global", "all", AS_OF)[0]["orders"] == 4


def test_service_works_end_to_end_on_the_fallback() -> None:
    rm = ReadModel(FakeOpsConn(serving_missing=True))  # type: ignore[arg-type]
    service = BusinessService(rm)

    today = service.today()

    assert today.meta.source == "live_sql"
    assert today.headline[0].label == "Sales" and today.headline[0].display == "₹300"
    assert today.headline[0].status == "unknown"  # no same-day-last-week baseline yet
    assert today.live is not None
    assert today.live.orders_1m == 2
    assert today.live.orders_15m == 8
    assert today.live.gmv_15m == 150.0
    assert today.live.active_deliveries == 3
    assert today.live.payment_failure_rate_15m == 0.1
    cards = service.store_scorecards().stores
    assert [c.store_name for c in cards] == ["Koramangala"]


def test_stale_snapshot_recomputes_the_full_day_and_keeps_the_run_id() -> None:
    finished = datetime(2026, 9, 21, 8, tzinfo=UTC)
    conn = FakeOpsConn(
        snapshot_rows=[
            {
                "snapshot_run_id": 19,
                "finished_at": finished,
                "as_of_day": AS_OF - timedelta(days=1),
            }
        ]
    )
    rm = ReadModel(conn)  # type: ignore[arg-type]

    as_of = rm.as_of()

    assert as_of.source == "live_sql"
    assert as_of.day == AS_OF
    assert as_of.snapshot_run_id == 19
    assert as_of.finished_at == finished
    note = rm.freshness_note()
    assert note is not None and "behind live orders" in note
    series = rm.metric_series("global", "all", [AS_OF])
    assert series["sales_gmv"][AS_OF] == Decimal("300.0000")


def test_fresh_snapshot_stays_on_serving() -> None:
    conn = FakeOpsConn(
        snapshot_rows=[
            {
                "snapshot_run_id": 4,
                "finished_at": datetime(2026, 9, 22, 18, tzinfo=UTC),
                "as_of_day": AS_OF,
            }
        ]
    )
    rm = ReadModel(conn)  # type: ignore[arg-type]

    as_of = rm.as_of()

    assert as_of.source == "serving"
    assert as_of.snapshot_run_id == 4
    assert as_of.day == AS_OF
    assert rm.freshness_note() is None


def test_newer_orders_after_a_same_day_snapshot_mark_it_stale() -> None:
    conn = FakeOpsConn(
        snapshot_rows=[
            {
                "snapshot_run_id": 4,
                "finished_at": datetime(2026, 9, 22, 8, tzinfo=UTC),
                "as_of_day": AS_OF,
            }
        ],
        orders_after=[{"order_id": 99}],
    )
    as_of = ReadModel(conn).as_of()  # type: ignore[arg-type]

    assert as_of.source == "live_sql"
    assert as_of.day == AS_OF
    assert as_of.snapshot_run_id == 4
