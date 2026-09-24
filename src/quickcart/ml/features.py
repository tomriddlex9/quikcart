"""ML feature tables (kit/03 §11.2) built from Silver/Gold with Spark.

Leakage discipline (kit/02 MLR-003): every feature must be knowable at the
moment of prediction. For delivery-delay prediction that moment is order
placement — so realised timing facts (pick/ride/delivered minutes, is_late
itself, actual lateness) are EXCLUDED from features and used only as the
training target. Historical aggregates are strictly past-windowed
(day < placed date).
"""

from pathlib import Path

from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F

from quickcart.lakehouse.common.paths import table_path

FEATURE_COLUMNS_DELIVERY = [
    "order_id",
    "store_id",
    "placed_hour",
    "placed_dow",
    "is_weekend",
    "basket_units",
    "item_count",
    "subtotal",
    "delivery_fee",
    "promised_lead_minutes",
    "promo_applied",
    "payment_method",
    "distance_km",
    "store_orders_last_7d_avg",
    "store_late_rate_before",
    "riders_on_shift",
    "same_hour_orders",
]


def _silver(spark: SparkSession, root: Path | None, table: str) -> DataFrame:
    return spark.read.format("delta").load(str(table_path("silver", table, root)))


def build_delivery_features(spark: SparkSession, root: Path | None = None) -> DataFrame:
    """One row per delivered-or-cancelled delivery with placement-time features."""
    orders = _silver(spark, root, "silver_orders")
    items = _silver(spark, root, "silver_order_items")
    deliveries = _silver(spark, root, "silver_deliveries")
    payments = _silver(spark, root, "silver_payments")
    riders = _silver(spark, root, "silver_riders")

    basket = (
        items.groupBy("order_id")
        .agg(F.sum("quantity").alias("basket_units"), F.count("*").alias("item_count"))
    )
    pay = (
        payments.filter("status = 'CAPTURED'")
        .groupBy("order_id")
        .agg(F.max("payment_method").alias("payment_method"))
    )
    base = (
        orders.join(basket, "order_id", "left")
        .join(pay, "order_id", "left")
        .join(
            deliveries.select(
                "order_id",
                "rider_id",
                "promised_by",
                "delivered_at",
                "estimated_distance_km",
                F.col("status").alias("delivery_status"),
            ),
            "order_id",
            "left",
        )
        .filter(F.col("delivery_status").isin("DELIVERED", "CANCELLED"))
        .withColumn("placed_date", F.to_date("placed_at"))
        .withColumn("placed_hour", F.hour("placed_at"))
        .withColumn("placed_dow", F.dayofweek("placed_at"))
        .withColumn("is_weekend", F.dayofweek("placed_at").isin(1, 2))
        .withColumn("promo_applied", F.col("promotion_id").isNotNull())
        .withColumn(
            "promised_lead_minutes",
            F.round(
                (F.unix_timestamp("promised_by") - F.unix_timestamp("placed_at")) / 60.0, 1
            ),
        )
        .withColumn("distance_km", F.col("estimated_distance_km").cast("double"))
    )

    # Same-hour concurrent orders (queue proxy).
    orders_dated = orders.withColumn("placed_date", F.to_date("placed_at")).withColumn(
        "placed_hour", F.hour("placed_at")
    )
    hourly = (
        orders_dated.groupBy("store_id", "placed_date", "placed_hour")
        .agg(F.count("*").alias("same_hour_orders"))
    )
    # Trailing-7-day store order volume (strictly before the placed date).
    daily = (
        orders_dated.groupBy("store_id", "placed_date")
        .agg(F.count("*").alias("daily_orders"))
    )
    window_7d = (
        Window.partitionBy("store_id")
        .orderBy("placed_date")
        .rowsBetween(-7, -1)
    )
    volume = (
        daily.withColumn("store_orders_last_7d_avg", F.avg("daily_orders").over(window_7d))
        .select("store_id", "placed_date", "store_orders_last_7d_avg")
    )
    # Store late rate over strictly-prior days.
    late_daily = (
        deliveries.filter("status = 'DELIVERED'")
        .join(orders.select("order_id", "store_id", "placed_at"), "order_id")
        .withColumn("placed_date", F.to_date("placed_at"))
        .groupBy("store_id", "placed_date")
        .agg(
            F.avg(F.when(F.col("delivered_at") > F.col("promised_by"), 1.0).otherwise(0.0))
            .alias("late_rate")
        )
    )
    window_late = (
        Window.partitionBy("store_id")
        .orderBy("placed_date")
        .rowsBetween(Window.unboundedPreceding, -1)
    )
    late_hist = (
        late_daily.withColumn("store_late_rate_before", F.avg("late_rate").over(window_late))
        .select("store_id", "placed_date", "store_late_rate_before")
    )

    hours = spark.range(24).select(F.col("id").cast("int").alias("placed_hour"))
    riders_on_shift = (
        riders.select("home_store_id", "shift_start", "shift_end")
        .crossJoin(hours)
        .filter(
            F.concat(F.lpad(F.col("placed_hour").cast("string"), 2, "0"), F.lit(":00"))
            >= F.col("shift_start")
        )
        .filter(
            F.concat(F.lpad(F.col("placed_hour").cast("string"), 2, "0"), F.lit(":00"))
            < F.col("shift_end")
        )
        .groupBy("home_store_id", "placed_hour")
        .agg(F.count("*").alias("riders_on_shift"))
        .withColumnRenamed("home_store_id", "store_id")
    )

    features = (
        base.join(hourly, ["store_id", "placed_date", "placed_hour"], "left")
        .join(volume, ["store_id", "placed_date"], "left")
        .join(late_hist, ["store_id", "placed_date"], "left")
        .join(riders_on_shift, ["store_id", "placed_hour"], "left")
        .withColumn(
            "is_late",
            F.when(
                F.col("delivery_status") == "DELIVERED",
                (F.col("delivered_at") > F.col("promised_by")).cast("int"),
            ).otherwise(None),
        )
        .select(*FEATURE_COLUMNS_DELIVERY, "placed_at", "placed_date", "is_late")
    )
    return features.filter("is_late IS NOT NULL")


def build_demand_features(spark: SparkSession, root: Path | None = None) -> DataFrame:
    """Store x category x day demand with lags; target = next-day units."""
    orders = _silver(spark, root, "silver_orders")
    items = _silver(spark, root, "silver_order_items")
    products = _silver(spark, root, "silver_products")

    daily = (
        items.join(
            orders.select("order_id", "store_id", "status", "placed_at"), "order_id"
        )
        .filter("status != 'CANCELLED'")
        .join(products.select("product_id", "category"), "product_id")
        .withColumn("day", F.to_date("placed_at"))
        .groupBy("store_id", "category", "day")
        .agg(F.sum("quantity").alias("units"))
    )
    window_spec = Window.partitionBy("store_id", "category").orderBy("day")
    featured = (
        daily.withColumn("units_lag_1d", F.lag("units", 1).over(window_spec))
        .withColumn("units_lag_7d", F.lag("units", 7).over(window_spec))
        .withColumn(
            "units_ma_7d",
            F.avg("units").over(window_spec.rowsBetween(-7, -1)),
        )
        .withColumn("is_weekend", F.dayofweek("day").isin(1, 2))
        .withColumn("next_day_units", F.lead("units", 1).over(window_spec))
    )
    return featured.filter("next_day_units IS NOT NULL")


def build_anomaly_features(spark: SparkSession, root: Path | None = None) -> DataFrame:
    """Per store x day operational aggregates for anomaly detection."""
    hourly = (
        spark.read.format("delta")
        .load(str(table_path("gold", "gold_store_hourly_metrics", root)))
    )
    return (
        hourly.withColumn("day", F.to_date("metric_hour"))
        .groupBy("store_id", "day")
        .agg(
            F.sum("orders_placed").alias("orders"),
            F.sum("gmv").alias("gmv"),
            F.round(
                F.sum("orders_cancelled") / F.nullif(F.sum("orders_placed"), F.lit(0)), 4
            ).alias("cancel_rate"),
            F.round(F.avg("payment_failure_rate"), 4).alias("payment_failure_rate"),
            F.round(F.avg("avg_delivery_minutes"), 2).alias("avg_delivery_minutes"),
            F.round(F.avg("late_delivery_rate"), 4).alias("late_delivery_rate"),
        )
        .orderBy("store_id", "day")
    )
