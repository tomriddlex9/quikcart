"""Unit coverage for the live operational API helpers."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.gold_cache import GoldReadersTTLCache
from quickcart.api.live import (
    _sse_events,
    build_live_snapshot,
    register_live_routes,
)
from tests.unit.api.fakes import FakeConnectFactory


def _snapshot_responder(statement: str) -> tuple[list[str], list[dict[str, Any]]]:
    if "generate_series" in statement:
        return ["minute", "orders", "gmv"], [
            {
                "minute": datetime(2026, 9, 24, 21, 0, tzinfo=UTC),
                "orders": 2,
                "gmv": Decimal("27.50"),
            }
        ]
    if "ORDER BY placed_at DESC" in statement:
        return [
            "order_id",
            "store_id",
            "status",
            "total_amount",
            "placed_at",
            "customer_id",
        ], [
            {
                "order_id": 91,
                "store_id": 3,
                "status": "PLACED",
                "total_amount": Decimal("15.50"),
                "placed_at": datetime(2026, 9, 24, 21, 0, tzinfo=UTC),
                "customer_id": 7,
            }
        ]
    if "FROM payments" in statement:
        return ["failure_rate"], [{"failure_rate": Decimal("0.25")}]
    if "FROM deliveries" in statement:
        return ["active_deliveries"], [{"active_deliveries": 4}]
    if "GROUP BY store_id" in statement:
        return ["store_id", "orders_1m", "orders_15m", "gmv_15m"], [
            {
                "store_id": 3,
                "orders_1m": 1,
                "orders_15m": 5,
                "gmv_15m": Decimal("71.25"),
            }
        ]
    if "GROUP BY status" in statement:
        return ["status", "orders"], [{"status": "PLACED", "orders": 5}]
    return [
        "orders_1m",
        "orders_15m",
        "orders_60m",
        "gmv_1m",
        "gmv_15m",
        "gmv_60m",
    ], [
        {
            "orders_1m": 1,
            "orders_15m": 5,
            "orders_60m": 12,
            "gmv_1m": Decimal("15.50"),
            "gmv_15m": Decimal("71.25"),
            "gmv_60m": Decimal("190.00"),
        }
    ]


def test_build_live_snapshot_has_contract_shape_and_uses_read_only_connection() -> None:
    factory = FakeConnectFactory(responder=_snapshot_responder)

    snapshot = build_live_snapshot(
        connect_factory=factory,
        generated_at=datetime(2026, 9, 24, 21, 1, tzinfo=UTC),
    )

    assert snapshot.model_dump() == {
        "generated_at": "2026-09-24T21:01:00Z",
        "orders_1m": 1,
        "orders_15m": 5,
        "orders_60m": 12,
        "gmv_1m": 15.5,
        "gmv_15m": 71.25,
        "gmv_60m": 190.0,
        "orders_per_minute": [
            {"minute": "2026-09-24T21:00:00Z", "orders": 2, "gmv": 27.5}
        ],
        "status_mix": {"PLACED": 5},
        "per_store": [{"store_id": 3, "orders_1m": 1, "orders_15m": 5, "gmv_15m": 71.25}],
        "recent_orders": [
            {
                "order_id": 91,
                "store_id": 3,
                "status": "PLACED",
                "total_amount": 15.5,
                "placed_at": "2026-09-24T21:00:00Z",
                "customer_id": 7,
            }
        ],
        "payment_failure_rate_15m": 0.25,
        "active_deliveries": 4,
    }
    assert factory.last.read_only is True
    assert factory.last.closed is True


def test_snapshot_route_returns_live_snapshot() -> None:
    app = FastAPI()
    app.state.connect_factory = FakeConnectFactory(responder=_snapshot_responder)
    app.state.data_root = Path("unused")
    register_live_routes(app)

    with TestClient(app) as client:
        response = client.get("/api/v1/live/snapshot")

    assert response.status_code == 200
    assert response.json()["orders_15m"] == 5
    assert response.json()["recent_orders"][0]["order_id"] == 91


def test_sse_event_is_data_framed_json() -> None:
    snapshot = build_live_snapshot(
        connect_factory=FakeConnectFactory(responder=_snapshot_responder),
        generated_at=datetime(2026, 9, 24, 21, 1, tzinfo=UTC),
    )
    events = _sse_events(lambda: snapshot, interval_seconds=0)

    event = _run_first(events)

    assert event.startswith("data: ")
    assert event.endswith("\n\n")
    assert json.loads(event.removeprefix("data: ").strip())["orders_1m"] == 1


def test_pipeline_route_combines_postgres_offsets_delta_and_heartbeats(tmp_path: Path) -> None:
    heartbeat_at = datetime(2026, 9, 24, 21, 0, tzinfo=UTC)

    def responder(statement: str) -> tuple[list[str], list[dict[str, Any]]]:
        if statement.strip().startswith("SELECT stage"):
            return [
                "stage",
                "last_run_at",
                "rows_in",
                "rows_out",
                "lag_seconds",
                "error",
                "detail",
                "updated_at",
            ], [
                {
                    "stage": "gold_refresh",
                    "last_run_at": heartbeat_at,
                    "rows_in": 8,
                    "rows_out": 7,
                    "lag_seconds": 3.5,
                    "error": None,
                    "detail": {"mode": "incremental"},
                    "updated_at": heartbeat_at,
                }
            ]
        return ["table_name", "row_count"], [{"table_name": "orders", "row_count": 12}]

    table = tmp_path / "gold" / "gold_store_hourly_metrics"
    log_dir = table / "_delta_log"
    log_dir.mkdir(parents=True)
    (log_dir / "00000000000000000000.json").write_text(
        json.dumps({"add": {"path": "part.parquet", "stats": '{"numRecords": 7}'}}) + "\n",
        encoding="utf-8",
    )
    app = FastAPI()
    app.state.connect_factory = FakeConnectFactory(responder=responder)
    app.state.data_root = tmp_path
    app.state.redpanda_offset_reader = lambda: {"quickcart.order-events.v1": 19}
    register_live_routes(app)

    with TestClient(app) as client:
        response = client.get("/api/v1/live/pipeline")

    assert response.status_code == 200
    payload = response.json()
    assert payload["counts"]["postgres"]["orders"] == 12
    assert payload["counts"]["redpanda"]["quickcart.order-events.v1"] == 19
    assert payload["counts"]["gold"]["gold_store_hourly_metrics"] == 7
    assert payload["heartbeats"][0]["detail"] == {"mode": "incremental"}
    assert payload["gold_refreshed_at"] == "2026-09-24T21:00:00Z"
    assert payload["end_to_end_lag_seconds"] == 3.5


def _run_first(events: Any) -> str:
    import asyncio

    return asyncio.run(anext(events))


class _Readers:
    def __init__(self) -> None:
        self.calls = 0

    def kpi_summary(self) -> dict[str, int]:
        self.calls += 1
        return {"orders": self.calls}


def test_gold_cache_reuses_values_until_ttl_expires() -> None:
    now = [100.0]
    readers = _Readers()
    cache = GoldReadersTTLCache(readers, ttl_seconds=30, clock=lambda: now[0])

    assert cache.kpi_summary() == {"orders": 1}
    assert cache.kpi_summary() == {"orders": 1}
    now[0] = 131.0
    assert cache.kpi_summary() == {"orders": 2}
    assert readers.calls == 2
