"""Medallion layer operations catalog for the /layers console.

Built from :mod:`quickcart.api.transform_catalog` (real CLEANERS / MARTS) so
SQL mirrors and DQ rules stay aligned with the lakehouse.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from quickcart.api.transform_catalog import (
    TransformOp,
    all_transform_ops,
    get_op,
    ops_for_table,
)
from quickcart.lakehouse.silver.transforms import CLEANERS, SILVER_TABLE

MedallionLayer = Literal["raw", "bronze", "silver", "quarantine", "gold"]
Engine = Literal["pyspark", "python", "sql", "cdc", "stream", "ml"]


class OperationImpact(BaseModel):
    rows_in: int = 0
    rows_out: int = 0
    rows_quarantined: int = 0
    columns_added: list[str] = Field(default_factory=list)
    columns_dropped: list[str] = Field(default_factory=list)
    quality_lift_pct: float = 0.0
    latency_ms: int = 0
    null_rate_before: float = 0.0
    null_rate_after: float = 0.0


class DqRule(BaseModel):
    rule_id: str
    severity: str = "error"
    sql_predicate: str
    message: str


class LayerOperation(BaseModel):
    id: str
    layer: MedallionLayer
    name: str
    engine: Engine
    summary: str
    code: str
    inputs: list[str]
    outputs: list[str]
    impact: OperationImpact
    rules: list[DqRule] = Field(default_factory=list)


class LayerSummary(BaseModel):
    tables: int
    ops: int
    row_estimate: int
    purpose: str


class LayersCatalog(BaseModel):
    generated_at: str
    operations: list[LayerOperation]
    layer_summaries: dict[str, LayerSummary]


class LayerSample(BaseModel):
    layer: MedallionLayer
    op_id: str | None = None
    before: list[dict[str, object]]
    after: list[dict[str, object]]
    notes: list[str]


class LayerOpsError(ValueError):
    """Raised for an unknown layer/op; app.py maps this to HTTP 404."""


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _impact_from(op: TransformOp) -> OperationImpact:
    raw = op.impact or {}
    return OperationImpact(
        rows_in=int(raw.get("rows_in", 0)),
        rows_out=int(raw.get("rows_out", 0)),
        rows_quarantined=int(raw.get("rows_quarantined", 0)),
        columns_added=list(raw.get("columns_added", [])),
        columns_dropped=list(raw.get("columns_dropped", [])),
        quality_lift_pct=float(raw.get("quality_lift_pct", 0.0)),
        latency_ms=int(raw.get("latency_ms", 0)),
        null_rate_before=float(raw.get("null_rate_before", 0.0)),
        null_rate_after=float(raw.get("null_rate_after", 0.0)),
    )


def _to_operation(op: TransformOp) -> LayerOperation:
    return LayerOperation(
        id=op.id,
        layer=op.layer,
        name=op.name,
        engine=op.engine,
        summary=op.summary,
        code=op.code,
        inputs=op.inputs,
        outputs=op.outputs,
        impact=_impact_from(op),
        rules=[
            DqRule(
                rule_id=r.rule_id,
                severity=r.severity,
                sql_predicate=r.sql_predicate,
                message=r.message,
            )
            for r in op.rules
        ],
    )


def build_layers_catalog() -> LayersCatalog:
    operations = [_to_operation(op) for op in all_transform_ops()]
    by_layer: dict[str, list[LayerOperation]] = {}
    for op in operations:
        by_layer.setdefault(op.layer, []).append(op)

    silver_tables = len(SILVER_TABLE) + 2  # + weather / city context
    quarantine_tables = len(CLEANERS) + 1  # + quality_summary
    summaries = {
        "raw": LayerSummary(
            tables=17,
            ops=0,
            row_estimate=400_000,
            purpose="PostgreSQL operational source of truth",
        ),
        "bronze": LayerSummary(
            tables=18,
            ops=len(by_layer.get("bronze", [])),
            row_estimate=320_000,
            purpose="Append-only landings from batch export, CDC, and external feeds",
        ),
        "silver": LayerSummary(
            tables=silver_tables,
            ops=len(by_layer.get("silver", [])),
            row_estimate=280_000,
            purpose="DQ-cleaned, deduped entities ready for analytics",
        ),
        "quarantine": LayerSummary(
            tables=quarantine_tables,
            ops=len(by_layer.get("quarantine", [])),
            row_estimate=12_000,
            purpose="Rejected rows retained with structured error codes — never dropped",
        ),
        "gold": LayerSummary(
            tables=8,
            ops=len(by_layer.get("gold", [])),
            row_estimate=45_000,
            purpose="Business marts and ML write-backs for the console",
        ),
    }
    return LayersCatalog(
        generated_at=_utc_iso(datetime.now(UTC)),
        operations=operations,
        layer_summaries=summaries,
    )


_OP_SAMPLES: dict[str, LayerSample] = {
    "silver-clean-orders": LayerSample(
        layer="silver",
        op_id="silver-clean-orders",
        before=[
            {
                "order_id": 101,
                "store_id": 1,
                "customer_id": 9,
                "total_amount": -12.5,
                "status": "PLACED",
                "placed_at": "2026-09-27T10:00:00Z",
            },
            {
                "order_id": 102,
                "store_id": 1,
                "customer_id": 9,
                "total_amount": 420.0,
                "status": "PLACED",
                "placed_at": "2026-09-27T10:01:00Z",
            },
        ],
        after=[
            {
                "order_id": 102,
                "store_id": 1,
                "customer_id": 9,
                "total_amount": 420.0,
                "status": "PLACED",
                "placed_at": "2026-09-27T10:01:00Z",
            },
        ],
        notes=[
            "order_id=101 quarantined: DQ-ORDER-004 total_amount is negative",
            "Survivors are deduped on order_id ORDER BY updated_at DESC",
        ],
    ),
    "gold-build-delivery_performance": LayerSample(
        layer="gold",
        op_id="gold-build-delivery_performance",
        before=[
            {
                "order_id": 102,
                "store_id": 1,
                "placed_at": "2026-09-27T10:01:00Z",
                "total_amount": 420.0,
            },
        ],
        after=[
            {
                "store_id": 1,
                "day": "2026-09-27",
                "deliveries": 48,
                "late_delivery_rate": 0.12,
                "weather_condition": "RAIN",
            },
        ],
        notes=["Joins silver_store_weather on store_id + hour of placed_at when present."],
    ),
}


def layer_sample(layer: str) -> LayerSample:
    """Legacy per-layer sample (first op in that layer, or empty)."""
    catalog = build_layers_catalog()
    if layer not in catalog.layer_summaries and layer != "raw":
        raise LayerOpsError(f"unknown layer {layer!r}")
    for op in catalog.operations:
        if op.layer == layer and op.id in _OP_SAMPLES:
            return _OP_SAMPLES[op.id]
    if layer == "raw":
        return LayerSample(
            layer="raw",
            before=[],
            after=[],
            notes=["Raw is the operational source; there is no upstream transform to sample."],
        )
    return LayerSample(
        layer=layer,  # type: ignore[arg-type]
        before=[],
        after=[],
        notes=[f"No curated sample for layer {layer}; open Transform SQL for the cleaner/mart."],
    )


def operation_sample(op_id: str) -> LayerSample:
    op = get_op(op_id)
    if op is None:
        raise LayerOpsError(f"unknown operation {op_id!r}")
    if op_id in _OP_SAMPLES:
        return _OP_SAMPLES[op_id]
    return LayerSample(
        layer=op.layer,
        op_id=op_id,
        before=[],
        after=[],
        notes=[
            f"Operation {op.name}: {op.summary}",
            "Open Transform SQL for the full cleaning / mart query.",
        ],
    )


def transforms_for_table(table: str) -> dict[str, Any]:
    ops = [_to_operation(op) for op in ops_for_table(table)]
    return {
        "table": table,
        "operations": [op.model_dump() for op in ops],
    }


__all__ = [
    "DqRule",
    "LayerOperation",
    "LayerOpsError",
    "LayerSample",
    "LayerSummary",
    "LayersCatalog",
    "OperationImpact",
    "build_layers_catalog",
    "layer_sample",
    "operation_sample",
    "transforms_for_table",
]
