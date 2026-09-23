"""Gold loader: Silver → Gold Delta marts (full recompute, idempotent)."""

from pathlib import Path

from pyspark.sql import SparkSession

from quickcart.lakehouse.common.paths import table_path
from quickcart.lakehouse.gold.marts import MARTS


def _silver(spark: SparkSession, root: Path | None, table: str):
    path = table_path("silver", table, root)
    if not path.exists():
        raise FileNotFoundError(f"missing silver table {table}; run the silver step first")
    return spark.read.format("delta").load(str(path))


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

    outputs = {
        "gold_store_hourly_metrics": MARTS["gold_store_hourly_metrics"](
            silver["silver_orders"],
            silver["silver_deliveries"],
            silver["silver_payments"],
            silver["silver_riders"],
        ),
        "gold_customer_360": MARTS["gold_customer_360"](
            silver["silver_orders"], silver["silver_order_items"], silver["silver_products"]
        ),
        "gold_inventory_health": MARTS["gold_inventory_health"](
            silver["silver_inventory"], silver["silver_inventory_movements"]
        ),
        "gold_delivery_performance": MARTS["gold_delivery_performance"](
            silver["silver_orders"], silver["silver_deliveries"]
        ),
        "gold_product_performance": MARTS["gold_product_performance"](
            silver["silver_order_items"], silver["silver_products"], silver["silver_orders"]
        ),
    }

    counts: dict[str, int] = {}
    for table, df in outputs.items():
        df.write.format("delta").mode("overwrite").save(str(table_path("gold", table, root)))
        counts[table] = df.count()
    return counts
