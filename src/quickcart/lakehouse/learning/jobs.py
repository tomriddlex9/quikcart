"""Phase 3 learning jobs: reusable transform functions on raw sources.

Every function is a pure DataFrame→DataFrame transformation (kit/05 §4.3) so
unit tests can drive them with tiny in-memory DataFrames — no files, no
cluster. The demo module (`quickcart.lakehouse.learning.demo`) wires them to
the exported raw files and captures execution plans.
"""

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F


def revenue_by_store(orders: DataFrame) -> DataFrame:
    """GMV per store over non-cancelled orders."""
    return (
        orders.filter(F.col("status") != "CANCELLED")
        .groupBy("store_id")
        .agg(
            F.count("*").alias("orders"),
            F.sum("total_amount").cast("decimal(16,2)").alias("gmv"),
        )
        .orderBy(F.desc("gmv"))
    )


def orders_by_day(orders: DataFrame) -> DataFrame:
    """Daily order volume (UTC days)."""
    return (
        orders.groupBy(F.to_date("placed_at").alias("day"))
        .agg(F.count("*").alias("orders"))
        .orderBy("day")
    )


def with_delivery_metrics(orders: DataFrame, deliveries: DataFrame) -> DataFrame:
    """Join orders to deliveries and derive fulfillment timing facts.

    Adds wait_minutes, pick_minutes, ride_minutes, fulfillment_minutes and
    is_late (delivered_at > promised_by) — the same derivations the SQL
    exercises do, now in DataFrame API form.
    """
    joined = orders.select("order_id", "store_id", "status", "placed_at", "total_amount").join(
        deliveries.select(
            "order_id",
            "rider_id",
            "promised_by",
            "assigned_at",
            "picked_up_at",
            "delivered_at",
            F.col("status").alias("delivery_status"),
        ),
        "order_id",
        "inner",
    )
    minute = F.lit(60.0)
    return (
        joined.filter(F.col("delivery_status") == "DELIVERED")
        .withColumn(
            "wait_minutes",
            F.round((F.unix_timestamp("assigned_at") - F.unix_timestamp("placed_at")) / minute, 2),
        )
        .withColumn(
            "pick_minutes",
            F.round(
                (F.unix_timestamp("picked_up_at") - F.unix_timestamp("assigned_at")) / minute, 2
            ),
        )
        .withColumn(
            "ride_minutes",
            F.round(
                (F.unix_timestamp("delivered_at") - F.unix_timestamp("picked_up_at")) / minute, 2
            ),
        )
        .withColumn(
            "fulfillment_minutes",
            F.round(
                (F.unix_timestamp("delivered_at") - F.unix_timestamp("placed_at")) / minute, 2
            ),
        )
        .withColumn("is_late", F.col("delivered_at") > F.col("promised_by"))
    )


def top_products_by_revenue(order_items: DataFrame, products: DataFrame, n: int = 10) -> DataFrame:
    """Top-N products by line revenue (exercise 03 in Spark)."""
    return (
        order_items.groupBy("product_id")
        .agg(
            F.sum("quantity").alias("units_sold"),
            F.sum("line_total").cast("decimal(16,2)").alias("revenue"),
        )
        .join(products.select("product_id", "sku", "name", "category"), "product_id")
        .orderBy(F.desc("revenue"), F.desc("units_sold"))
        .limit(n)
    )


def category_revenue_share(order_items: DataFrame, products: DataFrame) -> DataFrame:
    """Category revenue with a windowed share-of-total column."""
    per_category = (
        order_items.join(products.select("product_id", "category"), "product_id")
        .groupBy("category")
        .agg(F.sum("line_total").cast("decimal(16,2)").alias("revenue"))
    )
    windowed = per_category.withColumn(
        "revenue_share",
        F.round(F.col("revenue") / F.sum("revenue").over(Window.partitionBy()), 4),
    )
    return windowed.orderBy(F.desc("revenue"))


def store_gmv_percentile(revenue: DataFrame) -> DataFrame:
    """Percent-rank stores by GMV (exercise 06 in Spark)."""
    return revenue.withColumn(
        "gmv_percentile", F.round(F.percent_rank().over(Window.orderBy(F.col("gmv"))), 4)
    ).orderBy(F.desc("gmv"))


def explain_text(df: DataFrame) -> str:
    """Captured physical plan string (df.explain() only prints)."""
    return df._jdf.queryExecution().executedPlan().toString()
