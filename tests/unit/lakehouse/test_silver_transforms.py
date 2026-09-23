"""Silver transform tests: dirty fixtures must split into clean + quarantine
with the kit/04 §11 rule IDs (kit/07 Phase 4 acceptance)."""

import pytest
from pyspark.sql import functions as F

from quickcart.lakehouse.silver import transforms

pytestmark = pytest.mark.unit


def _orders(spark, rows):
    return spark.createDataFrame(
        rows,
        "order_id: bigint, customer_id: bigint, store_id: bigint, status: string, "
        "total_amount: string, placed_at: string, updated_at: string",
    ).select(
        "order_id",
        "customer_id",
        "store_id",
        F.to_timestamp("placed_at").alias("placed_at"),
        "status",
        F.col("total_amount").cast("decimal(12,2)").alias("total_amount"),
        F.to_timestamp("updated_at").alias("updated_at"),
    )


def test_valid_rows_pass_and_rule_ids_attach_to_bad_rows(spark_session) -> None:
    df = _orders(
        spark_session,
        [
            (1, 100, 10, "DELIVERED", "500.00", "2026-03-01 10:00:00", "2026-03-01 11:00:00"),
            (2, None, 10, "DELIVERED", "500.00", "2026-03-01 10:00:00", "2026-03-01 11:00:00"),
            (3, 101, 10, "FLYING", "500.00", "2026-03-01 10:00:00", "2026-03-01 11:00:00"),
            (4, 102, 10, "DELIVERED", "-10.00", "2026-03-01 10:00:00", "2026-03-01 11:00:00"),
        ],
    )
    clean, quarantine = transforms.clean_orders(df)
    assert clean.count() == 1
    bad = {row["order_id"]: row for row in quarantine.collect()}
    assert set(bad) == {2, 3, 4}
    assert "DQ-ORDER-003" in bad[2]["_error_codes"]
    assert "DQ-ORDER-005" in bad[3]["_error_codes"]
    assert "DQ-ORDER-004" in bad[4]["_error_codes"]
    for row in bad.values():
        assert row["_error_messages"]
        assert row["_quarantined_at"] is not None


def test_duplicate_business_keys_keep_latest(spark_session) -> None:
    df = _orders(
        spark_session,
        [
            (1, 100, 10, "DELIVERED", "500.00", "2026-03-01 10:00:00", "2026-03-01 10:30:00"),
            (1, 100, 10, "REFUNDED", "500.00", "2026-03-01 10:00:00", "2026-03-01 12:00:00"),
        ],
    )
    clean, quarantine = transforms.clean_orders(df)
    assert quarantine.count() == 0
    rows = clean.collect()
    assert len(rows) == 1
    assert rows[0]["status"] == "REFUNDED"  # newest updated_at wins


def test_order_item_quantity_rule(spark_session) -> None:
    items = spark_session.createDataFrame(
        [
            (1, 1, 5, 0, "10.00", "2026-09-22 10:00:00"),
            (2, 1, 5, 2, "10.00", "2026-09-22 10:00:00"),
        ],
        "order_item_id: bigint, order_id: bigint, product_id: bigint, "
        "quantity: int, unit_price: string, created_at: string",
    ).select(
        "order_item_id",
        "order_id",
        "product_id",
        "quantity",
        F.col("unit_price").cast("decimal(12,2)").alias("unit_price"),
        F.to_timestamp("created_at").alias("created_at"),
    )
    clean, quarantine = transforms.clean_order_items(items)
    assert [r["order_item_id"] for r in clean.collect()] == [2]
    bad = quarantine.collect()
    assert len(bad) == 1 and "DQ-ITEM-001" in bad[0]["_error_codes"]


def test_delivery_timestamp_ordering_rule(spark_session) -> None:
    deliveries = spark_session.createDataFrame(
        [
            (1, 1, "2026-03-01 10:40:00", "2026-03-01 10:00:00", "2026-03-01 10:10:00",
             "2026-03-01 10:05:00", None, 3.5, "DELIVERED",
             "2026-03-01 10:00:00", "2026-03-01 10:05:00"),
        ],
        "delivery_id: bigint, order_id: bigint, promised_by: string, assigned_at: string, "
        "picked_up_at: string, delivered_at: string, cancelled_at: string, "
        "estimated_distance_km: double, status: string, created_at: string, updated_at: string",
    ).select(
        "delivery_id",
        "order_id",
        *[F.to_timestamp(c).alias(c) for c in ("promised_by", "assigned_at", "picked_up_at")],
        F.to_timestamp("delivered_at").alias("delivered_at"),
        "cancelled_at",
        F.col("estimated_distance_km").cast("decimal(6,2)").alias("estimated_distance_km"),
        "status",
        F.to_timestamp("created_at").alias("created_at"),
        F.to_timestamp("updated_at").alias("updated_at"),
    )
    clean, quarantine = transforms.clean_deliveries(deliveries)
    assert clean.count() == 0
    assert "DQ-DEL-001" in quarantine.collect()[0]["_error_codes"]


def test_inventory_and_movement_rules(spark_session) -> None:
    inventory = spark_session.createDataFrame(
        [(10, 5, 3, 0, 2, "2026-09-22 00:00:00"), (10, 6, -1, 0, 2, "2026-09-22 00:00:00")],
        "store_id: bigint, product_id: bigint, on_hand_qty: int, reserved_qty: int, "
        "reorder_point: int, updated_at: string",
    ).withColumn("updated_at", F.to_timestamp("updated_at"))
    clean, quarantine = transforms.clean_inventory(inventory)
    assert [r["product_id"] for r in clean.collect()] == [5]
    assert "DQ-INV-001" in quarantine.collect()[0]["_error_codes"]

    movements = spark_session.createDataFrame(
        [(1, 10, 5, "SALE", -2, None, None, "2026-09-22 10:00:00", "2026-09-22 10:00:00"),
         (2, 10, 5, "SALE", 0, None, None, "2026-09-22 10:00:00", "2026-09-22 10:00:00")],
        "movement_id: bigint, store_id: bigint, product_id: bigint, movement_type: string, "
        "quantity_delta: int, reference_type: string, reference_id: string, "
        "occurred_at: string, created_at: string",
    ).select(
        "movement_id", "store_id", "product_id", "movement_type", "quantity_delta",
        "reference_type", "reference_id",
        F.to_timestamp("occurred_at").alias("occurred_at"),
        F.to_timestamp("created_at").alias("created_at"),
    )
    m_clean, m_quarantine = transforms.clean_inventory_movements(movements)
    assert [r["movement_id"] for r in m_clean.collect()] == [1]
    assert "DQ-MOV-001" in m_quarantine.collect()[0]["_error_codes"]
