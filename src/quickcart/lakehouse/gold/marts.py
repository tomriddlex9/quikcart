"""Gold marts (kit/03 §4.4, contracts in kit/04 §10).

Pure functions Silver→Gold. Grain and metric semantics follow
`docs/data_dictionary/metrics.md`; every derivation here has a matching SQL
exercise in `sql/exercises/` so the two paths can be cross-checked.

Notes:
- Hourly metrics are bucketed by the order's `placed_at` hour.
- `active_riders_estimate` approximates riders on shift from static shift
  windows (shifts never cross midnight in the simulator) — an estimate, not
  an attendance record.
- `weather_condition` in gold_delivery_performance is NULL: weather is a
  generation-time signal not yet persisted in the OLTP schema; Phase 9's
  weather ingestion fills it.
"""

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F


def _minutes(later: str, earlier: str):
    minute = F.lit(60.0)
    return F.round((F.unix_timestamp(later) - F.unix_timestamp(earlier)) / minute, 2)


def gold_store_hourly_metrics(
    orders: DataFrame, deliveries: DataFrame, payments: DataFrame, riders: DataFrame
) -> DataFrame:
    hourly_orders = orders.withColumn("metric_hour", F.date_trunc("hour", "placed_at"))

    order_agg = (
        hourly_orders.groupBy("metric_hour", "store_id")
        .agg(
            F.count("*").alias("orders_placed"),
            F.count(F.when(F.col("status") == "CANCELLED", 1)).alias("orders_cancelled"),
            F.sum(F.when(F.col("status") != "CANCELLED", F.col("total_amount"))).alias("gmv"),
            F.sum(F.when(F.col("status") == "REFUNDED", F.col("total_amount"))).alias("refunded"),
        )
        .withColumn(
            "net_revenue",
            F.coalesce(F.col("gmv"), F.lit(0)) - F.coalesce(F.col("refunded"), F.lit(0)),
        )
        .withColumn(
            "avg_order_value",
            F.round(
                F.col("gmv")
                / F.nullif(F.col("orders_placed") - F.col("orders_cancelled"), F.lit(0)),
                2,
            ),
        )
        .withColumn(
            "cancel_rate",
            F.round(F.col("orders_cancelled") / F.col("orders_placed"), 4),
        )
        .drop("refunded")
    )

    delivery_agg = (
        deliveries.join(hourly_orders.select("order_id", "metric_hour", "store_id"), "order_id")
        .filter(F.col("status") == "DELIVERED")
        .groupBy("metric_hour", "store_id")
        .agg(
            F.count("*").alias("orders_delivered"),
            F.avg(_minutes("picked_up_at", "assigned_at")).alias("avg_pick_minutes"),
            F.avg(_minutes("delivered_at", "picked_up_at")).alias("avg_delivery_minutes"),
            F.avg(F.when(F.col("delivered_at") > F.col("promised_by"), 1).otherwise(0)).alias(
                "late_delivery_rate"
            ),
        )
    )

    payment_agg = (
        payments.join(hourly_orders.select("order_id", "metric_hour", "store_id"), "order_id")
        .groupBy("metric_hour", "store_id")
        .agg(
            F.avg(F.when(F.col("status") == "FAILED", 1).otherwise(0)).alias(
                "payment_failure_rate"
            )
        )
    )

    # Riders whose static shift window covers the hour of day (estimate).
    hours = orders.sparkSession.range(24).select(F.col("id").cast("int").alias("hour_of_day"))
    hour_text = F.concat(F.lpad(F.col("hour_of_day").cast("string"), 2, "0"), F.lit(":00"))
    riders_on_shift = (
        riders.select("home_store_id", "shift_start", "shift_end")
        .crossJoin(hours)
        .filter(hour_text >= F.col("shift_start"))
        .filter(hour_text < F.col("shift_end"))
        .groupBy("home_store_id", "hour_of_day")
        .agg(F.count("*").alias("active_riders_estimate"))
        .withColumnRenamed("home_store_id", "store_id")
    )

    return (
        order_agg.join(delivery_agg, ["metric_hour", "store_id"], "left")
        .join(payment_agg, ["metric_hour", "store_id"], "left")
        .withColumn("hour_of_day", F.hour("metric_hour"))
        .join(riders_on_shift, ["store_id", "hour_of_day"], "left")
        .select(
            "metric_hour",
            "store_id",
            "orders_placed",
            F.coalesce(F.col("orders_delivered"), F.lit(0)).alias("orders_delivered"),
            "orders_cancelled",
            F.coalesce(F.col("gmv"), F.lit(0)).cast("decimal(18,2)").alias("gmv"),
            F.col("net_revenue").cast("decimal(18,2)").alias("net_revenue"),
            "avg_order_value",
            "cancel_rate",
            F.round("avg_pick_minutes", 2).alias("avg_pick_minutes"),
            F.round("avg_delivery_minutes", 2).alias("avg_delivery_minutes"),
            F.round("late_delivery_rate", 4).alias("late_delivery_rate"),
            "active_riders_estimate",
            F.round("payment_failure_rate", 4).alias("payment_failure_rate"),
        )
        .orderBy("store_id", "metric_hour")
    )


def gold_customer_360(orders: DataFrame, order_items: DataFrame, products: DataFrame) -> DataFrame:
    as_of = orders.agg(F.max("placed_at").alias("as_of")).first()["as_of"]

    base = (
        orders.groupBy("customer_id")
        .agg(
            F.min("placed_at").alias("first_order_at"),
            F.max("placed_at").alias("last_order_at"),
            F.count("*").alias("lifetime_orders"),
            F.sum(F.when(F.col("status") != "CANCELLED", F.col("total_amount"))).alias(
                "lifetime_spend"
            ),
            F.avg(F.when(F.col("status") != "CANCELLED", F.col("total_amount"))).alias(
                "avg_order_value"
            ),
            F.avg(F.when(F.col("status") == "CANCELLED", 1).otherwise(0)).alias("cancel_rate"),
            F.avg(F.when(F.col("promotion_id").isNotNull(), 1).otherwise(0)).alias(
                "promo_order_share"
            ),
        )
        .withColumn("days_since_last_order", F.datediff(F.lit(as_of), "last_order_at"))
    )

    store_window = Window.partitionBy("customer_id").orderBy(
        F.desc("store_orders"), F.asc("store_id")
    )
    preferred_store = (
        orders.groupBy("customer_id", "store_id")
        .agg(F.count("*").alias("store_orders"))
        .withColumn("_rn", F.row_number().over(store_window))
        .filter("_rn = 1")
        .select("customer_id", F.col("store_id").alias("preferred_store_id"))
    )

    category_window = Window.partitionBy("customer_id").orderBy(
        F.desc("category_items"), F.asc("category")
    )
    preferred_category = (
        order_items.join(orders.select("order_id", "customer_id", "status"), "order_id")
        .filter(F.col("status") != "CANCELLED")
        .join(products.select("product_id", "category"), "product_id")
        .groupBy("customer_id", "category")
        .agg(F.sum("quantity").alias("category_items"))
        .withColumn("_rn", F.row_number().over(category_window))
        .filter("_rn = 1")
        .select("customer_id", F.col("category").alias("preferred_category"))
    )

    return (
        base.join(preferred_store, "customer_id", "left")
        .join(preferred_category, "customer_id", "left")
        .select(
            "customer_id",
            "first_order_at",
            "last_order_at",
            "lifetime_orders",
            F.col("lifetime_spend").cast("decimal(18,2)").alias("lifetime_spend"),
            F.round("avg_order_value", 2).alias("avg_order_value"),
            F.round("cancel_rate", 4).alias("cancel_rate"),
            "days_since_last_order",
            "preferred_store_id",
            "preferred_category",
            F.round("promo_order_share", 4).alias("promo_order_share"),
        )
        .orderBy("customer_id")
    )


def gold_inventory_health(inventory: DataFrame, movements: DataFrame) -> DataFrame:
    snapshot_at = movements.agg(F.max("occurred_at").alias("snapshot_at")).first()["snapshot_at"]
    sales = movements.filter(F.col("movement_type") == "SALE").select(
        "store_id", "product_id", "quantity_delta", "occurred_at"
    )

    def windowed(hours: int):
        cutoff = F.lit(snapshot_at) - F.expr(f"INTERVAL {hours} HOURS")
        return sales.filter(F.col("occurred_at") > cutoff)

    w1 = (
        windowed(1)
        .groupBy("store_id", "product_id")
        .agg(F.sum(-F.col("quantity_delta")).alias("sales_last_1h"))
    )
    w24 = (
        windowed(24)
        .groupBy("store_id", "product_id")
        .agg(F.sum(-F.col("quantity_delta")).alias("sales_last_24h"))
    )
    w7d = (
        windowed(24 * 7)
        .groupBy("store_id", "product_id")
        .agg((F.sum(-F.col("quantity_delta")) / F.lit(168.0)).alias("avg_hourly_sales_7d"))
    )

    return (
        inventory.select("store_id", "product_id", "on_hand_qty", "reserved_qty", "reorder_point")
        .join(w1, ["store_id", "product_id"], "left")
        .join(w24, ["store_id", "product_id"], "left")
        .join(w7d, ["store_id", "product_id"], "left")
        .select(
            F.lit(snapshot_at).alias("snapshot_at"),
            "store_id",
            "product_id",
            "on_hand_qty",
            "reserved_qty",
            (F.col("on_hand_qty") - F.col("reserved_qty")).alias("available_qty"),
            F.coalesce(F.col("sales_last_1h"), F.lit(0)).alias("sales_last_1h"),
            F.coalesce(F.col("sales_last_24h"), F.lit(0)).alias("sales_last_24h"),
            F.round("avg_hourly_sales_7d", 4).alias("avg_hourly_sales_7d"),
            F.when(
                F.col("avg_hourly_sales_7d").isNull()
                | (F.col("avg_hourly_sales_7d") == 0),
                F.lit(None),
            )
            .otherwise(
                F.round(
                    (F.col("on_hand_qty") - F.col("reserved_qty"))
                    / F.col("avg_hourly_sales_7d"),
                    2,
                ),
            )
            .alias("stock_cover_hours"),
            "reorder_point",
            (F.col("on_hand_qty") <= F.col("reorder_point")).alias("is_below_reorder_point"),
        )
        .orderBy("store_id", "product_id")
    )


def gold_delivery_performance(orders: DataFrame, deliveries: DataFrame) -> DataFrame:
    return (
        deliveries.join(orders.select("order_id", "store_id", "placed_at"), "order_id")
        .select(
            "order_id",
            "delivery_id",
            "store_id",
            "rider_id",
            "placed_at",
            "assigned_at",
            "picked_up_at",
            "delivered_at",
            "promised_by",
            _minutes("picked_up_at", "assigned_at").alias("pick_minutes"),
            _minutes("delivered_at", "picked_up_at").alias("delivery_minutes"),
            _minutes("delivered_at", "placed_at").alias("total_fulfillment_minutes"),
            (F.col("delivered_at") > F.col("promised_by")).alias("is_late"),
            "estimated_distance_km",
            F.lit(None).cast("string").alias("weather_condition"),
        )
        .orderBy("order_id")
    )


def gold_product_performance(
    order_items: DataFrame, products: DataFrame, orders: DataFrame
) -> DataFrame:
    sold = (
        order_items.join(orders.select("order_id", "status", "store_id"), "order_id")
        .filter(F.col("status") != "CANCELLED")
    )
    per_product = (
        sold.groupBy("product_id")
        .agg(
            F.sum("quantity").alias("units_sold"),
            F.sum("line_total").alias("revenue"),
            F.countDistinct("order_id").alias("orders_with_product"),
            F.countDistinct("store_id").alias("stores_selling"),
        )
        .join(products.select("product_id", "sku", "name", "category"), "product_id")
        .withColumn(
            "revenue_share",
            F.round(F.col("revenue") / F.sum("revenue").over(Window.partitionBy()), 4),
        )
        .withColumn(
            "avg_unit_price",
            F.round(F.col("revenue") / F.col("units_sold"), 2),
        )
        .select(
            "product_id",
            "sku",
            "name",
            "category",
            "units_sold",
            F.col("revenue").cast("decimal(18,2)").alias("revenue"),
            "orders_with_product",
            "revenue_share",
            "avg_unit_price",
            "stores_selling",
        )
        .orderBy(F.desc("revenue"))
    )
    return per_product


MARTS = {
    "gold_store_hourly_metrics": gold_store_hourly_metrics,
    "gold_customer_360": gold_customer_360,
    "gold_inventory_health": gold_inventory_health,
    "gold_delivery_performance": gold_delivery_performance,
    "gold_product_performance": gold_product_performance,
}
