"""Phase 3 demo: read the exported raw files with Spark, run the learning
jobs, capture execution plans, and write Parquet outputs locally.

Run after exporting:  ``make export-raw && uv run python -m quickcart.lakehouse.learning.demo``
Artifacts: Parquet outputs + captured plans under ``data/artifacts/phase3/``.
"""

import structlog

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import latest_raw_partition
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.learning import jobs, schemas

log = structlog.get_logger(__name__)


def main() -> int:
    settings = get_settings()
    raw = settings.data_root
    out = raw / "artifacts" / "phase3"
    out.mkdir(parents=True, exist_ok=True)

    spark = build_spark("quickcart-phase3-learning")
    log.info("spark.started", version=spark.version)

    orders = (
        spark.read.schema(schemas.ORDERS_SCHEMA)
        .option("header", True)
        .option("timestampFormat", "yyyy-MM-dd HH:mm:ss")
        .csv(str(latest_raw_partition(raw, "orders")))
    )
    deliveries = (
        spark.read.schema(schemas.DELIVERIES_SCHEMA)
        .option("header", True)
        .option("timestampFormat", "yyyy-MM-dd HH:mm:ss")
        .csv(str(latest_raw_partition(raw, "deliveries")))
    )
    order_items = (
        spark.read.schema(schemas.ORDER_ITEMS_SCHEMA)
        .option("header", True)
        .option("timestampFormat", "yyyy-MM-dd HH:mm:ss")
        .csv(str(latest_raw_partition(raw, "order_items")))
    )
    products = (
        spark.read.schema(schemas.PRODUCTS_SCHEMA)
        .option("header", True)
        .option("timestampFormat", "yyyy-MM-dd HH:mm:ss")
        .csv(str(latest_raw_partition(raw, "products")))
    )
    events = spark.read.schema(schemas.ORDER_EVENTS_SCHEMA).json(
        str(latest_raw_partition(raw, "order_events"))
    )

    log.info("raw.loaded", orders=orders.count(), events=events.count())

    revenue = jobs.revenue_by_store(orders)
    daily = jobs.orders_by_day(orders)
    metrics = jobs.with_delivery_metrics(orders, deliveries)
    top_products = jobs.top_products_by_revenue(order_items, products)
    shares = jobs.category_revenue_share(order_items, products)
    percentile = jobs.store_gmv_percentile(revenue)

    revenue.write.mode("overwrite").parquet(str(out / "revenue_by_store"))
    metrics.write.mode("overwrite").parquet(str(out / "delivery_metrics"))
    top_products.write.mode("overwrite").parquet(str(out / "top_products"))
    daily.write.mode("overwrite").parquet(str(out / "orders_by_day"))

    late_rate = metrics.filter("is_late").count() / max(metrics.count(), 1)
    log.info("derived.late_rate", value=round(late_rate, 4))

    plans = {
        "revenue_by_store": jobs.explain_text(revenue),
        "with_delivery_metrics": jobs.explain_text(metrics),
        "category_revenue_share": jobs.explain_text(shares),
        "store_gmv_percentile": jobs.explain_text(percentile),
        "order_events_scan": jobs.explain_text(events),
    }
    (out / "plans.txt").write_text(
        "\n\n".join(f"=== {name} ===\n{plan}" for name, plan in plans.items()),
        encoding="utf-8",
    )
    log.info("plans.captured", path=str(out / "plans.txt"))

    spark.stop()
    log.info("demo.complete", outputs=str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
