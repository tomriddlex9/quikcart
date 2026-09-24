"""Weather ingestion unit tests: API parse, condition mapping, fixture fallback."""

import json
from datetime import date

import pytest

from quickcart.ingestion import weather

pytestmark = pytest.mark.unit


def _payload(temp: float = 29.4, code: int = 61) -> bytes:
    body = {"current": {"time": "2026-09-23T12:00", "temperature_2m": temp, "weather_code": code}}
    return json.dumps(body).encode()


def test_condition_mapping() -> None:
    assert weather.condition_from_code(0) == "CLEAR"
    assert weather.condition_from_code(61) == "RAIN"
    assert weather.condition_from_code(99) == "RAIN"
    assert weather.condition_from_code(12345) == "CLEAR"


def test_ingest_uses_api_when_available(seeded_db, tmp_path, monkeypatch) -> None:
    def fake(url, timeout=15):
        return _FakeResponse(_payload())

    monkeypatch.setattr(weather.urllib.request, "urlopen", fake)
    target = weather.ingest_weather(data_root=tmp_path, day=date(2026, 9, 23))
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    assert len(rows) == 2  # smoke scale has 2 stores
    assert all(row["source"] == "open-meteo" for row in rows)
    assert rows[0]["condition"] == "RAIN"  # weather_code 61


def test_ingest_falls_back_to_fixture_on_network_error(seeded_db, tmp_path, monkeypatch) -> None:
    def _boom(url, timeout=15):
        raise OSError("network down")

    monkeypatch.setattr(weather.urllib.request, "urlopen", _boom)
    target = weather.ingest_weather(data_root=tmp_path, day=date(2026, 9, 23))
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    assert len(rows) == 10
    assert all(row["source"] == "fixture" for row in rows)


def test_ingest_is_idempotent_per_day(seeded_db, tmp_path) -> None:
    first = weather.ingest_weather(data_root=tmp_path, day=date(2026, 9, 23), fixture=True)
    content = first.read_text()
    second = weather.ingest_weather(data_root=tmp_path, day=date(2026, 9, 23), fixture=True)
    assert second == first
    assert second.read_text() == content


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False
