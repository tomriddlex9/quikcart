"""Serving snapshot + business API against the seeded operational database."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.business import register_business_routes
from quickcart.business.snapshot import run_serving_snapshot
from quickcart.db.connection import connect

pytestmark = pytest.mark.integration

_SERVING_TABLES = (
    "serving.metric_daily",
    "serving.metric_hourly",
    "serving.store_scorecard",
    "serving.category_daily",
)


@pytest.fixture
def client(seeded_db):
    with connect() as conn, conn.transaction():
        conn.execute(
            "TRUNCATE serving.metric_daily, serving.metric_hourly, serving.store_scorecard, "
            "serving.category_daily, serving.snapshot_runs RESTART IDENTITY CASCADE"
        )
    app = FastAPI()
    register_business_routes(app)
    return TestClient(app)


def _counts(conn) -> dict[str, int]:
    return {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in _SERVING_TABLES}


def test_api_serves_live_sql_before_the_first_snapshot(client) -> None:
    body = client.get("/api/v1/b/today").json()

    assert body["meta"]["source"] == "live_sql"
    assert body["headline"][0]["label"] == "Sales"
    assert body["headline"][0]["value"] is not None
    assert client.get("/api/v1/b/stores/scorecards").json()["stores"]


def test_snapshot_is_idempotent_and_api_switches_to_serving(client) -> None:
    with connect() as conn:
        first = run_serving_snapshot(conn, None)
        after_first = _counts(conn)
        second = run_serving_snapshot(conn, None)
        after_second = _counts(conn)
        runs = conn.execute(
            "SELECT status, source FROM serving.snapshot_runs ORDER BY snapshot_run_id"
        ).fetchall()

    assert second > first
    assert after_first == after_second and all(n > 0 for n in after_first.values())
    assert runs == [("succeeded", "postgres"), ("succeeded", "postgres")]

    today = client.get("/api/v1/b/today").json()
    assert today["meta"]["source"] == "serving"
    assert today["meta"]["snapshot_run_id"] == second
    for path in (
        "/api/v1/b/stores/scorecards",
        "/api/v1/b/delivery/health",
        "/api/v1/b/customers/health",
        "/api/v1/b/money",
        "/api/v1/b/products?tab=running_low",
        "/api/v1/b/products?tab=bestsellers",
        "/api/v1/b/products?tab=slow",
    ):
        assert client.get(path).status_code == 200, path


def test_serving_and_live_paths_agree(client) -> None:
    live = client.get("/api/v1/b/today").json()
    with connect() as conn:
        run_serving_snapshot(conn, None)
    served = client.get("/api/v1/b/today").json()

    live_values = {m["key"]: m["value"] for m in live["headline"] + live["more"]}
    served_values = {m["key"]: m["value"] for m in served["headline"] + served["more"]}
    for key, value in live_values.items():
        assert served_values[key] == pytest.approx(value, abs=1e-3), key


def test_pipeline_status_accepts_serving_snapshot_stage(seeded_db) -> None:
    with connect() as conn, conn.transaction():
        conn.execute(
            "INSERT INTO pipeline_status (stage) VALUES ('serving_snapshot') "
            "ON CONFLICT (stage) DO NOTHING"
        )
