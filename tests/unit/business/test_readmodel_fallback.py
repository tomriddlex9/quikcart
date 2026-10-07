"""ReadModel serves live SQL (same builder as the snapshot) until serving.* exists."""

from __future__ import annotations

from datetime import timedelta
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
    cards = service.store_scorecards().stores
    assert [c.store_name for c in cards] == ["Koramangala"]
