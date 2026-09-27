"""External feed API routes."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quickcart.api.app import create_app
from quickcart.api.external_feeds import read_external_feed

pytestmark = pytest.mark.unit


def _seed_weather(root: Path, day: date) -> None:
    partition = root / "raw" / "weather" / f"load_date={day.isoformat()}"
    partition.mkdir(parents=True, exist_ok=True)
    row = {"store_id": 1, "city": "Mumbai", "condition": "CLEAR", "source": "fixture"}
    (partition / "weather.json").write_text(json.dumps(row) + "\n", encoding="utf-8")


def test_read_external_feed_returns_rows(tmp_path) -> None:
    day = date(2026, 9, 23)
    _seed_weather(tmp_path, day)
    snapshot = read_external_feed("weather", tmp_path)
    assert snapshot.feed == "weather"
    assert snapshot.row_count == 1
    assert snapshot.rows[0]["city"] == "Mumbai"


def test_external_routes_registered(tmp_path) -> None:
    _seed_weather(tmp_path, date(2026, 9, 23))
    app = create_app(data_root=tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/v1/external/weather")
    assert response.status_code == 200
    body = response.json()
    assert body["feed"] == "weather"
    assert body["row_count"] == 1
