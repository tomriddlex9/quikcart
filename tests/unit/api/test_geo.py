"""Geo map store API."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quickcart.api.app import create_app
from quickcart.api.geo import build_geo_stores, demo_geo_stores
from tests.unit.api.fakes import FakeConnectFactory

pytestmark = pytest.mark.unit

STORE_ROWS = [
    {
        "store_id": 1,
        "name": "QC Mumbai Central",
        "city": "Mumbai",
        "latitude": Decimal("19.076000"),
        "longitude": Decimal("72.877000"),
    },
]


def _geo_responder(statement: str) -> tuple[list[str], list[dict]]:
    if "FROM stores" in statement:
        return ["store_id", "name", "city", "latitude", "longitude"], STORE_ROWS
    return [], []


def _seed_weather(root: Path, day: date) -> None:
    partition = root / "raw" / "weather" / f"load_date={day.isoformat()}"
    partition.mkdir(parents=True, exist_ok=True)
    row = {
        "store_id": 1,
        "city": "Mumbai",
        "observed_at": "2026-09-23T12:00",
        "temperature_c": 30.2,
        "condition": "CLEAR",
        "source": "fixture",
    }
    (partition / "weather.json").write_text(json.dumps(row) + "\n", encoding="utf-8")


def _seed_traffic(root: Path, day: date) -> None:
    partition = root / "raw" / "traffic" / f"load_date={day.isoformat()}"
    partition.mkdir(parents=True, exist_ok=True)
    row = {
        "store_id": 1,
        "city": "Mumbai",
        "observed_at": "2026-09-23T12:00:00+00:00",
        "baseline_eta_sec": 420,
        "actual_eta_sec": 540,
        "eta_delay_sec": 120,
        "source": "fixture",
    }
    (partition / "traffic.json").write_text(json.dumps(row) + "\n", encoding="utf-8")


def test_demo_geo_stores_has_coordinates() -> None:
    stores = demo_geo_stores()
    assert len(stores) >= 5
    assert stores[0].latitude != 0
    assert stores[0].demo is True


def test_build_geo_stores_from_postgres() -> None:
    factory = FakeConnectFactory(responder=_geo_responder)
    stores = build_geo_stores(connect_factory=factory)
    assert len(stores) == 1
    assert stores[0].name == "QC Mumbai Central"
    assert stores[0].demo is False


def test_build_geo_stores_attaches_external_summaries(tmp_path: Path) -> None:
    day = date(2026, 9, 23)
    _seed_weather(tmp_path, day)
    _seed_traffic(tmp_path, day)
    factory = FakeConnectFactory(responder=_geo_responder)
    stores = build_geo_stores(connect_factory=factory, data_root=tmp_path)
    assert stores[0].weather is not None
    assert stores[0].weather.condition == "CLEAR"
    assert stores[0].traffic is not None
    assert stores[0].traffic.eta_delay_sec == 120


def test_geo_route_registered(tmp_path: Path) -> None:
    factory = FakeConnectFactory(responder=_geo_responder)
    app = create_app(data_root=tmp_path, connect_factory=factory)
    with TestClient(app) as client:
        response = client.get("/api/v1/geo/stores")
    assert response.status_code == 200
    body = response.json()
    assert body[0]["store_id"] == 1
    assert body[0]["latitude"] == pytest.approx(19.076)
