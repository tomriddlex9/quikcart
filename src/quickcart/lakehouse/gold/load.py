"""Gold loader: Silver → Gold Delta marts (full recompute, idempotent)."""

from pathlib import Path

from pyspark.sql import SparkSession

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import table_location, table_path
from quickcart.lakehouse.gold.marts import MARTS


def _silver(spark: SparkSession, root: Path | None, table: str):
    if get_settings().storage_backend != "s3":
        path = table_path("silver", table, root)
        if not path.exists():
            raise FileNotFoundError(f"missing silver table {table}; run the silver step first")
    return spark.read.format("delta").load(table_location("silver", table, root))


def _silver_optional(spark: SparkSession, root: Path | None, table: str):
    if get_settings().storage_backend != "s3":
        path = table_path("silver", table, root)
        if not path.exists():
            return None
    return spark.read.format("delta").load(table_location("silver", table, root))


def run_gold(spark: SparkSession, root: Path | None = None) -> dict[str, int]:
    silver = {
        name: _silver(spark, root, name)
        for name in (
            "silver_orders",
            "silver_order_items",
            "silver_customers",
            "silver_products",
            "silver_payments",
            "silver_deliveries",
            "silver_riders",
            "silver_inventory",
            "silver_inventory_movements",
        )
    }

    hourly = MARTS["gold_store_hourly_metrics"](
        silver["silver_orders"],
        silver["silver_deliveries"],
        silver["silver_payments"],
        silver["silver_riders"],
    )
    outputs = {
        "gold_store_hourly_metrics": hourly,
        "gold_customer_360": MARTS["gold_customer_360"](
            silver["silver_orders"], silver["silver_order_items"], silver["silver_products"]
        ),
        "gold_inventory_health": MARTS["gold_inventory_health"](
            silver["silver_inventory"], silver["silver_inventory_movements"]
        ),
        "gold_delivery_performance": MARTS["gold_delivery_performance"](
            silver["silver_orders"],
            silver["silver_deliveries"],
            store_weather=_silver_optional(spark, root, "silver_store_weather"),
        ),
        "gold_product_performance": MARTS["gold_product_performance"](
            silver["silver_order_items"], silver["silver_products"], silver["silver_orders"]
        ),
        "gold_store_scorecard_daily": MARTS["gold_store_scorecard_daily"](hourly),
        "gold_margin_daily": MARTS["gold_margin_daily"](
            silver["silver_orders"], silver["silver_order_items"]
        ),
        "gold_category_daily": MARTS["gold_category_daily"](
            silver["silver_orders"], silver["silver_order_items"], silver["silver_products"]
        ),
        "gold_customer_health_daily": MARTS["gold_customer_health_daily"](
            silver["silver_orders"],
            _silver_optional(spark, root, "silver_order_ratings"),
        ),
        "gold_promo_daily": MARTS["gold_promo_daily"](silver["silver_orders"]),
    }

    wastage = _silver_optional(spark, root, "silver_wastage_events")
    if wastage is not None:
        outputs["gold_wastage_daily"] = MARTS["gold_wastage_daily"](wastage)
    else:
        outputs["gold_wastage_daily"] = spark.createDataFrame(
            [],
            "day: date, store_id: bigint, units: bigint, cost: decimal(18,2), events: int",
        )

    counts: dict[str, int] = {}
    for table, df in outputs.items():
        df.write.format("delta").mode("overwrite").save(table_location("gold", table, root))
        counts[table] = df.count()
    return counts
