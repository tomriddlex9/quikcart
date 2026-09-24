"""Bronze loaders (kit/03 §4.2).

Bronze preserves the source payload untouched and stamps every row with
ingestion metadata (`kit/04 §8`: `_ingested_at`, `_source_system`,
`_source_file`, `_schema_version`, `_ingestion_date`).

Replay/idempotency contract: raw exports under `data/raw/<entity>/load_date=*`
are the immutable, replayable source of truth. Bronze tables are full
snapshots rebuilt from the latest partition with `mode("overwrite")` —
rerunning Bronze never duplicates rows, and any Bronze table can be rebuilt
from the raw files alone.
"""

from datetime import date
from pathlib import Path

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from quickcart.lakehouse.common import schemas
from quickcart.lakehouse.common.paths import latest_raw_partition, table_location

SOURCE_SCHEMAS = {
    "bronze_stores": schemas.STORES_SCHEMA,
    "bronze_orders": schemas.ORDERS_SCHEMA,
    "bronze_order_items": schemas.ORDER_ITEMS_SCHEMA,
    "bronze_customers": schemas.CUSTOMERS_SCHEMA,
    "bronze_products": schemas.PRODUCTS_SCHEMA,
    "bronze_payments": schemas.PAYMENTS_SCHEMA,
    "bronze_deliveries": schemas.DELIVERIES_SCHEMA,
    "bronze_riders": schemas.RIDERS_SCHEMA,
    "bronze_inventory": schemas.INVENTORY_SCHEMA,
    "bronze_inventory_movements": schemas.INVENTORY_MOVEMENTS_SCHEMA,
}

# raw export directory per bronze table
RAW_ENTITY = {
    "bronze_stores": "stores",
    "bronze_orders": "orders",
    "bronze_order_items": "order_items",
    "bronze_customers": "customers",
    "bronze_products": "products",
    "bronze_payments": "payments",
    "bronze_deliveries": "deliveries",
    "bronze_riders": "riders",
    "bronze_inventory": "inventory",
    "bronze_inventory_movements": "inventory_movements",
}

TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss"


def read_bronze_source(
    spark: SparkSession,
    root: Path | None,
    table: str,
    *,
    source_system: str = "postgres-export",
    ingestion_date: date | None = None,
) -> DataFrame:
    """Read the latest raw partition with its explicit schema + metadata."""
    if table not in SOURCE_SCHEMAS:
        raise KeyError(f"unknown bronze table {table!r}")
    partition = latest_raw_partition(root, RAW_ENTITY[table])
    base = (
        spark.read.schema(SOURCE_SCHEMAS[table])
        .option("header", True)
        .option("timestampFormat", TIMESTAMP_FORMAT)
        .csv(str(partition))
    )
    return base.select(
        "*",
        F.current_timestamp().alias("_ingested_at"),
        F.lit(source_system).alias("_source_system"),
        F.lit(str(partition / f"{RAW_ENTITY[table]}.csv")).alias("_source_file"),
        F.lit(1).alias("_schema_version"),
        F.lit((ingestion_date or date.today()).isoformat()).alias("_ingestion_date"),
    )

def write_bronze(df: DataFrame, root: Path | None, table: str) -> str:
    """Overwrite (full snapshot) the bronze Delta table. Returns its location."""
    location = table_location("bronze", table, root)
    df.write.format("delta").mode("overwrite").save(location)
    return location


def load_bronze_table(
    spark: SparkSession,
    root: Path | None,
    table: str,
    *,
    ingestion_date: date | None = None,
) -> int:
    df = read_bronze_source(spark, root, table, ingestion_date=ingestion_date)
    write_bronze(df, root, table)
    return df.count()


def run_bronze(spark: SparkSession, root: Path | None = None) -> dict[str, int]:
    counts = {}
    for table in SOURCE_SCHEMAS:
        counts[table] = load_bronze_table(spark, root, table)
    return counts
