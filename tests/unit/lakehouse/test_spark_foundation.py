"""Phase 3 Spark foundation tests (kit/07 Phase 3 acceptance gates).

Tiny in-memory DataFrames only — no files, no services (kit/07 §5).
"""

import pytest
from pyspark.sql import functions as F

from quickcart.lakehouse.learning import jobs, schemas

pytestmark = pytest.mark.unit

TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss"


def _orders_df(spark):
    return spark.createDataFrame(
        [
            (1, 10, 100, "DELIVERED", "500.00", "2026-03-01 12:00:00"),
            (2, 10, 101, "CANCELLED", "300.00", "2026-03-01 13:00:00"),
            (3, 20, 100, "DELIVERED", "700.00", "2026-03-02 12:00:00"),
        ],
        "order_id: bigint, store_id: bigint, customer_id: bigint, status: string, "
        "total_amount: string, placed_at: string",
    ).withColumn("placed_at", F.to_timestamp("placed_at"))


def _deliveries_df(spark):
    rows = [
        (1, 1, 7, "2026-03-01 12:40:00", "2026-03-01 12:05:00", "2026-03-01 12:15:00",
         "2026-03-01 12:30:00", "DELIVERED"),
        (3, 3, 9, "2026-03-02 12:35:00", "2026-03-02 12:20:00", "2026-03-02 12:50:00",
         "2026-03-02 13:10:00", "DELIVERED"),
    ]
    df = spark.createDataFrame(
        rows,
        "delivery_id: bigint, order_id: bigint, rider_id: bigint, promised_by: string, "
        "assigned_at: string, picked_up_at: string, delivered_at: string, status: string",
    )
    for column in ("promised_by", "assigned_at", "picked_up_at", "delivered_at"):
        df = df.withColumn(column, F.to_timestamp(column))
    return df


def test_csv_reads_with_explicit_schema(spark_session, tmp_path) -> None:
    csv_path = tmp_path / "orders.csv"
    csv_path.write_text(
        "order_id,customer_id,store_id,address_id,promotion_id,status,subtotal,"
        "item_discount,promo_discount,delivery_fee,tax_amount,total_amount,currency,"
        "placed_at,updated_at\n"
        "1,100,10,,,DELIVERED,500.00,0.00,0.00,30.00,26.50,556.50,INR,"
        "2026-03-01 12:00:00,2026-03-01 12:30:00\n",
        encoding="utf-8",
    )
    df = (
        spark_session.read.schema(schemas.ORDERS_SCHEMA)
        .option("header", True)
        .option("timestampFormat", TIMESTAMP_FORMAT)
        .csv(str(csv_path))
    )
    row = df.collect()[0]
    assert df.schema["total_amount"].dataType.typeName() == "decimal"
    assert str(row["total_amount"]) == "556.50"
    assert row["placed_at"].year == 2026


def test_json_nested_payload_parses(spark_session, tmp_path) -> None:
    jsonl_path = tmp_path / "events.jsonl"
    jsonl_path.write_text(
        '{"event_id":"e1","event_type":"ORDER_PLACED","schema_version":1,'
        '"event_time":"2026-03-01T12:00:00Z","producer":"quickcart-simulator",'
        '"entity_type":"order","entity_id":"1","store_id":10,'
        '"payload":{"order_id":1,"total_amount":"556.50","currency":"INR"}}\n',
        encoding="utf-8",
    )
    df = spark_session.read.schema(schemas.ORDER_EVENTS_SCHEMA).json(str(jsonl_path))
    row = df.collect()[0]
    assert row["payload"]["order_id"] == 1
    assert str(row["payload"]["total_amount"]) == "556.50"
    assert row["event_time"].year == 2026


def test_revenue_by_store_excludes_cancelled(spark_session) -> None:
    result = jobs.revenue_by_store(_orders_df(spark_session)).collect()
    by_store = {row["store_id"]: (row["orders"], float(row["gmv"])) for row in result}
    assert by_store[10] == (1, 500.00)
    assert by_store[20] == (1, 700.00)


def test_delivery_metrics_derive_timing_and_lateness(spark_session) -> None:
    metrics = jobs.with_delivery_metrics(_orders_df(spark_session), _deliveries_df(spark_session))
    by_order = {row["order_id"]: row for row in metrics.collect()}
    assert by_order[1]["is_late"] is False
    assert by_order[1]["ride_minutes"] == 15.0
    assert by_order[3]["is_late"] is True
    assert by_order[3]["fulfillment_minutes"] == 70.0


def test_category_revenue_share_sums_to_one(spark_session) -> None:
    items = spark_session.createDataFrame(
        [(1, 1, 2, "100.00"), (2, 1, 1, "50.00"), (3, 2, 3, "150.00")],
        "order_item_id: bigint, order_id: bigint, product_id: bigint, line_total: string",
    )
    products = spark_session.createDataFrame(
        [(1, "Snacks"), (2, "Snacks"), (3, "Beverages")],
        "product_id: bigint, category: string",
    )
    shares = jobs.category_revenue_share(items, products).collect()
    total = sum(float(row["revenue_share"]) for row in shares)
    assert abs(total - 1.0) < 0.001
    assert {row["category"] for row in shares} == {"Snacks", "Beverages"}


def test_window_percentile_ranks_stores(spark_session) -> None:
    revenue = spark_session.createDataFrame(
        [(10, 1, "900.00"), (20, 1, "100.00")],
        "store_id: bigint, orders: bigint, gmv: string",
    )
    ranked = jobs.store_gmv_percentile(revenue).collect()
    assert ranked[0]["store_id"] == 10  # higher GMV first
    assert {row["gmv_percentile"] for row in ranked} == {0.0, 1.0}


def test_groupby_plan_shows_shuffle_exchange(spark_session) -> None:
    df = _orders_df(spark_session).groupBy("store_id").agg(F.count("*").alias("n"))
    plan = jobs.explain_text(df)
    assert "Exchange" in plan  # shuffle boundary
    assert "HashAggregate" in plan


def test_actions_trigger_execution(spark_session) -> None:
    # Lazy evaluation: defining a plan does not execute; an action does.
    df = _orders_df(spark_session).filter("status = 'DELIVERED'")
    assert df.count() == 2
