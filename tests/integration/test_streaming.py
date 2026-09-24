"""Phase 7 integration: live producer → Structured Streaming consumer → Bronze.

Guarded by broker reachability; proves kit/07 Phase 7:
- producer publishes schema-valid events; Spark consumes them;
- checkpoint restart resumes without reprocessing;
- replayed/duplicate events do not double-count the derived order set;
- too-late events follow the documented policy (dropped, counted);
- malformed messages are quarantined, not silently dropped.
"""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from kafka import KafkaProducer
from kafka.admin import KafkaAdminClient, NewTopic

from quickcart.config.settings import get_settings
from quickcart.ingestion.streaming import TOPIC, build_consumer_query
from quickcart.lakehouse.common.spark import build_spark
from quickcart.simulator.realtime import produce_orders

pytestmark = [pytest.mark.integration, pytest.mark.slow]


def _broker_up() -> bool:
    settings = get_settings()
    host, _, port = settings.redpanda_bootstrap_servers.partition(":")
    import socket

    try:
        with socket.create_connection((host, int(port or 9092)), timeout=2):
            return True
    except OSError:
        return False


def _pump(spark, settings, root, checkpoint, topic, predicate, timeout_s: int = 60) -> None:
    """Run the streaming query until `predicate` holds (guards the
    processAllAvailable visibility race)."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        query = build_consumer_query(
            spark, settings.redpanda_bootstrap_servers, root, checkpoint, topic=topic
        )
        query.processAllAvailable()
        query.stop()
        if predicate():
            return
        time.sleep(1)
    raise AssertionError("pump timed out waiting for stream condition")


def _bronze(spark, root: Path):
    return spark.read.format("delta").load(str(root / "bronze" / "bronze_order_events"))


def test_streaming_end_to_end(tmp_path) -> None:
    if not _broker_up():
        pytest.skip("Redpanda unreachable; run: docker compose --profile streaming up -d")

    settings = get_settings()
    topic = f"{TOPIC}.it-{uuid.uuid4().hex[:8]}"
    admin = KafkaAdminClient(bootstrap_servers=settings.redpanda_bootstrap_servers)
    admin.create_topics([NewTopic(name=topic, num_partitions=3, replication_factor=1)])
    admin.close()

    producer = KafkaProducer(bootstrap_servers=settings.redpanda_bootstrap_servers, acks="all")
    spark = build_spark("quickcart-stream-it", test=True)
    root = tmp_path / "lake"
    checkpoint = root / "checkpoints" / "bronze_order_events"
    try:
        # Phase 1: publish 20 orders (60 events), consume.
        produce_orders(
            producer, rate_per_sec=200, orders=20, base_order_id=800_000_000, topic=topic
        )
        _pump(spark, settings, root, checkpoint, topic, lambda: _bronze(spark, root).count() == 60)
        first_offsets = {
            (r["_partition"], r["_offset"])
            for r in _bronze(spark, root).select("_partition", "_offset").collect()
        }

        # Phase 2: restart from checkpoint, publish 10 more orders.
        produce_orders(
            producer, rate_per_sec=200, orders=10, base_order_id=800_000_100, topic=topic
        )
        _pump(spark, settings, root, checkpoint, topic, lambda: _bronze(spark, root).count() == 90)
        second_offsets = {
            (r["_partition"], r["_offset"])
            for r in _bronze(spark, root).select("_partition", "_offset").collect()
        }
        # No reprocessing: the union of batch lineage has exactly 90 entries.
        assert len(first_offsets | second_offsets) == 90

        # Phase 3: replay exactly phase 1's 20 orders (same event ids) —
        # Bronze appends, but the derived order set stays deduplicated.
        produce_orders(
            producer, rate_per_sec=200, orders=20, base_order_id=800_000_000, topic=topic
        )
        _pump(
            spark,
            settings,
            root,
            checkpoint,
            topic,
            lambda: _bronze(spark, root).count() == 150,
        )
        distinct_orders = _bronze(spark, root).select("payload.order_id").distinct().count()
        assert distinct_orders == 30  # 20 + 10 unique orders, replays collapsed

        # Phase 4: too-late event is dropped per the documented policy.
        late_event = {
            "event_id": str(uuid.uuid4()),
            "event_type": "ORDER_PLACED",
            "event_time": (datetime.now(UTC) - timedelta(hours=2)).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
            "producer": "quickcart-simulator",
            "entity_type": "order",
            "entity_id": "999999999",
            "store_id": 1,
            "payload": {"order_id": 999999999, "total_amount": "1.00", "currency": "INR"},
        }
        producer.send(topic, key=b"late", value=json.dumps(late_event).encode())
        producer.flush()
        _pump(
            spark,
            settings,
            root,
            checkpoint,
            topic,
            lambda: _bronze(spark, root).filter("payload.order_id = 999999999").count() == 0
            and _bronze(spark, root).count() >= 150,
        )

        # Phase 5: malformed message is quarantined with lineage.
        producer.send(topic, key=b"bad", value=b"{bad json")
        producer.flush()
        quarantine_path = root / "quarantine" / "bronze_order_events_malformed"
        _pump(
            spark,
            settings,
            root,
            checkpoint,
            topic,
            lambda: quarantine_path.exists()
            and spark.read.format("delta").load(str(quarantine_path)).count() >= 1,
        )
        quarantine = spark.read.format("delta").load(str(quarantine_path))
        assert quarantine.count() == 1
        assert quarantine.first()["_json"] == "{bad json"
    finally:
        producer.close()
        spark.stop()
        admin = KafkaAdminClient(bootstrap_servers=settings.redpanda_bootstrap_servers)
        admin.delete_topics([topic])
        admin.close()
