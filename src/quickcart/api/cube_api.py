"""Backend for the /cube OLAP console page.

Mirrors ``frontend/lib/layer-cube-types.ts``'s ``CubeState`` /
``CubeOperateRequest`` shapes so the console's offline-first cube page can
call the API first and fall back to its own local transforms of the same
demo cube whenever the API is unreachable. The base cube is a small
store_city x category x hour_bucket fact table (orders / gmv / late_rate),
generated deterministically so every restart shows the same numbers.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

CubeOp = Literal["filter", "slice", "dice", "rollup", "drill", "pivot", "sql", "reset"]
AnimationKind = Literal["pulse", "shrink", "expand", "recolor", "split", "merge"]

_CITIES = ["Bengaluru", "Pune", "Hyderabad"]
_CATEGORIES = ["Produce", "Dairy", "Snacks", "Household"]
_HOURS = ["08-11", "11-14", "14-17", "17-20", "20-23"]

_CITY_FACTOR = {"Bengaluru": 1.35, "Pune": 1.05, "Hyderabad": 0.85}
_CATEGORY_FACTOR = {"Produce": 1.2, "Dairy": 1.0, "Snacks": 0.85, "Household": 0.65}
_HOUR_FACTOR = {"08-11": 0.7, "11-14": 1.15, "14-17": 0.75, "17-20": 1.4, "20-23": 0.9}

_MAX_ANIMATED_CELLS = 12
_ANIMATION_DURATION_MS = 650


class CubeDim(BaseModel):
    name: str
    members: list[str]


class CubeMeasure(BaseModel):
    name: str
    label: str
    format: Literal["int", "currency", "pct", "float"]


class CubeCell(BaseModel):
    id: str
    coords: dict[str, str]
    values: dict[str, float]
    highlight: bool = False


class CubeAnimation(BaseModel):
    kind: AnimationKind
    cell_ids: list[str]
    duration_ms: int = _ANIMATION_DURATION_MS


class CubeState(BaseModel):
    generated_at: str
    title: str
    dimensions: list[CubeDim]
    measures: list[CubeMeasure]
    cells: list[CubeCell]
    active_op: str | None = None
    history: list[str] = Field(default_factory=list)
    animation: CubeAnimation | None = None


class CubeOperateRequest(BaseModel):
    op: CubeOp
    args: dict[str, Any] = Field(default_factory=dict)
    state: CubeState | None = None


class CubeOperationError(ValueError):
    """Raised for a malformed op/args pair; app.py maps this to HTTP 400."""


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _seeded_rand(seed: int) -> tuple[float, int]:
    """A tiny LCG so the base cube is deterministic without extra deps."""
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280, seed


def _base_cells() -> list[CubeCell]:
    cells: list[CubeCell] = []
    seed = 7
    for city in _CITIES:
        for category in _CATEGORIES:
            for hour in _HOURS:
                base = 40 * _CITY_FACTOR[city] * _CATEGORY_FACTOR[category] * _HOUR_FACTOR[hour]
                r1, seed = _seeded_rand(seed)
                r2, seed = _seeded_rand(seed)
                r3, seed = _seeded_rand(seed)
                orders = round(base * (0.85 + r1 * 0.3))
                gmv = round(orders * (180 + r2 * 90))
                late_rate = min(0.32, max(0.02, 0.06 * _HOUR_FACTOR[hour] * (0.7 + r3 * 0.6)))
                cells.append(
                    CubeCell(
                        id=f"{city}|{category}|{hour}",
                        coords={"store_city": city, "category": category, "hour_bucket": hour},
                        values={
                            "orders": float(orders),
                            "gmv": float(gmv),
                            "late_rate": round(late_rate, 3),
                        },
                    )
                )
    return cells


def build_cube_state(*, generated_at: datetime | None = None) -> CubeState:
    """Return the base (unfiltered) demo cube for GET /api/v1/cube/state."""
    now = generated_at or datetime.now(UTC)
    return CubeState(
        generated_at=_utc_iso(now),
        title="Store x Category x Hour — orders / GMV / late rate",
        dimensions=[
            CubeDim(name="store_city", members=list(_CITIES)),
            CubeDim(name="category", members=list(_CATEGORIES)),
            CubeDim(name="hour_bucket", members=list(_HOURS)),
        ],
        measures=[
            CubeMeasure(name="orders", label="Orders", format="int"),
            CubeMeasure(name="gmv", label="GMV", format="currency"),
            CubeMeasure(name="late_rate", label="Late rate", format="pct"),
        ],
        cells=_base_cells(),
        active_op=None,
        history=["reset -> base cube (3 cities x 4 categories x 5 hours)"],
        animation=None,
    )


def _dim_names(state: CubeState) -> list[str]:
    return [dim.name for dim in state.dimensions]


def _require_dim(state: CubeState, dim: str) -> CubeDim:
    for candidate in state.dimensions:
        if candidate.name == dim:
            return candidate
    raise CubeOperationError(f"unknown dimension {dim!r}; expected one of {_dim_names(state)}")


def _cell_ids(cells: list[CubeCell]) -> list[str]:
    return [cell.id for cell in cells[:_MAX_ANIMATED_CELLS]]


def _op_filter(state: CubeState, args: dict[str, Any]) -> CubeState:
    dim = str(args.get("dim", ""))
    member = str(args.get("member", ""))
    _require_dim(state, dim)
    cells = [cell for cell in state.cells if cell.coords.get(dim) == member]
    history = [*state.history, f"filter -> {dim} = {member} ({len(cells)} cells)"]
    return state.model_copy(
        update={
            "cells": cells,
            "active_op": "filter",
            "history": history,
            "animation": CubeAnimation(kind="pulse", cell_ids=_cell_ids(cells)),
        }
    )


def _op_dice(state: CubeState, args: dict[str, Any]) -> CubeState:
    filters = args.get("filters")
    if not isinstance(filters, dict) or not filters:
        raise CubeOperationError("dice requires args.filters: {dim: [members, ...]}")
    for dim in filters:
        _require_dim(state, str(dim))
    cells = [
        cell
        for cell in state.cells
        if all(cell.coords.get(str(dim)) in members for dim, members in filters.items())
    ]
    history = [*state.history, f"dice -> {filters} ({len(cells)} cells)"]
    return state.model_copy(
        update={
            "cells": cells,
            "active_op": "dice",
            "history": history,
            "animation": CubeAnimation(kind="split", cell_ids=_cell_ids(cells)),
        }
    )


def _op_slice(state: CubeState, args: dict[str, Any]) -> CubeState:
    dim = str(args.get("dim", ""))
    member = str(args.get("member", ""))
    _require_dim(state, dim)
    cells = []
    for cell in state.cells:
        if cell.coords.get(dim) != member:
            continue
        coords = {k: v for k, v in cell.coords.items() if k != dim}
        cells.append(cell.model_copy(update={"coords": coords}))
    dimensions = [d for d in state.dimensions if d.name != dim]
    history = [*state.history, f"slice -> {dim} = {member} (dimension removed)"]
    return state.model_copy(
        update={
            "dimensions": dimensions,
            "cells": cells,
            "active_op": "slice",
            "history": history,
            "animation": CubeAnimation(kind="merge", cell_ids=_cell_ids(cells)),
        }
    )


def _aggregate(
    cells: list[CubeCell], group_dims: list[str], measures: list[CubeMeasure]
) -> list[CubeCell]:
    buckets: dict[tuple[str, ...], list[CubeCell]] = {}
    for cell in cells:
        key = tuple(cell.coords.get(dim, "") for dim in group_dims)
        buckets.setdefault(key, []).append(cell)

    rate_measures = {m.name for m in measures if m.format == "pct"}
    out: list[CubeCell] = []
    for key, group in buckets.items():
        coords = dict(zip(group_dims, key, strict=True))
        values: dict[str, float] = {}
        for measure in measures:
            raw = [g.values.get(measure.name, 0.0) for g in group]
            if measure.name in rate_measures:
                values[measure.name] = round(sum(raw) / len(raw), 3) if raw else 0.0
            else:
                values[measure.name] = round(sum(raw), 2)
        cell_id = "|".join(key) if key else "ALL"
        out.append(CubeCell(id=cell_id, coords=coords, values=values))
    return out


def _op_rollup(state: CubeState, args: dict[str, Any]) -> CubeState:
    dim = str(args.get("dim", ""))
    _require_dim(state, dim)
    remaining_dims = [d.name for d in state.dimensions if d.name != dim]
    cells = _aggregate(state.cells, remaining_dims, state.measures)
    dimensions = [d for d in state.dimensions if d.name != dim]
    history = [*state.history, f"rollup -> aggregate away {dim} ({len(cells)} cells)"]
    return state.model_copy(
        update={
            "dimensions": dimensions,
            "cells": cells,
            "active_op": "rollup",
            "history": history,
            "animation": CubeAnimation(kind="shrink", cell_ids=_cell_ids(cells)),
        }
    )


def _op_drill(state: CubeState, args: dict[str, Any]) -> CubeState:
    """Drill back down into one member along a dimension already present.

    Since the base cube has a single stored granularity, drilling re-adds
    detail by re-filtering the base cube on the requested member while
    keeping any dimensions already present in ``state`` — it is the
    practical inverse of ``slice``/``rollup`` for this showcase cube.
    """
    dim = str(args.get("dim", ""))
    member = str(args.get("member", ""))
    if not dim or not member:
        raise CubeOperationError("drill requires args.dim and args.member")
    base = build_cube_state()
    base_dim_names = {d.name for d in base.dimensions}
    if dim not in base_dim_names:
        raise CubeOperationError(
            f"unknown dimension {dim!r}; expected one of {sorted(base_dim_names)}"
        )

    kept_dim_names = _dim_names(state) if dim in _dim_names(state) else [*_dim_names(state), dim]
    cells = [cell for cell in base.cells if cell.coords.get(dim) == member]
    if len(kept_dim_names) < len(base.dimensions):
        cells = _aggregate(cells, kept_dim_names, base.measures)
    dimensions = [d for d in base.dimensions if d.name in kept_dim_names]
    history = [*state.history, f"drill -> {dim} = {member} (detail restored)"]
    return state.model_copy(
        update={
            "dimensions": dimensions,
            "cells": cells,
            "active_op": "drill",
            "history": history,
            "animation": CubeAnimation(kind="expand", cell_ids=_cell_ids(cells)),
        }
    )


def _op_pivot(state: CubeState, args: dict[str, Any]) -> CubeState:
    order = args.get("order")
    if not isinstance(order, list) or not order:
        # No explicit order: reverse the current dimension order.
        order = list(reversed(_dim_names(state)))
    order = [str(name) for name in order]
    current = {d.name: d for d in state.dimensions}
    missing = [name for name in order if name not in current]
    if missing:
        raise CubeOperationError(f"pivot references unknown dimensions: {missing}")
    dimensions = [current[name] for name in order] + [
        d for d in state.dimensions if d.name not in order
    ]
    history = [*state.history, f"pivot -> {[d.name for d in dimensions]}"]
    return state.model_copy(
        update={
            "dimensions": dimensions,
            "active_op": "pivot",
            "history": history,
            "animation": CubeAnimation(kind="recolor", cell_ids=_cell_ids(state.cells)),
        }
    )


_SQL_WHERE_RE = re.compile(r"where\s+(\w+)\s*=\s*'([^']+)'", re.IGNORECASE)


def _op_sql(state: CubeState, args: dict[str, Any]) -> CubeState:
    statement = str(args.get("sql", "")).strip()
    if not statement:
        raise CubeOperationError("sql requires args.sql")
    match = _SQL_WHERE_RE.search(statement)
    if match:
        dim, member = match.group(1), match.group(2)
        if dim in _dim_names(state):
            filtered = _op_filter(state, {"dim": dim, "member": member})
            history = [*state.history, f"sql -> {statement!r} (parsed as filter {dim}={member})"]
            return filtered.model_copy(update={"active_op": "sql", "history": history})
    history = [
        *state.history,
        f"sql -> {statement!r} (no recognizable WHERE clause; cube unchanged)",
    ]
    return state.model_copy(
        update={
            "active_op": "sql",
            "history": history,
            "animation": CubeAnimation(kind="pulse", cell_ids=_cell_ids(state.cells)),
        }
    )


_OP_HANDLERS = {
    "filter": _op_filter,
    "dice": _op_dice,
    "slice": _op_slice,
    "rollup": _op_rollup,
    "drill": _op_drill,
    "pivot": _op_pivot,
    "sql": _op_sql,
}


def apply_cube_operation(
    op: str, args: dict[str, Any] | None = None, state: CubeState | None = None
) -> CubeState:
    """Apply one cube operation to ``state`` (or the base cube if omitted).

    Raises ``CubeOperationError`` for an unknown op or malformed args.
    """
    args = args or {}
    base_state = state or build_cube_state()
    if op == "reset":
        return build_cube_state()
    handler = _OP_HANDLERS.get(op)
    if handler is None:
        known = sorted({*_OP_HANDLERS, "reset"})
        raise CubeOperationError(f"unknown cube op {op!r}; expected one of {known}")
    return handler(base_state, args)
