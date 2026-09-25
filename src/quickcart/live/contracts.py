"""Frozen JSON contracts for the live demo surface.

These shapes are the shared API between the live worker, the live API,
and the Next.js console. Agents A1-A6 must not diverge from them.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Artifact paths (relative to QUICKCART_DATA_ROOT / data/)
# --------------------------------------------------------------------------- #

DELIVERY_MODEL_JOBLIB = "artifacts/delivery_delay_classifier.joblib"
DELIVERY_FEATURES_JSON = "artifacts/delivery_delay_features.json"
DEMAND_MODEL_JOBLIB = "artifacts/demand_forecast_regressor.joblib"
DEMAND_FEATURES_JSON = "artifacts/demand_forecast_features.json"

PipelineStage = Literal[
    "order_events_bronze",
    "cdc_bronze",
    "cdc_silver",
    "gold_refresh",
    "ml_scoring",
    "anomaly_detect",
    "worker",
]

PIPELINE_STAGES: tuple[PipelineStage, ...] = (
    "order_events_bronze",
    "cdc_bronze",
    "cdc_silver",
    "gold_refresh",
    "ml_scoring",
    "anomaly_detect",
    "worker",
)


class LiveOrderRow(BaseModel):
    order_id: int
    store_id: int
    status: str
    total_amount: float
    placed_at: str
    customer_id: int | None = None


class LiveStoreCount(BaseModel):
    store_id: int
    orders_1m: int
    orders_15m: int
    gmv_15m: float


class LiveMinuteBucket(BaseModel):
    minute: str  # ISO minute truncated, UTC
    orders: int
    gmv: float


class LiveSnapshot(BaseModel):
    """GET /api/v1/live/snapshot and SSE payload."""

    generated_at: str
    orders_1m: int
    orders_15m: int
    orders_60m: int
    gmv_1m: float
    gmv_15m: float
    gmv_60m: float
    orders_per_minute: list[LiveMinuteBucket] = Field(default_factory=list)
    status_mix: dict[str, int] = Field(default_factory=dict)
    per_store: list[LiveStoreCount] = Field(default_factory=list)
    recent_orders: list[LiveOrderRow] = Field(default_factory=list)
    payment_failure_rate_15m: float = 0.0
    active_deliveries: int = 0


class StageHeartbeat(BaseModel):
    stage: PipelineStage
    last_run_at: str | None = None
    rows_in: int = 0
    rows_out: int = 0
    lag_seconds: float | None = None
    error: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)
    updated_at: str | None = None


class LayerCounts(BaseModel):
    postgres: dict[str, int] = Field(default_factory=dict)
    redpanda: dict[str, int] = Field(default_factory=dict)
    bronze: dict[str, int] = Field(default_factory=dict)
    silver: dict[str, int] = Field(default_factory=dict)
    gold: dict[str, int] = Field(default_factory=dict)
    quarantine: dict[str, int] = Field(default_factory=dict)


class LivePipeline(BaseModel):
    """GET /api/v1/live/pipeline."""

    generated_at: str
    counts: LayerCounts
    heartbeats: list[StageHeartbeat] = Field(default_factory=list)
    end_to_end_lag_seconds: float | None = None
    gold_refreshed_at: str | None = None


class LineageNode(BaseModel):
    id: str
    layer: Literal["raw", "bronze", "silver", "quarantine", "gold"]
    name: str
    columns: list[str] = Field(default_factory=list)
    row_count: int | None = None


class LineageEdge(BaseModel):
    source: str
    target: str
    kind: Literal["batch", "cdc", "stream", "ml"] = "batch"


class CatalogLineage(BaseModel):
    """GET /api/v1/catalog/lineage."""

    generated_at: str
    nodes: list[LineageNode]
    edges: list[LineageEdge]
