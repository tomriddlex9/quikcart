"""CDC normalize unit tests (static envelope fixtures, no broker)."""

import json

import pytest
from pyspark.sql import functions as F

from quickcart.ingestion.cdc import normalize_debezium

pytestmark = pytest.mark.unit


def _envelope(op: str, before: dict | None, after: dict | None, ts_ms: int = 1758624000000) -> str:
    return json.dumps(
        {
            "before": before,
            "after": after,
            "op": op,
            "source": {"version": "3.6.3.Final", "ts_ms": ts_ms, "lsn": "12345"},
        }
    )


def _row(order_id: int, status: str = "DELIVERED") -> dict:
    return {
        "order_id": order_id,
        "customer_id": 1,
        "store_id": 1,
        "address_id": None,
        "promotion_id": None,
        "status": status,
        "subtotal": "100.00",
        "item_discount": "0.00",
        "promo_discount": "0.00",
        "delivery_fee": "30.00",
        "tax_amount": "6.50",
        "total_amount": "136.50",
        "currency": "INR",
        "placed_at": "2026-09-23 10:00:00",
        "updated_at": "2026-09-23 10:30:00",
    }


def _batch(spark, rows: list[str]):
    frame = spark.createDataFrame(
        [(i, 0, i, value) for i, value in enumerate(rows)],
        "partition: int, offset: int, timestamp: long, value: string",
    )
    return frame.withColumn("topic", F.lit("quickcart.public.orders"))


def test_normalize_maps_operations_and_payloads(spark_session) -> None:
    rows = [
        _envelope("c", None, _row(1, "PLACED")),
        _envelope("u", _row(1, "PLACED"), _row(1, "DELIVERED"), ts_ms=1758624001000),
        _envelope("d", _row(2), None),
    ]
    normalized = normalize_debezium(_batch(spark_session, rows)).collect()
    assert len(normalized) == 3
    by_op = {r["operation"]: r for r in normalized}
    assert by_op["c"]["order_id_after"] == 1
    assert by_op["u"]["order_id_after"] == 1
    assert by_op["u"]["order_id_before"] == 1
    assert by_op["d"]["order_id_before"] == 2
    assert by_op["d"]["order_id_after"] is None
    assert by_op["u"]["source_lsn"] == "12345"
    assert json.loads(by_op["u"]["after_json"])["status"] == "DELIVERED"
