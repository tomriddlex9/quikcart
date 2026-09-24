"""Gold data-access layer (kit/03 Phase 10 architecture rule).

Dashboard (Phase 10) and FastAPI (Phase 14) both read Gold through these
readers — UI/API code never touches Spark session construction or paths
directly. KPIs are computed from Gold only, matching
`docs/data_dictionary/metrics.md`.
"""

from pathlib import Path

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from quickcart.lakehouse.common.paths import table_location, table_path


class GoldReaders:
    """Read-only accessors over the Gold layer."""

    def __init__(self, spark: SparkSession, root: Path | None = None) -> None:
        self.spark = spark
        self.root = root

    def _gold(self, table: str) -> DataFrame:
        return self.spark.read.format("delta").load(table_location("gold", table, self.root))

    # --- overview -------------------------------------------------------------
    def kpi_summary(self) -> dict:
        """Headline KPIs from Gold (dashboard Overview page)."""
        hourly = self._gold("gold_store_hourly_metrics")
        orders = self._gold("gold_customer_360")
        inventory = self._gold("gold_inventory_health")
        delivery = self._gold("gold_delivery_performance")

        gmv = hourly.agg(F.sum("gmv")).first()[0]
        cancelled = hourly.agg(F.sum("orders_cancelled")).first()[0]
        placed = hourly.agg(F.sum("orders_placed")).first()[0]
        late = delivery.filter("is_late").count()
        delivered = delivery.filter("delivered_at IS NOT NULL").count()
        at_risk = inventory.filter("is_below_reorder_point").count()
        active_customers = orders.count()
        return {
            "gmv": float(gmv or 0),
            "orders_placed": int(placed or 0),
            "cancellation_rate": float(cancelled or 0) / max(placed or 0, 1),
            "late_delivery_rate": late / max(delivered, 1),
            "products_below_reorder": int(at_risk),
            "active_customers": int(active_customers),
        }

    def orders_trend(self) -> DataFrame:
        return (
            self._gold("gold_store_hourly_metrics")
            .groupBy(F.to_date("metric_hour").alias("day"))
            .agg(
                F.sum("orders_placed").alias("orders"),
                F.sum("gmv").alias("gmv"),
                F.sum("orders_cancelled").alias("cancelled"),
            )
            .orderBy("day")
        )

    # --- stores ---------------------------------------------------------------
    def store_comparison(self) -> DataFrame:
        hourly = self._gold("gold_store_hourly_metrics")
        return (
            hourly.groupBy("store_id")
            .agg(
                F.sum("orders_placed").alias("orders"),
                F.sum("gmv").alias("gmv"),
                F.round(F.sum("orders_cancelled") / F.sum("orders_placed"), 4).alias(
                    "cancel_rate"
                ),
                F.round(F.avg("late_delivery_rate"), 4).alias("late_rate"),
            )
            .orderBy(F.desc("gmv"))
        )

    def store_hourly(self, store_id: int) -> DataFrame:
        return (
            self._gold("gold_store_hourly_metrics")
            .filter(F.col("store_id") == store_id)
            .orderBy("metric_hour")
        )

    def stores(self) -> DataFrame:
        path = table_path("silver", "silver_stores", self.root)
        return self.spark.read.format("delta").load(str(path))

    # --- inventory ------------------------------------------------------------
    def inventory_risk(self, limit: int = 50) -> DataFrame:
        health = self._gold("gold_inventory_health")
        products = self.spark.read.format("delta").load(
            str(table_path("silver", "silver_products", self.root))
        )
        return (
            health.filter("is_below_reorder_point")
            .join(products.select("product_id", "sku", "name", "category"), "product_id")
            .select(
                "store_id",
                "sku",
                "name",
                "category",
                "on_hand_qty",
                "reorder_point",
                "avg_hourly_sales_7d",
                "stock_cover_hours",
                "is_below_reorder_point",
            )
            .orderBy(F.asc_nulls_first("stock_cover_hours"))
            .limit(limit)
        )

    # --- delivery -------------------------------------------------------------
    def delivery_performance(self, store_id: int | None = None) -> DataFrame:
        df = self._gold("gold_delivery_performance")
        if store_id is not None:
            df = df.filter(F.col("store_id") == store_id)
        return df

    # --- customers / products ---------------------------------------------------
    def top_customers(self, limit: int = 20) -> DataFrame:
        return (
            self.spark.read.format("delta")
            .load(table_location("gold", "gold_customer_360", self.root))
            .orderBy(F.desc("lifetime_spend"))
            .limit(limit)
        )

    def product_performance(self, limit: int = 50) -> DataFrame:
        return self._gold("gold_product_performance").limit(limit)

    # --- pipeline ---------------------------------------------------------------
    def quality_summary(self) -> DataFrame:
        return self.spark.read.format("delta").load(
            str(table_path("quarantine", "quality_summary", self.root))
        )
