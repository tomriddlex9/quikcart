"""Bounded demo-control API routes for the live order simulator (kit/AGENTS.md:
the agent/console can flip a JSON switch and turn dials, never run arbitrary
SQL or shell commands).

Mountable via :func:`register_sim_routes`, mirroring ``live.register_live_routes``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from quickcart.live.sim_control import (
    SimControlState,
    load_control,
    patch_control,
    start,
    stop,
)

# Rough, honest heuristic: each order writes a handful of operational rows
# (order, items, payment[s], inventory movement) that Debezium then ships as
# CDC events; this is a demo-facing estimate, not a measured SLA.
_ROWS_WRITTEN_PER_ORDER = 6
_ASSUMED_CDC_LAG_SECONDS = 2.0


class SimConfigRequest(BaseModel):
    """Optional partial update; unset fields keep their current value."""

    running: bool | None = None
    orders_per_minute: float | None = Field(default=None, gt=0)
    cancel_rate: float | None = Field(default=None, ge=0, le=1)
    payment_fail_rate: float | None = Field(default=None, ge=0, le=1)
    inventory_churn: float | None = Field(default=None, ge=0, le=1)
    rider_ping_hz: float | None = Field(default=None, gt=0)
    ticket_rate: float | None = Field(default=None, ge=0, le=1)
    burst_factor: float | None = Field(default=None, gt=0)


def _impact_estimate(state: SimControlState) -> dict[str, Any]:
    effective_orders_per_minute = state.orders_per_minute * state.burst_factor
    rows_per_minute = effective_orders_per_minute * _ROWS_WRITTEN_PER_ORDER
    return {
        "orders_per_minute_effective": round(effective_orders_per_minute, 2),
        "postgres_rows_per_minute_estimate": round(rows_per_minute, 1),
        "expected_cdc_lag_seconds_hint": _ASSUMED_CDC_LAG_SECONDS,
        "note": (
            "Postgres → Debezium CDC → Bronze; estimate assumes ~"
            f"{_ROWS_WRITTEN_PER_ORDER} operational rows per order and a"
            f" typical {_ASSUMED_CDC_LAG_SECONDS:.0f}s CDC hop."
        ),
    }


def build_sim_status(data_root: Path | None = None) -> dict[str, Any]:
    """State plus a derived, clearly-labeled demo impact estimate."""
    state = load_control(data_root)
    return {"state": state.model_dump(), "impact": _impact_estimate(state)}


def register_sim_routes(app: FastAPI) -> None:
    """Register the four bounded simulator-control routes on an existing app."""

    def app_data_root(request: Request) -> Path | None:
        return getattr(request.app.state, "data_root", None)

    @app.get("/api/v1/sim/status")
    def sim_status(request: Request) -> dict[str, Any]:
        return build_sim_status(app_data_root(request))

    @app.post("/api/v1/sim/start")
    def sim_start(request: Request) -> dict[str, Any]:
        start(app_data_root(request))
        return build_sim_status(app_data_root(request))

    @app.post("/api/v1/sim/stop")
    def sim_stop(request: Request) -> dict[str, Any]:
        stop(app_data_root(request))
        return build_sim_status(app_data_root(request))

    @app.post("/api/v1/sim/config")
    def sim_config(body: SimConfigRequest, request: Request) -> dict[str, Any]:
        patch_control(app_data_root(request), **body.model_dump(exclude_unset=True))
        return build_sim_status(app_data_root(request))


__all__ = ["build_sim_status", "register_sim_routes"]
