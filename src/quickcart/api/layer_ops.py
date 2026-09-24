"""Medallion layer operations catalog for the /layers console page.

This module owns the *demo-parity* backend of ``frontend/lib/layer-cube-types.ts``:
the same shape (``operations`` + ``layer_summaries``) so the console's
"live | demo" honesty pattern has real data to fall back from. Numbers here
are illustrative — the same kind of showcase fixture as
``quickcart.api.lineage_map`` — not a live query against the lakehouse.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

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
    before: list[dict[str, object]]
    after: list[dict[str, object]]
    notes: list[str]


class LayerOpsError(ValueError):
    """Raised for an unknown layer name; app.py maps this to HTTP 404."""


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


_OPERATIONS: list[LayerOperation] = [
    LayerOperation(
        id="bronze-cdc-orders",
        layer="bronze",
        name="cdc_orders_ingest",
        engine="cdc",
        summary=(
            "Debezium captures row-level changes on postgres.public.orders and lands "
            "them append-only, one bronze row per change event."
        ),
        code=(
            'debezium.connector(table="public.orders", slot="quickcart_orders_slot")'
            '.stream_to(topic="cdc.quickcart.public.orders", sink="delta:/bronze/orders_cdc")'
        ),
        inputs=["postgres.public.orders"],
        outputs=["bronze.orders_cdc"],
        impact=OperationImpact(
            rows_in=184_205,
            rows_out=184_205,
            columns_added=["_cdc_op", "_cdc_ts_ms", "_cdc_lsn"],
            latency_ms=420,
        ),
    ),
    LayerOperation(
        id="bronze-batch-inventory-updates",
        layer="bronze",
        name="batch_inventory_updates_snapshot",
        engine="pyspark",
        summary="Airflow snapshots the inventory_updates change feed into bronze once per hour.",
        code=(
            'spark.read.jdbc(pg_url, "inventory_updates")'
            '.withColumn("ingested_at", current_timestamp())'
            '.write.format("delta").mode("append").save("/bronze/inventory_updates")'
        ),
        inputs=["postgres.public.inventory_updates"],
        outputs=["bronze.inventory_updates"],
        impact=OperationImpact(
            rows_in=42_600,
            rows_out=42_600,
            columns_added=["ingested_at", "source_file"],
            latency_ms=3_150,
            null_rate_before=0.02,
            null_rate_after=0.02,
        ),
    ),
    LayerOperation(
        id="bronze-stream-rider-locations",
        layer="bronze",
        name="stream_rider_locations",
        engine="stream",
        summary="Rider app pings land on Redpanda and are micro-batched to bronze every 30s.",
        code=(
            'spark.readStream.format("kafka").option("subscribe", "rider.locations.v1").load()'
            '.writeStream.format("delta")'
            '.trigger(processingTime="30 seconds").start("/bronze/rider_locations")'
        ),
        inputs=["redpanda.rider.locations.v1"],
        outputs=["bronze.rider_locations"],
        impact=OperationImpact(
            rows_in=96_800,
            rows_out=96_800,
            columns_added=["_kafka_offset", "_kafka_partition"],
            latency_ms=890,
        ),
    ),
    LayerOperation(
        id="bronze-batch-support",
        layer="bronze",
        name="batch_support_tickets_and_escalations",
        engine="python",
        summary="Nightly extract of the support desk's tickets and escalations tables.",
        code=(
            'for table in ("support_tickets", "escalations"):\n'
            "    rows = pg.fetch_all(f\"select * from {table} where updated_at >= :since\")\n"
            '    write_delta(f"/bronze/{table}", rows, mode="append")'
        ),
        inputs=["postgres.public.support_tickets", "postgres.public.escalations"],
        outputs=["bronze.support_tickets", "bronze.escalations"],
        impact=OperationImpact(
            rows_in=8_940,
            rows_out=8_940,
            columns_added=["ingested_at"],
            latency_ms=1_640,
            null_rate_before=0.04,
            null_rate_after=0.04,
        ),
    ),
    LayerOperation(
        id="bronze-batch-weather-news",
        layer="bronze",
        name="batch_weather_and_news_feeds",
        engine="python",
        summary="Hourly pull of the external weather and local-news APIs, landed as-is.",
        code=(
            'weather = weather_api.fetch_hourly(cities=STORE_CITIES)\n'
            'news = news_api.fetch_recent(cities=STORE_CITIES)\n'
            'write_delta("/bronze/weather_feed", weather, mode="append")\n'
            'write_delta("/bronze/news_feed", news, mode="append")'
        ),
        inputs=["external.weather_feed", "external.news_feed"],
        outputs=["bronze.weather_feed", "bronze.news_feed"],
        impact=OperationImpact(
            rows_in=19_680,
            rows_out=19_680,
            columns_added=["ingested_at"],
            latency_ms=610,
            null_rate_before=0.11,
            null_rate_after=0.11,
        ),
    ),
    LayerOperation(
        id="silver-orders-conform",
        layer="silver",
        name="conform_orders",
        engine="pyspark",
        summary="Type-cast, dedupe order_id keeping latest CDC op, drop rows without a store_id.",
        code=(
            'w = Window.partitionBy("order_id").orderBy(desc("_cdc_ts_ms"))\n'
            'clean = (bronze.withColumn("rn", row_number().over(w)).filter(col("rn") == 1)'
            '.filter(col("store_id").isNotNull()))\n'
            'clean.write.format("delta").mode("overwrite").save("/silver/orders")'
        ),
        inputs=["bronze.orders_cdc"],
        outputs=["silver.orders", "quarantine.orders_missing_store"],
        impact=OperationImpact(
            rows_in=184_205,
            rows_out=183_996,
            rows_quarantined=209,
            columns_dropped=["_cdc_op", "_cdc_lsn"],
            quality_lift_pct=12.4,
            latency_ms=5_240,
            null_rate_before=0.031,
        ),
    ),
    LayerOperation(
        id="silver-inventory-validate",
        layer="silver",
        name="validate_inventory_updates",
        engine="pyspark",
        summary="Rejects negative on-hand quantities and unknown SKUs into quarantine.",
        code=(
            'valid = bronze.filter((col("on_hand_qty") >= 0) & col("sku").isin(known_skus))\n'
            "invalid = bronze.subtract(valid)\n"
            'valid.write.format("delta").mode("overwrite").save("/silver/inventory")'
        ),
        inputs=["bronze.inventory_updates"],
        outputs=["silver.inventory", "quarantine.inventory_updates"],
        impact=OperationImpact(
            rows_in=42_600,
            rows_out=41_845,
            rows_quarantined=755,
            quality_lift_pct=8.1,
            latency_ms=2_010,
            null_rate_before=0.021,
        ),
    ),
    LayerOperation(
        id="silver-rider-locations-dedupe",
        layer="silver",
        name="dedupe_rider_locations",
        engine="pyspark",
        summary="Collapses duplicate pings within a 5s window/rider, clips out-of-range GPS.",
        code=(
            'w = window(col("event_time"), "5 seconds")\n'
            'deduped = (bronze.groupBy("rider_id", w)\n'
            '  .agg(last("lat").alias("lat"), last("lng").alias("lng"))\n'
            '  .filter(col("lat").between(-90, 90) & col("lng").between(-180, 180)))'
        ),
        inputs=["bronze.rider_locations"],
        outputs=["silver.rider_locations"],
        impact=OperationImpact(
            rows_in=96_800,
            rows_out=71_260,
            rows_quarantined=340,
            quality_lift_pct=5.6,
            latency_ms=1_780,
            null_rate_before=0.006,
        ),
    ),
    LayerOperation(
        id="silver-support-enrich",
        layer="silver",
        name="enrich_support_tickets",
        engine="python",
        summary="Joins support_tickets to escalations and orders, normalizes free-text priority.",
        code=(
            'enriched = tickets.merge(escalations, on="ticket_id", how="left")'
            '.merge(orders[["order_id", "store_id"]], on="order_id", how="left")\n'
            'enriched["priority"] = enriched["priority_raw"].map(PRIORITY_MAP).fillna("normal")'
        ),
        inputs=["bronze.support_tickets", "bronze.escalations", "silver.orders"],
        outputs=["silver.support_tickets"],
        impact=OperationImpact(
            rows_in=8_940,
            rows_out=8_812,
            rows_quarantined=128,
            columns_added=["priority", "store_id"],
            quality_lift_pct=4.2,
            latency_ms=940,
            null_rate_before=0.07,
            null_rate_after=0.01,
        ),
    ),
    LayerOperation(
        id="silver-weather-news-context",
        layer="silver",
        name="join_weather_news_context",
        engine="python",
        summary="External weather and news feeds normalized and keyed by store_city + hour.",
        code=(
            'weather_h = weather_raw.resample("1H", on="observed_at").mean(\n'
            "  numeric_only=True)\n"
            'news_h = news_raw.groupby(\n'
            '  [pd.Grouper(key="published_at", freq="1H"), "city"]).size()\n'
            'context = weather_h.join(news_h, how="outer").reset_index()'
        ),
        inputs=["bronze.weather_feed", "bronze.news_feed"],
        outputs=["silver.city_hour_context"],
        impact=OperationImpact(
            rows_in=19_680,
            rows_out=19_680,
            columns_added=["temp_c", "precip_mm", "news_volume"],
            quality_lift_pct=1.8,
            latency_ms=610,
            null_rate_before=0.11,
            null_rate_after=0.03,
        ),
    ),
    LayerOperation(
        id="gold-store-hourly-metrics",
        layer="gold",
        name="rollup_store_hourly_metrics",
        engine="sql",
        summary="Hourly grain rollup of orders, GMV, and late-delivery rate per store.",
        code=(
            "select store_id, date_trunc('hour', created_at) as hour, count(*) as orders, "
            "sum(order_total) as gmv, avg((is_late)::int)::double precision as late_rate\n"
            "from silver.orders o join silver.deliveries d using (order_id)\ngroup by 1, 2"
        ),
        inputs=["silver.orders", "silver.deliveries"],
        outputs=["gold.store_hourly_metrics"],
        impact=OperationImpact(rows_in=183_996, rows_out=28_940, latency_ms=2_340),
    ),
    LayerOperation(
        id="gold-inventory-health",
        layer="gold",
        name="rollup_inventory_health",
        engine="sql",
        summary="Stock cover hours and reorder flags computed per store x SKU.",
        code=(
            "select store_id, sku, on_hand_qty,\n"
            "       on_hand_qty / greatest(avg_hourly_sales, 0.01) as stock_cover_hours,\n"
            "       stock_cover_hours < reorder_threshold as is_below_reorder_point\n"
            "from silver.inventory join silver.sales_velocity using (store_id, sku)"
        ),
        inputs=["silver.inventory", "silver.orders"],
        outputs=["gold.inventory_health"],
        impact=OperationImpact(rows_in=41_845, rows_out=6_930, latency_ms=1_120),
    ),
    LayerOperation(
        id="gold-support-escalations",
        layer="gold",
        name="rollup_support_escalation_metrics",
        engine="sql",
        summary="Daily escalation rate and mean time-to-resolution per store from tickets.",
        code=(
            "select store_id, date_trunc('day', created_at) as day, count(*) as tickets,\n"
            "       avg((escalated)::int)::double precision as escalation_rate,\n"
            "       avg(extract(epoch from resolved_at - created_at)) as mttr_seconds\n"
            "from silver.support_tickets\ngroup by 1, 2"
        ),
        inputs=["silver.support_tickets"],
        outputs=["gold.support_escalation_metrics"],
        impact=OperationImpact(rows_in=8_812, rows_out=1_140, latency_ms=780),
    ),
    LayerOperation(
        id="gold-ml-delivery-writeback",
        layer="gold",
        name="ml_delivery_prediction_writeback",
        engine="ml",
        summary="Delivery-delay model scores in-flight orders and writes P(late) back to gold.",
        code=(
            'preds = delivery_model.predict_proba(features)[:, 1]\n'
            'gold_write("gold.delivery_predictions", order_id=features["order_id"], '
            'p_late=preds, scored_at=now())'
        ),
        inputs=["silver.orders", "silver.rider_locations", "silver.city_hour_context"],
        outputs=["gold.delivery_predictions"],
        impact=OperationImpact(
            rows_in=5_890, rows_out=5_890, columns_added=["p_late", "scored_at"], latency_ms=340
        ),
    ),
]

_LAYER_SUMMARIES: dict[str, LayerSummary] = {
    "raw": LayerSummary(
        tables=15, ops=0, row_estimate=396_000, purpose="PostgreSQL operational source of truth"
    ),
    "bronze": LayerSummary(
        tables=11,
        ops=5,
        row_estimate=372_225,
        purpose="Append-only landing, one-to-one with source payloads",
    ),
    "silver": LayerSummary(
        tables=8,
        ops=6,
        row_estimate=326_465,
        purpose="Conformed, typed, deduplicated business entities",
    ),
    "quarantine": LayerSummary(
        tables=4,
        ops=3,
        row_estimate=5_432,
        purpose="Rows that failed validation, held for inspection, never dropped",
    ),
    "gold": LayerSummary(
        tables=6,
        ops=4,
        row_estimate=42_900,
        purpose="Aggregated, decision-ready marts and ML feature/prediction tables",
    ),
}

_SAMPLES: dict[MedallionLayer, LayerSample] = {
    "bronze": LayerSample(
        layer="bronze",
        before=[
            {
                "order_id": 500123,
                "customer_id": 9021,
                "store_id": 4,
                "status": "PLACED",
                "total_amount": 412.5,
                "created_at": "2026-09-25T03:41:02Z",
            }
        ],
        after=[
            {
                "order_id": 500123,
                "customer_id": 9021,
                "store_id": 4,
                "status": "PLACED",
                "total_amount": 412.5,
                "created_at": "2026-09-25T03:41:02Z",
                "_cdc_op": "c",
                "_cdc_ts_ms": 1758768062000,
                "_cdc_lsn": "0/1A2FF30",
            }
        ],
        notes=["Debezium adds change-metadata columns but never mutates the source payload."],
    ),
    "silver": LayerSample(
        layer="silver",
        before=[
            {
                "order_id": 500118,
                "customer_id": 9017,
                "store_id": None,
                "status": "placed",
                "total_amount": "398.00",
                "_cdc_op": "u",
            },
            {
                "order_id": 500118,
                "customer_id": 9017,
                "store_id": 4,
                "status": "placed",
                "total_amount": "398.00",
                "_cdc_op": "u",
            },
        ],
        after=[
            {
                "order_id": 500118,
                "customer_id": 9017,
                "store_id": 4,
                "order_status": "PLACED",
                "order_total": 398.0,
                "created_at": "2026-09-25T03:40:01Z",
            }
        ],
        notes=["Keeps only the latest CDC event per order_id; earlier rows are superseded."],
    ),
    "quarantine": LayerSample(
        layer="quarantine",
        before=[
            {
                "store_id": 4,
                "sku": "QC-108",
                "on_hand_qty": -3,
                "updated_at": "2026-09-25T03:12:00Z",
            },
        ],
        after=[
            {
                "store_id": 4,
                "sku": "QC-108",
                "on_hand_qty": -3,
                "updated_at": "2026-09-25T03:12:00Z",
                "_reject_reason": "on_hand_qty < 0",
            }
        ],
        notes=["Rejected rows keep their original payload plus a structured reject reason."],
    ),
    "gold": LayerSample(
        layer="gold",
        before=[
            {"order_id": 500001, "store_id": 4, "order_total": 210.0, "is_late": False},
            {"order_id": 500002, "store_id": 4, "order_total": 640.0, "is_late": True},
        ],
        after=[
            {
                "store_id": 4,
                "hour": "2026-09-25T02:00:00Z",
                "orders": 2,
                "gmv": 850.0,
                "late_rate": 0.5,
            }
        ],
        notes=["Row-level orders and deliveries collapse into one hourly grain row per store."],
    ),
    "raw": LayerSample(
        layer="raw",
        before=[],
        after=[
            {
                "order_id": 500123,
                "customer_id": 9021,
                "store_id": 4,
                "status": "PLACED",
                "total_amount": 412.5,
            }
        ],
        notes=["Raw is the operational source; there is no upstream transform to sample."],
    ),
}


def build_layers_catalog(*, generated_at: datetime | None = None) -> LayersCatalog:
    """Return the full operations catalog for the /layers console page."""
    now = generated_at or datetime.now(UTC)
    return LayersCatalog(
        generated_at=_utc_iso(now),
        operations=list(_OPERATIONS),
        layer_summaries=dict(_LAYER_SUMMARIES),
    )


def layer_sample(layer: str) -> LayerSample:
    """Return a representative before/after sample for a medallion layer.

    Raises ``LayerOpsError`` for a layer name outside the medallion set.
    """
    if layer not in _SAMPLES:
        raise LayerOpsError(f"unknown layer {layer!r}; expected one of {sorted(_SAMPLES)}")
    return _SAMPLES[layer]  # type: ignore[index]
