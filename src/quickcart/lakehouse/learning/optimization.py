"""Spark optimization experiments (kit/03 §5.6, kit/07 Phase 5).

Five before/after demonstrations, each capturing PLAN evidence plus honest
local wall-clock timings (median of repeated runs). No invented speedups —
numbers are written to data/artifacts/phase5/optimization_results.json and
interpreted in docs/learning/spark-optimization.md.

Run: ``uv run python -m quickcart.lakehouse.learning.optimization``
"""

import json
import statistics
import time
from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import latest_raw_partition
from quickcart.lakehouse.common.schemas import (
    ORDER_ITEMS_SCHEMA,
    ORDERS_SCHEMA,
    PRODUCTS_SCHEMA,
)
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.learning.jobs import explain_text

TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss"
RUNS = 3
ARTIFACTS = Path("data/artifacts/phase5")


def _timed(df, runs: int = RUNS) -> float:
    """Median wall time (ms) of materialising a DataFrame."""
    samples = []
    for _ in range(runs):
        start = time.perf_counter()
        df.count()
        samples.append((time.perf_counter() - start) * 1000)
    return round(statistics.median(samples), 1)


def _read_csv(spark: SparkSession, root: Path, entity: str, schema):
    return (
        spark.read.schema(schema)
        .option("header", True)
        .option("timestampFormat", TIMESTAMP_FORMAT)
        .csv(str(latest_raw_partition(root, entity)))
    )


def experiment_partition_pruning(spark: SparkSession, root: Path) -> dict:
    """Same day-filtered count: flat layout vs date-partitioned layout."""
    orders = _read_csv(spark, root, "orders", ORDERS_SCHEMA).withColumn(
        "placed_date", F.to_date("placed_at")
    )
    flat = ARTIFACTS / "pruning_flat"
    partitioned = ARTIFACTS / "pruning_partitioned"
    orders.drop("placed_date").write.mode("overwrite").parquet(str(flat))
    orders.write.mode("overwrite").partitionBy("placed_date").parquet(str(partitioned))

    day = orders.select(F.max("placed_at")).first()[0].date().isoformat()
    flat_df = spark.read.parquet(str(flat)).filter(f"to_date(placed_at) = '{day}'")
    part_df = spark.read.parquet(str(partitioned)).filter(f"placed_date = '{day}'")
    return {
        "experiment": "partition_pruning",
        "day": day,
        "flat_ms": _timed(flat_df),
        "partitioned_ms": _timed(part_df),
        # Non-empty PartitionFilters: [] means the layout actually prunes files.
        "flat_plan_partition_filters": "PartitionFilters: []" not in explain_text(flat_df),
        "partitioned_plan_partition_filters": "PartitionFilters: []" not in explain_text(part_df),
    }


def experiment_broadcast_join(spark: SparkSession, root: Path) -> dict:
    """Orders items x products with auto-broadcast disabled vs explicit broadcast."""
    spark.conf.set("spark.sql.autoBroadcastJoinThreshold", -1)
    try:
        products = _read_csv(spark, root, "products", PRODUCTS_SCHEMA).select(
            "product_id", "category"
        )
        items = _read_csv(spark, root, "order_items", ORDER_ITEMS_SCHEMA)
        smj = items.join(products, "product_id").groupBy("category").count()
        bmj = items.join(F.broadcast(products), "product_id").groupBy("category").count()
        return {
            "experiment": "broadcast_join",
            "sort_merge_ms": _timed(smj),
            "broadcast_ms": _timed(bmj),
            "sort_merge_plan": "SortMergeJoin" in explain_text(smj),
            "broadcast_plan": "BroadcastHashJoin" in explain_text(bmj),
        }
    finally:
        spark.conf.unset("spark.sql.autoBroadcastJoinThreshold")


def experiment_shuffle_partitions(spark: SparkSession, root: Path) -> dict:
    """Default 200 shuffle partitions vs right-sized 8 on ~98k rows."""
    orders = _read_csv(spark, root, "orders", ORDERS_SCHEMA)
    grouped = orders.groupBy("store_id").count()
    spark.conf.set("spark.sql.shuffle.partitions", 200)
    slow_ms = _timed(grouped)
    spark.conf.set("spark.sql.shuffle.partitions", 8)
    fast_ms = _timed(grouped)
    spark.conf.unset("spark.sql.shuffle.partitions")
    plan = explain_text(grouped)
    return {
        "experiment": "shuffle_partitions",
        "partitions_200_ms": slow_ms,
        "partitions_8_ms": fast_ms,
        "plan_has_exchange": "Exchange hashpartitioning" in plan,
    }


def experiment_skew(spark: SparkSession, root: Path) -> dict:
    """One store holding 80% of orders: plain groupBy vs salted aggregation."""
    orders = _read_csv(spark, root, "orders", ORDERS_SCHEMA).select("order_id", "store_id")
    hot = orders.first()["store_id"]
    skewed = orders.withColumn(
        "store_id_skewed",
        F.when(F.col("order_id") % 100 < 80, F.lit(hot)).otherwise(F.col("store_id")),
    )
    plain = skewed.groupBy("store_id_skewed").agg(F.count("*").alias("n"))
    salted = (
        skewed.withColumn(
            "_salt",
            F.when(F.col("store_id_skewed") == hot, F.col("order_id") % 10).otherwise(0),
        )
        .groupBy("store_id_skewed", "_salt")
        .agg(F.count("*").alias("n"))
        .groupBy("store_id_skewed")
        .agg(F.sum("n").alias("n"))
    )
    plain_rows = sorted((r[0], r[1]) for r in plain.collect())
    salted_rows = sorted((r[0], r[1]) for r in salted.collect())
    return {
        "experiment": "skew",
        "hot_store": hot,
        "plain_ms": _timed(plain),
        "salted_ms": _timed(salted),
        "same_result": plain_rows == salted_rows,
    }


def experiment_small_files(spark: SparkSession, root: Path) -> dict:
    """200 tiny files vs compacted 4-file read, plus Delta OPTIMIZE."""
    from delta import DeltaTable

    orders = _read_csv(spark, root, "orders", ORDERS_SCHEMA).withColumn(
        "_bucket", F.col("order_id") % 200
    )
    many = ARTIFACTS / "smallfiles_many"
    orders.repartition(200, "_bucket").write.mode("overwrite").parquet(str(many))
    many_files = len(list(many.rglob("*.parquet")))

    few = ARTIFACTS / "smallfiles_few"
    orders.repartition(4).write.mode("overwrite").parquet(str(few))
    few_files = len(list(few.rglob("*.parquet")))

    delta_path = ARTIFACTS / "smallfiles_delta"
    orders.write.mode("overwrite").format("delta").save(str(delta_path))
    DeltaTable.forPath(spark, str(delta_path)).optimize().executeCompaction()

    read_many = spark.read.parquet(str(many)).drop("_bucket")
    read_few = spark.read.parquet(str(few)).drop("_bucket")
    return {
        "experiment": "small_files",
        "many_files": many_files,
        "few_files": few_files,
        "many_ms": _timed(read_many),
        "few_ms": _timed(read_few),
    }


EXPERIMENTS = [
    experiment_partition_pruning,
    experiment_broadcast_join,
    experiment_shuffle_partitions,
    experiment_skew,
    experiment_small_files,
]


def main() -> int:
    settings = get_settings()
    spark = build_spark("quickcart-optimization")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        for experiment in EXPERIMENTS:
            result = experiment(spark, settings.data_root)
            results.append(result)
            print(json.dumps(result))
    finally:
        spark.stop()
    (ARTIFACTS / "optimization_results.json").write_text(
        json.dumps(results, indent=2, default=str), encoding="utf-8"
    )
    print(f"results written to {ARTIFACTS / 'optimization_results.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
