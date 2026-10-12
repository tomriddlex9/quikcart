"""CDC silver merge must tolerate batch metadata columns such as _ingested_at."""

import json
from datetime import datetime
from decimal import Decimal

import pytest
from pyspark.sql.types import StringType, StructField, StructType, TimestampType

from quickcart.ingestion.cdc import apply_cdc_to_silver, silver_merge_column_maps
from quickcart.lakehouse.common.schemas import ORDERS_SCHEMA

pytestmark = pytest.mark.unit

PLACED = datetime(2026, 10, 11, 10, 0, 0)
INGESTED = datetime(2026, 10, 1, 8, 0, 0)


def _silver_schema() -> StructType:
    return StructType(
        [
            *ORDERS_SCHEMA.fields,
            StructField("_ingested_at", TimestampType(), False),
            StructField("_source_system", StringType(), False),
        ]
    )


def test_merge_maps_leave_metadata_out_of_the_update() -> None:
    pytest.importorskip("pyspark")
    target = _silver_schema()
    update_set, insert_values = silver_merge_column_maps(
        [field.name for field in ORDERS_SCHEMA.fields],
        target,
    )
    assert "_ingested_at" not in update_set
    assert update_set["status"] == "s.status"
    assert insert_values["_ingested_at"] == "current_timestamp()"
    assert insert_values["_source_system"] == "'debezium'"
    assert insert_values["order_id"] == "s.order_id"


def _order_json(order_id: int, status: str) -> str:
    return json.dumps(
        {
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
            "placed_at": "2026-10-11 10:00:00",
            "updated_at": "2026-10-11 12:00:00",
        }
    )


def _write_bronze(spark, root, rows: list[tuple]) -> None:
    frame = spark.createDataFrame(
        rows,
        "operation: string, order_id_after: long, order_id_before: long, "
        "after_json: string, source_ts_ms: long",
    )
    frame.write.format("delta").mode("overwrite").save(str(root / "bronze" / "bronze_orders_cdc"))


def _order_values(order_id: int, status: str) -> tuple:
    return (
        order_id,
        1,
        1,
        None,
        None,
        status,
        Decimal("100.00"),
        Decimal("0.00"),
        Decimal("0.00"),
        Decimal("30.00"),
        Decimal("6.50"),
        Decimal("136.50"),
        "INR",
        PLACED,
        PLACED,
    )


def test_apply_cdc_merges_into_silver_that_has_ingested_at(spark_session, tmp_path) -> None:
    existing = spark_session.createDataFrame(
        [(*_order_values(1, "PLACED"), INGESTED, "postgres")],
        _silver_schema(),
    )
    existing.write.format("delta").mode("overwrite").save(
        str(tmp_path / "silver" / "silver_orders")
    )
    _write_bronze(
        spark_session,
        tmp_path,
        [
            ("u", 1, 1, _order_json(1, "DELIVERED"), 200),
            ("c", 2, None, _order_json(2, "PLACED"), 300),
        ],
    )

    metrics = apply_cdc_to_silver(spark_session, tmp_path)

    assert metrics["updated"] == 1
    assert metrics["inserted"] == 1
    stored = spark_session.read.format("delta").load(str(tmp_path / "silver" / "silver_orders"))
    by_id = {row["order_id"]: row for row in stored.collect()}
    assert by_id[1]["status"] == "DELIVERED"
    assert by_id[1]["_ingested_at"] == INGESTED
    assert by_id[1]["_source_system"] == "postgres"
    assert by_id[2]["status"] == "PLACED"
    assert by_id[2]["_ingested_at"] is not None
    assert by_id[2]["_source_system"] == "debezium"
