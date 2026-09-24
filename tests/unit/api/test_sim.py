"""Unit coverage for the bounded simulator-control API routes."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.sim import register_sim_routes
from quickcart.live.sim_control import SimControlState, load_control, save_control


def _app(data_root) -> FastAPI:
    app = FastAPI()
    app.state.data_root = data_root
    register_sim_routes(app)
    return app


def test_status_returns_defaults_and_impact_estimate(tmp_path) -> None:
    with TestClient(_app(tmp_path)) as client:
        response = client.get("/api/v1/sim/status")

    assert response.status_code == 200
    body = response.json()
    assert body["state"]["running"] is True
    assert body["state"]["orders_per_minute"] == 120
    assert body["impact"]["orders_per_minute_effective"] == 120
    assert body["impact"]["postgres_rows_per_minute_estimate"] > 0
    assert "expected_cdc_lag_seconds_hint" in body["impact"]


def test_start_persists_running_true(tmp_path) -> None:
    save_control(SimControlState(running=False), tmp_path)
    with TestClient(_app(tmp_path)) as client:
        response = client.post("/api/v1/sim/start")

    assert response.status_code == 200
    assert response.json()["state"]["running"] is True
    assert load_control(tmp_path).running is True


def test_stop_persists_running_false(tmp_path) -> None:
    with TestClient(_app(tmp_path)) as client:
        response = client.post("/api/v1/sim/stop")

    assert response.status_code == 200
    assert response.json()["state"]["running"] is False
    assert load_control(tmp_path).running is False


def test_config_updates_selected_fields_only(tmp_path) -> None:
    save_control(SimControlState(orders_per_minute=200, cancel_rate=0.1), tmp_path)
    with TestClient(_app(tmp_path)) as client:
        response = client.post(
            "/api/v1/sim/config",
            json={"cancel_rate": 0.4},
        )

    assert response.status_code == 200
    state = response.json()["state"]
    assert state["cancel_rate"] == 0.4
    assert state["orders_per_minute"] == 200


def test_config_rejects_out_of_range_value(tmp_path) -> None:
    with TestClient(_app(tmp_path)) as client:
        response = client.post(
            "/api/v1/sim/config",
            json={"cancel_rate": 5},
        )

    assert response.status_code == 422


def test_impact_scales_with_burst_factor(tmp_path) -> None:
    save_control(
        SimControlState(orders_per_minute=100, burst_factor=2.0),
        tmp_path,
    )
    with TestClient(_app(tmp_path)) as client:
        response = client.get("/api/v1/sim/status")

    assert response.json()["impact"]["orders_per_minute_effective"] == 200
