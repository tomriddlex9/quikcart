"""Structured Streaming ingestion: Redpanda → Bronze Delta (kit/03 §7.4/§7.5).

Per-event contract (kit/04 §4): stable `event_id`, `event_time` (business
time, distinct from broker ingestion), `schema_version`, payload.

Reliability choices:
- checkpoint under `data/checkpoints/` — restarts resume from committed
  offsets (no naive double processing);
- every bronze row carries `_topic/_partition/_offset` lineage plus the
  envelope `event_id`;
- malformed JSON is never silently dropped: it lands in
  `data/quarantine/bronze_order_events_malformed` with the same lineage;
- late-event policy (kit/03 §7.5): with 10-minute allowed lateness, an
  event older than the batch's maximum event_time minus the threshold is
  counted in `_late_dropped` and excluded from Bronze. This mirrors Spark's
  watermark semantics in the local foreachBatch sink; the native
  `withWatermark` form is exercised by the demo aggregation query.
"""

import argparse
from datetime import datetime
from pathlib import Path

import structlog
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.learning.schemas import ORDER_EVENTS_SCHEMA
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

TOPIC = "quickcart.order-events.v1"
ALLOWED_LATENESS_MINUTES = 10


def parse_event_batch(batch: DataFrame) -> DataFrame:
    """Kafka micro-batch → parsed events with lineage and parse status."""
    raw = batch.selectExpr(
        "topic",
        "partition",
        "offset",
        "timestamp as _broker_ingested_at",
        "CAST(value AS STRING) as _json",
    )
    return (
        raw.withColumn("_parsed", F.from_json("_json", ORDER_EVENTS_SCHEMA))
        .select(
            "topic",
            "partition",
            "offset",
            "_broker_ingested_at",
            "_json",
            "_parsed.*",
            F.when(F.col("event_id").isNotNull(), True).otherwise(False).alias("_parse_ok"),
        )
        .withColumnRenamed("topic", "_topic")
        .withColumnRenamed("partition", "_partition")
        .withColumnRenamed("offset", "_offset")
        .withColumn("_ingested_at", F.current_timestamp())
    )


def _read_watermark(path: Path) -> datetime | None:
    file = path / "_watermark"
    if not file.exists():
        return None
    return datetime.fromisoformat(file.read_text(encoding="utf-8").strip())


def _write_watermark(path: Path, watermark: "datetime") -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / "_watermark").write_text(watermark.isoformat(), encoding="utf-8")


def apply_late_policy(
    events: DataFrame,
    watermark: datetime | None,
    allowed_lateness_minutes: int = ALLOWED_LATENESS_MINUTES,
) -> tuple[DataFrame, datetime | None, int]:
    """Drop events at or before (watermark - allowed lateness).

    `watermark` is the running maximum event_time seen so far (persisted by
    the caller across batches/restarts, mirroring Spark's streaming
    watermark). Returns (on_time_events, new_watermark, dropped_count).
    """
    batch_max = events.agg(F.max("event_time")).first()[0]
    if batch_max is None:
        return events, watermark, 0
    effective = max(watermark, batch_max) if watermark is not None else batch_max
    cutoff = effective - F.expr(f"INTERVAL {allowed_lateness_minutes} MINUTES")
    dropped = events.filter(F.col("event_time") < cutoff).count()
    on_time = events.filter(F.col("event_time") >= cutoff)
    return on_time, effective, dropped


def write_bronze_batch(
    batch: DataFrame,
    batch_id: int,
    root: Path,
    checkpoint_name: str = "bronze_order_events",
) -> None:
    """foreachBatch sink: good rows → Bronze, malformed → quarantine."""
    parsed = parse_event_batch(batch)
    good = parsed.filter("_parse_ok and event_id is not null").drop("_parse_ok")
    malformed = parsed.filter("not _parse_ok or event_id is null").drop("_parse_ok")

    checkpoint_dir = root / "checkpoints" / checkpoint_name
    watermark = _read_watermark(checkpoint_dir)
    on_time, new_watermark, dropped = apply_late_policy(good, watermark)
    if dropped:
        log.info("stream.late_dropped", batch_id=batch_id, dropped=dropped)
    if new_watermark is not None and new_watermark != watermark:
        _write_watermark(checkpoint_dir, new_watermark)

    if on_time.head(1):
        on_time.write.format("delta").mode("append").save(
            str(root / "bronze" / checkpoint_name)
        )
    if malformed.head(1):
        malformed.write.format("delta").mode("append").save(
            str(root / "quarantine" / f"{checkpoint_name}_malformed")
        )


def build_consumer_query(
    spark: SparkSession,
    bootstrap_servers: str,
    root: Path,
    checkpoint_dir: Path,
    topic: str = TOPIC,
):
    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", bootstrap_servers)
        .option("subscribe", topic)
        .option("startingOffsets", "earliest")
        .load()
    )
    return (
        raw.writeStream.foreachBatch(
            lambda batch, batch_id: write_bronze_batch(batch, batch_id, root)
        )
        .option("checkpointLocation", str(checkpoint_dir))
        .trigger(processingTime="3 seconds")
        .start()
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stream Redpanda order events into Bronze")
    parser.add_argument(
        "--once", action="store_true", help="single micro-batch then exit (smoke test)"
    )
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)

    settings = get_settings()
    root = settings.data_root
    checkpoint_dir = root / "checkpoints" / "bronze_order_events"
    spark = build_spark("quickcart-stream-consumer")
    query = build_consumer_query(spark, settings.redpanda_bootstrap_servers, root, checkpoint_dir)
    log.info("stream.consumer_started", topic=TOPIC, checkpoint=str(checkpoint_dir))
    try:
        if args.once:
            query.processAllAvailable()
            query.stop()
        else:
            query.awaitTermination()
    except KeyboardInterrupt:
        log.info("stream.stopping")
        query.stop()
    finally:
        spark.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
