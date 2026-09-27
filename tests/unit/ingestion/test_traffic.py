"""Traffic ingestion tests (rush-hour model + fixture fallback)."""

import json
from datetime import UTC, date, datetime

import pytest

from quickcart.ingestion import traffic

pytestmark = pytest.mark.unit


def test_rush_hour_multiplier_peak() -> None:
    peak = datetime(2026, 9, 23, 3, 30, tzinfo=UTC)  # 09:00 IST
    off_peak = datetime(2026, 9, 23, 6, 0, tzinfo=UTC)  # 11:30 IST
    assert traffic.rush_hour_multiplier(peak) > traffic.rush_hour_multiplier(off_peak)


def test_rush_hour_delay_is_non_negative() -> None:
    actual, delay = traffic.rush_hour_delay_sec(3.5, datetime(2026, 9, 23, 12, 0, tzinfo=UTC))
    assert actual >= delay >= 0


def test_ingest_fixture_writes_per_store_rows(seeded_db, tmp_path) -> None:
    target = traffic.ingest_traffic(data_root=tmp_path, day=date(2026, 9, 23), fixture=True)
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    assert len(rows) == 2
    assert all("eta_delay_sec" in row for row in rows)


def test_ingest_osrm_path_when_available(seeded_db, tmp_path, monkeypatch) -> None:
    def fake_osrm(*args, **kwargs):
        return 900

    monkeypatch.setattr(traffic, "fetch_osrm_duration_sec", fake_osrm)
    target = traffic.ingest_traffic(data_root=tmp_path, day=date(2026, 9, 25))
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    assert len(rows) == 2
    assert rows[0]["source"] == "osrm"
