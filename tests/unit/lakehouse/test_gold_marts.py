"""Gold mart tests against hand-computed fixtures (kit/07 Phase 4:
"Gold metrics match independent expected values on fixture")."""

import pytest
from pyspark.sql import functions as F

from quickcart.lakehouse.gold import marts

pytestmark = pytest.mark.unit


def _orders(spark, rows):
    return spark.createDataFrame(
        rows,
        "order_id: bigint, customer_id: bigint, store_id: bigint, promotion_id: bigint, "
        "status: string, total_amount: string, placed_at: string",
    ).select(
        "order_id",
        "customer_id",
        "store_id",
        "promotion_id",
        "status",
        F.col("total_amount").cast("decimal(12,2)").alias("total_amount"),
        F.to_timestamp("placed_at").alias("placed_at"),
    )


def _deliveries(spark, rows):
    return spark.createDataFrame(
        rows,
        "delivery_id: bigint, order_id: bigint, rider_id: bigint, promised_by: string, "
        "assigned_at: string, picked_up_at: string, delivered_at: string, "
        "cancelled_at: string, estimated_distance_km: double, status: string",
    ).select(
        "delivery_id",
        "order_id",
        "rider_id",
        *[F.to_timestamp(c).alias(c) for c in ("promised_by", "assigned_at", "picked_up_at")],
        F.to_timestamp("delivered_at").alias("delivered_at"),
        F.to_timestamp("cancelled_at").alias("cancelled_at"),
        F.col("estimated_distance_km").cast("decimal(6,2)").alias("estimated_distance_km"),
        "status",
    )


def _payments(spark, rows):
    return spark.createDataFrame(
        rows,
        "payment_id: bigint, order_id: bigint, payment_method: string, status: string, "
        "amount: string, attempt_number: int, created_at: string",
    ).select(
        "payment_id",
        "order_id",
        "payment_method",
        "status",
        F.col("amount").cast("decimal(12,2)").alias("amount"),
        "attempt_number",
        F.to_timestamp("created_at").alias("created_at"),
    )


def _riders(spark):
    return spark.createDataFrame(
        [(1, 10, "AVAILABLE", "08:00", "16:00"), (2, 20, "AVAILABLE", "09:00", "17:00")],
        "rider_id: bigint, home_store_id: bigint, status: string, "
        "shift_start: string, shift_end: string",
    )


@pytest.fixture(scope="module")
def fixture_frames(spark_session):
    orders = _orders(
        spark_session,
        [
            (1, 100, 10, None, "DELIVERED", "100.00", "2026-03-01 10:15:00"),
            (2, 101, 10, None, "CANCELLED", "50.00", "2026-03-01 10:45:00"),
            (3, 102, 10, None, "DELIVERED", "200.00", "2026-03-01 11:05:00"),
            (4, 103, 20, 1, "DELIVERED", "300.00", "2026-03-01 10:20:00"),
        ],
    )
    deliveries = _deliveries(
        spark_session,
        [
            (1, 1, 7, "2026-03-01 11:00:00", "2026-03-01 10:20:00", "2026-03-01 10:30:00",
             "2026-03-01 10:50:00", None, 3.0, "DELIVERED"),
            (2, 3, 7, "2026-03-01 11:40:00", "2026-03-01 11:10:00", "2026-03-01 11:30:00",
             "2026-03-01 12:00:00", None, 4.0, "DELIVERED"),
            (3, 4, 9, "2026-03-01 11:00:00", "2026-03-01 10:30:00", "2026-03-01 10:40:00",
             "2026-03-01 10:55:00", None, 2.0, "DELIVERED"),
        ],
    )
    payments = _payments(
        spark_session,
        [
            (1, 1, "CARD", "FAILED", "100.00", 1, "2026-03-01 10:16:00"),
            (2, 1, "UPI", "CAPTURED", "100.00", 2, "2026-03-01 10:17:00"),
            (3, 4, "UPI", "CAPTURED", "300.00", 1, "2026-03-01 10:21:00"),
        ],
    )
    items = spark_session.createDataFrame(
        [
            (1, 1, 1, 2, "50.00"),   # order 1: 2x p1
            (2, 1, 2, 1, "50.00"),   # order 1: 1x p2
            (3, 3, 2, 3, "200.00"),  # order 3: 3x p2
        ],
        "order_item_id: bigint, order_id: bigint, product_id: bigint, "
        "quantity: int, line_total: string",
    ).withColumn("line_total", F.col("line_total").cast("decimal(12,2)"))
    products = spark_session.createDataFrame(
        [(1, "SKU-1", "Alpha", "Snacks"), (2, "SKU-2", "Beta", "Beverages")],
        "product_id: bigint, sku: string, name: string, category: string",
    )
    return {
        "orders": orders,
        "deliveries": deliveries,
        "payments": payments,
        "riders": _riders(spark_session),
        "items": items,
        "products": products,
    }


def test_store_hourly_metrics_match_hand_computed(fixture_frames) -> None:
    result = (
        marts.gold_store_hourly_metrics(
            fixture_frames["orders"],
            fixture_frames["deliveries"],
            fixture_frames["payments"],
            fixture_frames["riders"],
        )
        .withColumn("hour_of_day", F.hour("metric_hour"))
        .collect()
    )
    by_key = {(r["store_id"], r["hour_of_day"]): r for r in result}

    s10_h10 = by_key[(10, 10)]
    assert s10_h10["orders_placed"] == 2
    assert s10_h10["orders_cancelled"] == 1
    assert float(s10_h10["gmv"]) == 100.0
    assert float(s10_h10["avg_order_value"]) == 100.0
    assert float(s10_h10["cancel_rate"]) == 0.5
    assert s10_h10["orders_delivered"] == 1
    assert float(s10_h10["avg_pick_minutes"]) == 10.0
    assert float(s10_h10["avg_delivery_minutes"]) == 20.0
    assert float(s10_h10["late_delivery_rate"]) == 0.0
    assert s10_h10["active_riders_estimate"] == 1
    assert float(s10_h10["payment_failure_rate"]) == 0.5

    s10_h11 = by_key[(10, 11)]
    assert s10_h11["orders_placed"] == 1
    assert float(s10_h11["late_delivery_rate"]) == 1.0
    assert s10_h11["payment_failure_rate"] is None or s10_h11["orders_delivered"] == 1

    s20_h10 = by_key[(20, 10)]
    assert float(s20_h10["gmv"]) == 300.0
    assert float(s20_h10["payment_failure_rate"]) == 0.0
    assert s20_h10["active_riders_estimate"] == 1


def test_customer_360_match_hand_computed(fixture_frames) -> None:
    result = marts.gold_customer_360(
        fixture_frames["orders"], fixture_frames["items"], fixture_frames["products"]
    ).collect()
    by_customer = {r["customer_id"]: r for r in result}

    c1 = by_customer[100]
    assert c1["lifetime_orders"] == 1
    assert float(c1["lifetime_spend"]) == 100.0
    assert float(c1["cancel_rate"]) == 0.0
    assert c1["preferred_store_id"] == 10
    assert c1["preferred_category"] == "Snacks"
    assert c1["days_since_last_order"] == 0  # last order is the fixture's as_of day

    c2 = by_customer[102]
    assert c2["preferred_category"] == "Beverages"
    assert float(c2["promo_order_share"]) == 0.0


def test_delivery_performance_match_hand_computed(fixture_frames) -> None:
    result = marts.gold_delivery_performance(
        fixture_frames["orders"], fixture_frames["deliveries"]
    ).collect()
    by_order = {r["order_id"]: r for r in result}
    one = by_order[1]
    assert float(one["pick_minutes"]) == 10.0
    assert float(one["delivery_minutes"]) == 20.0
    assert float(one["total_fulfillment_minutes"]) == 35.0
    assert one["is_late"] is False
    assert one["weather_condition"] is None
    assert by_order[3]["is_late"] is True


def test_inventory_health_match_hand_computed(spark_session) -> None:
    snapshot = "2026-09-22 12:00:00"
    inventory = spark_session.createDataFrame(
        [(1, 100, 10, 2, 5, snapshot), (1, 200, 0, 0, 1, snapshot)],
        "store_id: bigint, product_id: bigint, on_hand_qty: int, reserved_qty: int, "
        "reorder_point: int, updated_at: string",
    ).withColumn("updated_at", F.to_timestamp("updated_at"))
    movements = spark_session.createDataFrame(
        [
            (1, 1, 100, "SALE", -4, None, None, "2026-09-22 11:30:00"),
            (2, 1, 100, "SALE", -10, None, None, "2026-09-22 09:00:00"),
            (3, 1, 100, "SALE", -20, None, None, "2026-09-20 12:00:00"),
        ],
        "movement_id: bigint, store_id: bigint, product_id: bigint, movement_type: string, "
        "quantity_delta: int, reference_type: string, reference_id: string, occurred_at: string",
    ).select(
        "movement_id", "store_id", "product_id", "movement_type", "quantity_delta",
        "reference_type", "reference_id", F.to_timestamp("occurred_at").alias("occurred_at"),
    )
    result = marts.gold_inventory_health(inventory, movements).collect()
    by_product = {r["product_id"]: r for r in result}

    p100 = by_product[100]
    assert p100["sales_last_1h"] == 4
    assert p100["sales_last_24h"] == 14
    expected_hourly = 34 / 168
    assert abs(p100["avg_hourly_sales_7d"] - expected_hourly) < 1e-4
    assert abs(p100["stock_cover_hours"] - 8 / expected_hourly) < 0.05
    assert p100["is_below_reorder_point"] is False

    p200 = by_product[200]
    assert p200["sales_last_24h"] == 0
    assert p200["stock_cover_hours"] is None
    assert p200["is_below_reorder_point"] is True


def test_product_performance_match_hand_computed(fixture_frames) -> None:
    result = marts.gold_product_performance(
        fixture_frames["items"], fixture_frames["products"], fixture_frames["orders"]
    ).collect()
    by_product = {r["product_id"]: r for r in result}

    # Fixture items: order 1 = 2x p1 @ 50.00 total + 1x p2 @ 50.00;
    # order 3 = 3x p2 @ 200.00. Non-cancelled revenue total = 300.00.
    p1 = by_product[1]
    assert p1["units_sold"] == 2
    assert float(p1["revenue"]) == 50.0
    assert p1["orders_with_product"] == 1
    assert float(p1["avg_unit_price"]) == 25.0

    p2 = by_product[2]
    assert p2["units_sold"] == 4
    assert float(p2["revenue"]) == 250.0
    assert p2["orders_with_product"] == 2
    assert abs(float(p2["revenue_share"]) - 250 / 300) < 0.001
    assert float(p2["avg_unit_price"]) == 62.5
