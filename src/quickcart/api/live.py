"""Live operational snapshot, SSE, pipeline, and lineage API routes.

The module is intentionally mountable: the main application only needs to
call :func:`register_live_routes`. It performs no Spark startup and all
PostgreSQL access is placed in server-enforced read-only transactions.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import structlog
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from psycopg.rows import dict_row

from quickcart.api.catalog_lineage import (
    build_catalog_lineage,
    delta_layer_counts,
    postgres_row_counts,
)
from quickcart.api.gold_cache import warmup_gold_cache
from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.live.contracts import (
    CatalogLineage,
    LayerCounts,
    LiveMinuteBucket,
    LiveOrderRow,
    LivePipeline,
    LiveSnapshot,
    LiveStoreCount,
    StageHeartbeat,
)

log = structlog.get_logger(__name__)

DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)
SSE_INTERVAL_SECONDS = 2.0

_SNAPSHOT_TOTALS_SQL = """
SELECT
    count(*) FILTER (WHERE placed_at >= now() - interval '1 minute')::bigint AS orders_1m,
    count(*) FILTER (WHERE placed_at >= now() - interval '15 minutes')::bigint AS orders_15m,
    count(*) FILTER (WHERE placed_at >= now() - interval '60 minutes')::bigint AS orders_60m,
    coalesce(sum(total_amount) FILTER (
        WHERE placed_at >= now() - interval '1 minute'
          AND status NOT IN ('CANCELLED', 'REFUNDED')
    ), 0) AS gmv_1m,
    coalesce(sum(total_amount) FILTER (
        WHERE placed_at >= now() - interval '15 minutes'
          AND status NOT IN ('CANCELLED', 'REFUNDED')
    ), 0) AS gmv_15m,
    coalesce(sum(total_amount) FILTER (
        WHERE placed_at >= now() - interval '60 minutes'
          AND status NOT IN ('CANCELLED', 'REFUNDED')
    ), 0) AS gmv_60m
FROM orders
WHERE placed_at >= now() - interval '60 minutes'
"""

_MINUTE_BUCKETS_SQL = """
WITH minutes AS (
    SELECT generate_series(
        date_trunc('minute', now()) - interval '59 minutes',
        date_trunc('minute', now()),
        interval '1 minute'
    ) AS minute
),
aggregated AS (
    SELECT
        date_trunc('minute', placed_at) AS minute,
        count(*)::bigint AS orders,
        coalesce(sum(total_amount) FILTER (
            WHERE status NOT IN ('CANCELLED', 'REFUNDED')
        ), 0) AS gmv
    FROM orders
    WHERE placed_at >= date_trunc('minute', now()) - interval '59 minutes'
    GROUP BY date_trunc('minute', placed_at)
)
SELECT minutes.minute, coalesce(aggregated.orders, 0)::bigint AS orders,
       coalesce(aggregated.gmv, 0) AS gmv
FROM minutes
LEFT JOIN aggregated USING (minute)
ORDER BY minutes.minute
"""

_STATUS_MIX_SQL = """
SELECT status, count(*)::bigint AS orders
FROM orders
WHERE placed_at >= now() - interval '60 minutes'
GROUP BY status
ORDER BY status
"""

_PER_STORE_SQL = """
SELECT
    store_id,
    count(*) FILTER (WHERE placed_at >= now() - interval '1 minute')::bigint AS orders_1m,
    count(*)::bigint AS orders_15m,
    coalesce(sum(total_amount) FILTER (
        WHERE status NOT IN ('CANCELLED', 'REFUNDED')
    ), 0) AS gmv_15m
FROM orders
WHERE placed_at >= now() - interval '15 minutes'
GROUP BY store_id
ORDER BY store_id
"""

_RECENT_ORDERS_SQL = """
SELECT order_id, store_id, status, total_amount, placed_at, customer_id
FROM orders
ORDER BY placed_at DESC
LIMIT 25
"""

_PAYMENT_FAILURE_SQL = """
SELECT coalesce(
    count(*) FILTER (WHERE status = 'FAILED')::double precision
    / nullif(count(*), 0),
    0
) AS failure_rate
FROM payments
WHERE created_at >= now() - interval '15 minutes'
"""

_ACTIVE_DELIVERIES_SQL = """
SELECT count(*)::bigint AS active_deliveries
FROM deliveries
WHERE delivered_at IS NULL
  AND cancelled_at IS NULL
  AND status <> 'CANCELLED'
"""

_HEARTBEATS_SQL = """
SELECT stage, last_run_at, rows_in, rows_out, lag_seconds, error, detail, updated_at
FROM pipeline_status
ORDER BY stage
"""


def resolve_cors_origins() -> list[str]:
    """Resolve console origins from ``QUICKCART_CORS_ORIGINS``.

    The environment value is comma-separated. Whitespace, empty entries, and
    duplicates are removed while preserving order. An unset or blank value
    falls back to both localhost spellings on port 3000.
    """
    configured = os.getenv("QUICKCART_CORS_ORIGINS", "")
    origins = list(dict.fromkeys(item.strip() for item in configured.split(",") if item.strip()))
    return origins or list(DEFAULT_CORS_ORIGINS)


def _utc_iso(value: datetime | str) -> str:
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _number(value: Any, cast: Callable[[Any], Any]) -> Any:
    return cast(value or 0)


def _fetchone(cursor: Any, statement: str) -> dict[str, Any]:
    cursor.execute(statement)
    return cursor.fetchone() or {}


def _fetchall(cursor: Any, statement: str) -> list[dict[str, Any]]:
    cursor.execute(statement)
    return list(cursor.fetchall())


def build_live_snapshot(
    *,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    generated_at: datetime | None = None,
) -> LiveSnapshot:
    """Read one consistent operational snapshot from PostgreSQL."""
    with connect_factory() as conn:
        conn.read_only = True
        with conn.transaction(), conn.cursor(row_factory=dict_row) as cursor:
            totals = _fetchone(cursor, _SNAPSHOT_TOTALS_SQL)
            minutes = _fetchall(cursor, _MINUTE_BUCKETS_SQL)
            statuses = _fetchall(cursor, _STATUS_MIX_SQL)
            stores = _fetchall(cursor, _PER_STORE_SQL)
            recent = _fetchall(cursor, _RECENT_ORDERS_SQL)
            payment = _fetchone(cursor, _PAYMENT_FAILURE_SQL)
            deliveries = _fetchone(cursor, _ACTIVE_DELIVERIES_SQL)

    now = generated_at or datetime.now(UTC)
    return LiveSnapshot(
        generated_at=_utc_iso(now),
        orders_1m=_number(totals.get("orders_1m"), int),
        orders_15m=_number(totals.get("orders_15m"), int),
        orders_60m=_number(totals.get("orders_60m"), int),
        gmv_1m=_number(totals.get("gmv_1m"), float),
        gmv_15m=_number(totals.get("gmv_15m"), float),
        gmv_60m=_number(totals.get("gmv_60m"), float),
        orders_per_minute=[
            LiveMinuteBucket(
                minute=_utc_iso(row["minute"]),
                orders=_number(row.get("orders"), int),
                gmv=_number(row.get("gmv"), float),
            )
            for row in minutes
        ],
        status_mix={str(row["status"]): _number(row.get("orders"), int) for row in statuses},
        per_store=[
            LiveStoreCount(
                store_id=int(row["store_id"]),
                orders_1m=_number(row.get("orders_1m"), int),
                orders_15m=_number(row.get("orders_15m"), int),
                gmv_15m=_number(row.get("gmv_15m"), float),
            )
            for row in stores
        ],
        recent_orders=[
            LiveOrderRow(
                order_id=int(row["order_id"]),
                store_id=int(row["store_id"]),
                status=str(row["status"]),
                total_amount=_number(row.get("total_amount"), float),
                placed_at=_utc_iso(row["placed_at"]),
                customer_id=int(row["customer_id"]) if row.get("customer_id") is not None else None,
            )
            for row in recent
        ],
        payment_failure_rate_15m=_number(payment.get("failure_rate"), float),
        active_deliveries=_number(deliveries.get("active_deliveries"), int),
    )


async def _sse_events(
    snapshot_factory: Callable[[], LiveSnapshot],
    *,
    interval_seconds: float = SSE_INTERVAL_SECONDS,
) -> AsyncIterator[str]:
    """Yield immediately, then emit a JSON SSE data frame every interval."""
    while True:
        snapshot = await asyncio.to_thread(snapshot_factory)
        yield f"data: {snapshot.model_dump_json()}\n\n"
        await asyncio.sleep(interval_seconds)


def read_stage_heartbeats(
    connect_factory: Callable[..., psycopg.Connection] = connect,
) -> list[StageHeartbeat]:
    """Read worker heartbeats from PostgreSQL in a read-only transaction."""
    with connect_factory() as conn:
        conn.read_only = True
        with conn.transaction(), conn.cursor(row_factory=dict_row) as cursor:
            rows = _fetchall(cursor, _HEARTBEATS_SQL)
    heartbeats: list[StageHeartbeat] = []
    for row in rows:
        detail = row.get("detail") or {}
        if isinstance(detail, str):
            try:
                detail = json.loads(detail)
            except json.JSONDecodeError:
                detail = {"raw": detail}
        heartbeats.append(
            StageHeartbeat(
                stage=row["stage"],
                last_run_at=_utc_iso(row["last_run_at"]) if row.get("last_run_at") else None,
                rows_in=_number(row.get("rows_in"), int),
                rows_out=_number(row.get("rows_out"), int),
                lag_seconds=(
                    float(row["lag_seconds"]) if row.get("lag_seconds") is not None else None
                ),
                error=row.get("error"),
                detail=detail,
                updated_at=_utc_iso(row["updated_at"]) if row.get("updated_at") else None,
            )
        )
    return heartbeats


def redpanda_end_offsets(bootstrap_servers: str | None = None) -> dict[str, int]:
    """Return summed end offsets per QuickCart topic.

    ``kafka-python`` is optional. A missing package or unavailable broker
    degrades to an empty mapping, keeping the live API usable in core-only
    local profiles.
    """
    try:
        from kafka import KafkaConsumer, TopicPartition
    except ImportError:
        return {}

    consumer = None
    try:
        consumer = KafkaConsumer(
            bootstrap_servers=bootstrap_servers or get_settings().redpanda_bootstrap_servers,
            api_version=(0, 10, 1),
            request_timeout_ms=1_000,
            consumer_timeout_ms=1_000,
        )
        counts: dict[str, int] = {}
        for topic in sorted(name for name in consumer.topics() if name.startswith("quickcart.")):
            partitions = consumer.partitions_for_topic(topic) or set()
            topic_partitions = [TopicPartition(topic, partition) for partition in partitions]
            if topic_partitions:
                counts[topic] = sum(consumer.end_offsets(topic_partitions).values())
        return counts
    except Exception as exc:  # kafka-python uses several non-psycopg exception types
        log.warning("live.redpanda_unavailable", error=str(exc))
        return {}
    finally:
        if consumer is not None:
            consumer.close()


def build_live_pipeline(
    *,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    data_root: Path | None = None,
    offset_reader: Callable[[], dict[str, int]] = redpanda_end_offsets,
    generated_at: datetime | None = None,
) -> LivePipeline:
    """Build pipeline counts and heartbeats without starting Spark."""
    try:
        postgres = postgres_row_counts(connect_factory)
    except psycopg.Error as exc:
        log.warning("live.pipeline_postgres_counts_unavailable", error=str(exc))
        postgres = {}
    try:
        heartbeats = read_stage_heartbeats(connect_factory)
    except psycopg.Error as exc:
        log.warning("live.pipeline_heartbeats_unavailable", error=str(exc))
        heartbeats = []

    delta = delta_layer_counts(data_root)
    gold_heartbeat = next(
        (heartbeat for heartbeat in heartbeats if heartbeat.stage == "gold_refresh"),
        None,
    )
    lag_values = [
        heartbeat.lag_seconds
        for heartbeat in heartbeats
        if heartbeat.lag_seconds is not None
    ]
    now = generated_at or datetime.now(UTC)
    return LivePipeline(
        generated_at=_utc_iso(now),
        counts=LayerCounts(
            postgres=postgres,
            redpanda=offset_reader(),
            bronze=delta["bronze"],
            silver=delta["silver"],
            gold=delta["gold"],
            quarantine=delta["quarantine"],
        ),
        heartbeats=heartbeats,
        end_to_end_lag_seconds=max(lag_values) if lag_values else None,
        gold_refreshed_at=gold_heartbeat.last_run_at if gold_heartbeat else None,
    )


def register_live_routes(app: FastAPI) -> None:
    """Register the four A3 live routes on an existing FastAPI app."""

    def app_connect_factory(request: Request) -> Callable[..., psycopg.Connection]:
        return getattr(request.app.state, "connect_factory", connect)

    def app_data_root(request: Request) -> Path | None:
        return getattr(request.app.state, "data_root", None)

    @app.get("/api/v1/live/snapshot", response_model=LiveSnapshot)
    def live_snapshot(request: Request) -> LiveSnapshot:
        return build_live_snapshot(connect_factory=app_connect_factory(request))

    @app.get("/api/v1/live/stream")
    def live_stream(request: Request) -> StreamingResponse:
        def factory() -> LiveSnapshot:
            return build_live_snapshot(connect_factory=app_connect_factory(request))

        return StreamingResponse(
            _sse_events(factory),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/v1/live/pipeline", response_model=LivePipeline)
    def live_pipeline(request: Request) -> LivePipeline:
        return build_live_pipeline(
            connect_factory=app_connect_factory(request),
            data_root=app_data_root(request),
            offset_reader=getattr(
                request.app.state,
                "redpanda_offset_reader",
                redpanda_end_offsets,
            ),
        )

    @app.get("/api/v1/catalog/lineage", response_model=CatalogLineage)
    def catalog_lineage(request: Request) -> CatalogLineage:
        return build_catalog_lineage(
            connect_factory=app_connect_factory(request),
            data_root=app_data_root(request),
        )


__all__ = [
    "build_live_pipeline",
    "build_live_snapshot",
    "register_live_routes",
    "resolve_cors_origins",
    "warmup_gold_cache",
]
