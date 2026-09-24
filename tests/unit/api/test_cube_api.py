"""Shape and transform coverage for the /cube console backend (quickcart.api.cube_api)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.cube_api import (
    CubeOperationError,
    apply_cube_operation,
    build_cube_state,
)


def test_build_cube_state_has_dimensions_measures_and_cells() -> None:
    state = build_cube_state()

    assert state.generated_at.endswith("Z")
    dim_names = {dim.name for dim in state.dimensions}
    assert dim_names == {"store_city", "category", "hour_bucket"}
    measure_names = {measure.name for measure in state.measures}
    assert measure_names == {"orders", "gmv", "late_rate"}
    # 3 cities x 4 categories x 5 hours
    assert len(state.cells) == 60
    for cell in state.cells:
        assert set(cell.coords) == dim_names
        assert set(cell.values) == measure_names


def test_filter_reduces_cells_and_records_history() -> None:
    state = build_cube_state()

    filtered = apply_cube_operation("filter", {"dim": "store_city", "member": "Pune"}, state)

    assert filtered.active_op == "filter"
    assert len(filtered.cells) == 20
    assert all(cell.coords["store_city"] == "Pune" for cell in filtered.cells)
    assert filtered.animation is not None
    assert filtered.animation.kind == "pulse"
    assert filtered.history[-1].startswith("filter ->")


def test_slice_removes_the_sliced_dimension() -> None:
    state = build_cube_state()

    sliced = apply_cube_operation("slice", {"dim": "store_city", "member": "Pune"}, state)

    assert {dim.name for dim in sliced.dimensions} == {"category", "hour_bucket"}
    assert all("store_city" not in cell.coords for cell in sliced.cells)
    assert len(sliced.cells) == 20


def test_rollup_aggregates_measures_and_drops_the_dimension() -> None:
    state = build_cube_state()

    rolled = apply_cube_operation("rollup", {"dim": "hour_bucket"}, state)

    assert {dim.name for dim in rolled.dimensions} == {"store_city", "category"}
    # 3 cities x 4 categories
    assert len(rolled.cells) == 12
    total_orders_before = sum(cell.values["orders"] for cell in state.cells)
    total_orders_after = sum(cell.values["orders"] for cell in rolled.cells)
    assert total_orders_before == pytest.approx(total_orders_after)


def test_drill_restores_detail_after_a_rollup() -> None:
    state = build_cube_state()
    rolled = apply_cube_operation("rollup", {"dim": "hour_bucket"}, state)

    drilled = apply_cube_operation("drill", {"dim": "hour_bucket", "member": "17-20"}, rolled)

    assert "hour_bucket" in {dim.name for dim in drilled.dimensions}
    assert all(cell.coords.get("hour_bucket") == "17-20" for cell in drilled.cells)


def test_reset_ignores_state_and_returns_the_base_cube() -> None:
    state = build_cube_state()
    filtered = apply_cube_operation("filter", {"dim": "store_city", "member": "Pune"}, state)

    reset = apply_cube_operation("reset", {}, filtered)

    assert len(reset.cells) == 60
    assert reset.active_op is None


def test_unknown_op_raises_cube_operation_error() -> None:
    with pytest.raises(CubeOperationError):
        apply_cube_operation("teleport", {}, build_cube_state())


def test_filter_with_unknown_dimension_raises() -> None:
    with pytest.raises(CubeOperationError):
        apply_cube_operation("filter", {"dim": "planet", "member": "Mars"}, build_cube_state())


def test_cube_routes_are_registered_on_the_app() -> None:
    from quickcart.api.app import create_app

    app: FastAPI = create_app()
    with TestClient(app) as client:
        state_response = client.get("/api/v1/cube/state")
        operate_response = client.post(
            "/api/v1/cube/operate",
            json={"op": "filter", "args": {"dim": "store_city", "member": "Pune"}},
        )
        bad_op_response = client.post("/api/v1/cube/operate", json={"op": "teleport", "args": {}})
        bad_dim_args = {"op": "filter", "args": {"dim": "planet", "member": "Mars"}}
        bad_dim_response = client.post("/api/v1/cube/operate", json=bad_dim_args)

    assert state_response.status_code == 200
    assert len(state_response.json()["cells"]) == 60

    assert operate_response.status_code == 200
    assert len(operate_response.json()["cells"]) == 20

    # "op" is a closed Literal, so an unrecognized value fails request validation (422).
    assert bad_op_response.status_code == 422
    # A recognized op with a malformed argument is our own domain error (400).
    assert bad_dim_response.status_code == 400
