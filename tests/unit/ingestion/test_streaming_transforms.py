"""Structured Streaming transform tests on static micro-batches (no broker)."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from pyspark.sql import functions as F

from quickcart.ingestion.streaming import apply_late_policy, parse_event_batch, write_bronze_batch

pytestmark = pytest.mark.unit

NOW = datetime(2026, 9, 23, 12, 0, 0, tzinfo=UTC)


def _envelope(event_id: str, event_time: datetime, event_type: str = "ORDER_PLACED") -> str:
    return json.dumps(
        {
            "event_id": event_id,
            "event_type": event_type,
            "schema_version": 1,
            "event_time": event_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "producer": "quickcart-simulator",
            "entity_type": "order",
            "entity_id": "1",
            "store_id": 7,
            "payload": {"order_id": 1, "total_amount": "100.00", "currency": "INR"},
        }
    )


def _kafka_batch(spark, rows: list[tuple[int, int, int, str]]):
    """rows: (partition, offset, timestamp_ms, value_json)"""
    frame = spark.createDataFrame(
        rows, "partition: int, offset: int, timestamp: long, value: string"
    )
    return frame.withColumn("topic", F.lit("quickcart.order-events.v1"))


def test_parse_event_batch_splits_good_and_malformed(spark_session) -> None:
    good = _envelope("e1", NOW)
    malformed = '{"event_id": "broken"'
    batch = _kafka_batch(
        spark_session,
        [
            (0, 0, int(NOW.timestamp() * 1000), good),
            (0, 1, int(NOW.timestamp() * 1000), malformed),
        ],
    )
    parsed = parse_event_batch(batch)
    good_rows = parsed.filter("_parse_ok").collect()
    bad_rows = parsed.filter("not _parse_ok").collect()
    assert len(good_rows) == 1
    assert good_rows[0]["event_id"] == "e1"
    assert good_rows[0]["_topic"] == "quickcart.order-events.v1"
    assert good_rows[0]["_partition"] == 0
    assert good_rows[0]["_offset"] == 1 - 1  # first row offset 0
    assert len(bad_rows) == 1
    assert bad_rows[0]["_offset"] == 1


def test_late_policy_drops_events_past_watermark(spark_session) -> None:
    # Naive wall-clock fixtures: Spark 4 renders collected timestamps in the
    # host TZ on some code paths; within-Spark comparisons stay consistent.
    now = NOW.replace(tzinfo=None)
    events = spark_session.createDataFrame(
        [
            ("e1", now - timedelta(minutes=2)),  # within 10-minute lateness
            ("e2", now - timedelta(minutes=45)),  # too late
            ("e3", now),
        ],
        "event_id: string, event_time: timestamp",
    )
    on_time, watermark, dropped = apply_late_policy(events, None, allowed_lateness_minutes=10)
    assert dropped == 1
    assert {r["event_id"] for r in on_time.collect()} == {"e1", "e3"}
    assert watermark == now

    # A batch of only-old events still drops them once the watermark moved on.
    only_late = spark_session.createDataFrame(
        [("e4", now - timedelta(minutes=20))],
        "event_id: string, event_time: timestamp",
    )
    on_time2, _, dropped2 = apply_late_policy(only_late, watermark, allowed_lateness_minutes=10)
    assert dropped2 == 1
    assert on_time2.count() == 0


def test_write_bronze_batch_routes_to_bronze_and_quarantine(spark_session, tmp_path) -> None:
    good = _envelope("e1", NOW)
    malformed = "not json at all"
    batch = _kafka_batch(
        spark_session,
        [
            (0, 0, int(NOW.timestamp() * 1000), good),
            (0, 1, int(NOW.timestamp() * 1000), malformed),
        ],
    )
    root = tmp_path / "lake"
    write_bronze_batch(batch, 0, root)

    bronze = spark_session.read.format("delta").load(str(root / "bronze" / "bronze_order_events"))
    quarantine = spark_session.read.format("delta").load(
        str(root / "quarantine" / "bronze_order_events_malformed")
    )
    assert bronze.count() == 1
    assert bronze.first()["event_id"] == "e1"
    assert quarantine.count() == 1
    assert quarantine.first()["_offset"] == 1
    assert quarantine.first()["_json"] == malformed
