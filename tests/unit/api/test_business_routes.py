"""Business API routes (``/api/v1/b/*``) over a stubbed read model.

The stub replaces the database-facing layer only; the service, registry-driven
wording, status rules, and routing are the real ones.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.business import register_business_routes
from quickcart.api.business.readmodel import AsOf, ReadModel, StoreDay, StoreInfo
from quickcart.api.business.router import get_readmodel
from quickcart.business.snapshot import SCORECARD_COLUMNS

DAY = date(2026, 9, 22)
BASE = DAY - timedelta(days=7)


def _store_values(**over: float | None) -> dict[str, float | None]:
    values: dict[str, float | None] = {
        "sales_gmv": 120000.0,
        "orders": 300.0,
        "average_basket": 410.0,
        "on_time_rate": 0.93,
        "late_rate": 0.07,
        "cancel_rate": 0.02,
        "avg_delivery_minutes": 21.0,
        "payment_failure_rate": 0.02,
        "stockout_risk_count": 2.0,
        "active_customers": 250.0,
    }
    values.update(over)
    return values


class StubReadModel(ReadModel):
    def __init__(self) -> None:  # no connection
        pass

    def as_of(self) -> AsOf:
        return AsOf(DAY, "serving", 4, datetime(2026, 9, 22, 12, 0, tzinfo=UTC))

    def stores(self) -> dict[int, StoreInfo]:
        return {
            1: StoreInfo(1, "Koramangala", "Bengaluru"),
            2: StoreInfo(2, "Indiranagar", "Bengaluru"),
        }

    def metric_series(self, scope_type: str, scope_value: str, days: list[date]) -> Any:
        def both(today: float | None, base: float | None) -> dict[date, Any]:
            return {DAY: today, BASE: base}

        series = {
            "sales_gmv": both(250000.0, 200000.0),
            "orders": both(600.0, 580.0),
            "average_basket": both(416.0, 345.0),
            "on_time_rate": both(0.78, 0.92),  # watch (<= 0.85), above bad line
            "late_rate": both(0.22, 0.08),
            "cancel_rate": both(0.03, 0.02),
            "avg_delivery_minutes": both(27.0, 22.0),
            "payment_failure_rate": both(0.04, 0.04),
            "availability_bestsellers": {DAY: 0.95},
            "stockout_risk_count": {DAY: 12.0},
            "active_customers": both(500.0, 480.0),
            "repeat_rate": both(0.30, 0.31),
        }
        if scope_type == "store":
            return {
                k: {d: v * 0.5 if v and v > 1 else v for d, v in s.items()}
                for k, s in series.items()
            }
        return {
            k: {d: Decimal(str(v)) if v is not None else None for d, v in s.items()}
            for k, s in series.items()
        }

    def store_days(self, days: list[date]) -> dict[date, dict[int, StoreDay]]:
        return {
            DAY: {
                1: StoreDay(_store_values(on_time_rate=0.70, late_rate=0.30), "bad"),
                2: StoreDay(_store_values(), "good"),
            },
            BASE: {
                1: StoreDay(_store_values(sales_gmv=130000.0), "good"),
                2: StoreDay(_store_values(sales_gmv=118000.0), "good"),
            },
        }

    def hourly_trend(self, scope_type: str, scope_value: str, day: date) -> list[dict[str, Any]]:
        return [
            {
                "at": datetime(2026, 9, 22, 9, tzinfo=UTC),
                "sales": Decimal("5000"),
                "orders": Decimal(12),
            }
        ]

    def category_sales(self, days: list[date]) -> list[dict[str, Any]]:
        return [
            {"category": "Dairy", "sales": Decimal("150000"), "units": 900},
            {"category": "Snacks", "sales": Decimal("100000"), "units": 700},
        ]

    def running_low(self, limit: int, store_id: int | None = None) -> list[dict[str, Any]]:
        return [
            {
                "store_id": 1,
                "store_name": "Koramangala",
                "product_id": 10,
                "sku": "MLK-1",
                "name": "Milk 1L",
                "category": "Dairy",
                "on_hand_qty": 0,
                "reorder_point": 20,
                "units_7d": 140,
            },
            {
                "store_id": 2,
                "store_name": "Indiranagar",
                "product_id": 11,
                "sku": "BRD-1",
                "name": "Bread",
                "category": "Bakery",
                "on_hand_qty": 6,
                "reorder_point": 10,
                "units_7d": 168,
            },
        ][:limit]

    def bestsellers(self, limit: int) -> list[dict[str, Any]]:
        return [
            {
                "product_id": 10,
                "sku": "MLK-1",
                "name": "Milk 1L",
                "category": "Dairy",
                "units": 900,
                "revenue": Decimal("54000"),
            }
        ]

    def slow_movers(self, limit: int) -> list[dict[str, Any]]:
        return [
            {
                "product_id": 12,
                "sku": "TEA-9",
                "name": "Rare Tea",
                "category": "Beverages",
                "units": 0,
                "revenue": Decimal("0"),
                "on_hand": 40,
            }
        ]

    def delivery_state(self) -> dict[str, dict[str, int]]:
        return {
            "in_progress": {"ASSIGNED": 4, "PICKED_UP": 6},
            "riders": {"AVAILABLE": 3, "BUSY": 9},
        }

    def customer_state(self, day: date) -> dict[str, Any]:
        return {
            "total_customers": 1200,
            "new_customers": 35,
            "top_customers": [
                {
                    "customer_code": "C-0001",
                    "orders": 14,
                    "spend": Decimal("18250.50"),
                    "last_order_at": datetime(2026, 9, 22, tzinfo=UTC),
                }
            ],
        }

    def money_state(self, day: date) -> dict[str, Decimal]:
        return {"discounts": Decimal("12000"), "refunds": Decimal("3000")}

    def margin_for_day(self, day: date) -> dict[str, Decimal | None]:
        return {
            "cogs": Decimal("100000"),
            "contribution_margin": Decimal("147000"),
            "net_sales": Decimal("247000"),
        }

    def list_targets(self, period_start: date) -> list[dict[str, Any]]:
        return []

    def open_alerts(self, limit: int = 20) -> list[dict[str, Any]]:
        return []

    def list_reports(self, limit: int = 20) -> list[dict[str, Any]]:
        return []

    def create_report(
        self, title: str, spec: dict[str, Any], created_by: int | None
    ) -> dict[str, Any]:
        return {
            "report_id": 1,
            "title": title,
            "schedule": None,
            "created_at": datetime(2026, 9, 22, 12, 0, tzinfo=UTC),
        }


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = FastAPI()
    register_business_routes(app)
    app.dependency_overrides[get_readmodel] = StubReadModel
    yield TestClient(app)


def test_today_is_plain_language_with_statuses(client: TestClient) -> None:
    body = client.get("/api/v1/b/today").json()

    assert [m["key"] for m in body["headline"]] == [
        "sales_gmv",
        "orders",
        "average_basket",
        "on_time_rate",
        "cancel_rate",
    ]
    sales = body["headline"][0]
    assert sales["label"] == "Sales"
    assert sales["display"] == "₹2.50 L"
    assert sales["delta_pct"] == 25.0
    assert sales["compare_to"] == "same_day_last_week"
    assert sales["explanation"] == "Sales is ₹2.50 L, up 25.0% on the same day last week."
    assert sales["status"] == "good"
    on_time = body["headline"][3]
    assert on_time["display"] == "78.0%" and on_time["status"] == "watch"
    assert body["meta"]["source"] == "serving" and body["meta"]["snapshot_run_id"] == 4
    assert body["meta"]["as_of_day"] == "2026-09-22"
    assert body["meta"]["is_today"] is False and "latest day with orders" in body["meta"]["note"]
    assert any(m["key"] == "repeat_rate" and m["is_partial"] for m in body["more"])


def test_today_attention_lists_global_and_store_problems_worst_first(client: TestClient) -> None:
    body = client.get("/api/v1/b/today").json()
    items = body["attention"]

    assert items, "expected attention items"
    severities = [i["severity"] for i in items]
    assert severities == sorted(severities, key=lambda s: s != "bad")
    store_items = [i for i in items if i["store_id"] == 1]
    assert any(i["metric_key"] == "on_time_rate" and i["severity"] == "bad" for i in store_items)
    assert "attention" in body["summary"]


def test_on_time_and_late_rate_are_complementary_in_store_cards(client: TestClient) -> None:
    cards = client.get("/api/v1/b/stores/scorecards").json()["stores"]
    for card in cards:
        on_time, late = (
            card["metrics"]["on_time_rate"]["value"],
            card["metrics"]["late_rate"]["value"],
        )
        assert on_time + late == pytest.approx(1.0)


def test_store_scorecards_sorted_worst_first(client: TestClient) -> None:
    body = client.get("/api/v1/b/stores/scorecards").json()

    assert [s["store_name"] for s in body["stores"]] == ["Koramangala", "Indiranagar"]
    first = body["stores"][0]
    assert first["status"] == "bad"
    assert set(first["metrics"]) == set(SCORECARD_COLUMNS)
    assert first["attention"] and "On-time deliveries" in first["attention"][0]
    assert body["stores"][1]["status"] == "good"


def test_store_detail_and_unknown_store(client: TestClient) -> None:
    body = client.get("/api/v1/b/stores/1").json()
    assert body["scorecard"]["store_name"] == "Koramangala"
    assert len(body["daily_trend"]) == 14
    assert body["hourly_trend"][0]["orders"] == 12
    assert body["running_low"][0]["name"] == "Milk 1L"

    missing = client.get("/api/v1/b/stores/99")
    assert missing.status_code == 404
    assert "store 99" in missing.json()["detail"]


def test_products_tabs(client: TestClient) -> None:
    low = client.get("/api/v1/b/products").json()
    assert low["tab"] == "running_low"
    assert low["items"][0]["status"] == "bad" and "Out of stock" in low["items"][0]["note"]
    bread = low["items"][1]
    assert bread["stock_cover_hours"] == 6.0 and bread["status"] == "bad"

    best = client.get("/api/v1/b/products", params={"tab": "bestsellers"}).json()
    assert best["items"][0]["revenue_display"] == "₹54,000"

    slow = client.get("/api/v1/b/products", params={"tab": "slow"}).json()
    assert slow["items"][0]["status"] == "watch" and "No sales" in slow["items"][0]["note"]

    assert client.get("/api/v1/b/products", params={"tab": "nope"}).status_code == 422
    assert client.get("/api/v1/b/products", params={"limit": 0}).status_code == 422


def test_delivery_health(client: TestClient) -> None:
    body = client.get("/api/v1/b/delivery/health").json()
    assert [m["key"] for m in body["metrics"]] == [
        "on_time_rate",
        "late_rate",
        "avg_delivery_minutes",
    ]
    assert body["by_store"][0]["store_name"] == "Koramangala"
    assert body["in_progress"] == {"ASSIGNED": 4, "PICKED_UP": 6}
    assert body["riders"]["AVAILABLE"] == 3


def test_customers_health(client: TestClient) -> None:
    body = client.get("/api/v1/b/customers/health").json()
    assert body["new_customers"] == 35 and body["total_customers"] == 1200
    assert body["top_customers"][0]["spend_display"] == "₹18,250"
    assert {m["key"] for m in body["metrics"]} == {"active_customers", "repeat_rate"}


def test_money(client: TestClient) -> None:
    body = client.get("/api/v1/b/money").json()
    assert body["sales"]["display"] == "₹2.50 L"
    assert body["discounts_display"] == "₹12,000"
    assert body["refunds_display"] == "₹3,000"
    assert body["net_sales"] == 247000.0
    assert body["by_category"][0]["category"] == "Dairy"
    assert body["by_category"][0]["share_pct"] == 0.6
    assert len(body["daily_trend"]) == 7


def test_alerts_stub_is_empty(client: TestClient) -> None:
    body = client.get("/api/v1/b/alerts").json()
    assert body["items"] == []


def test_metrics_catalog_and_explain(client: TestClient) -> None:
    catalog = client.get("/api/v1/b/metrics").json()["metrics"]
    assert {m["key"] for m in catalog} >= {"sales_gmv", "on_time_rate", "repeat_rate"}
    on_time = next(m for m in catalog if m["key"] == "on_time_rate")
    assert "1 minus the late rate" in on_time["formula_text"]

    explain = client.get("/api/v1/b/metrics/late_rate/explain").json()
    assert explain["definition"]["label"] == "Late deliveries"
    assert explain["current"]["status"] == "watch"
    assert "late" in explain["current"]["explanation"]
    assert client.get("/api/v1/b/metrics/bogus/explain").status_code == 404


def test_journeys(client: TestClient) -> None:
    journeys = client.get("/api/v1/b/journeys").json()
    assert [j["id"] for j in journeys] == ["A", "B", "C", "D", "E"]
    by_id = {j["id"]: j["step_count"] for j in journeys}
    assert by_id == {"A": 4, "B": 4, "C": 4, "D": 4, "E": 5}

    step = client.get("/api/v1/b/journeys/a/steps/1").json()
    assert step["journey_id"] == "A" and step["prev_n"] is None and step["next_n"] == 2
    last = client.get("/api/v1/b/journeys/C/steps/4").json()
    assert last["next_n"] is None and last["prev_n"] == 3
    assert client.get("/api/v1/b/journeys/Z/steps/1").status_code == 404
    assert client.get("/api/v1/b/journeys/A/steps/9").status_code == 404


def test_database_down_returns_503_not_500() -> None:
    def refuse(*_: Any, **__: Any) -> psycopg.Connection:
        raise psycopg.OperationalError("connection refused")

    app = FastAPI()
    app.state.connect_factory = refuse
    register_business_routes(app)

    response = TestClient(app).get("/api/v1/b/today")

    assert response.status_code == 503
    assert "not reachable" in response.json()["detail"]
    # static endpoints need no database at all
    assert TestClient(app).get("/api/v1/b/metrics").status_code == 200


def test_routes_are_mounted_in_the_main_app() -> None:
    from quickcart.api.app import create_app

    paths = set(create_app().openapi()["paths"])
    for expected in (
        "/api/v1/b/today",
        "/api/v1/b/stores/scorecards",
        "/api/v1/b/stores/{store_id}",
        "/api/v1/b/products",
        "/api/v1/b/delivery/health",
        "/api/v1/b/customers/health",
        "/api/v1/b/money",
        "/api/v1/b/alerts",
        "/api/v1/b/metrics",
        "/api/v1/b/metrics/{key}/explain",
        "/api/v1/b/journeys",
        "/api/v1/b/journeys/{journey_id}/steps/{n}",
    ):
        assert expected in paths
