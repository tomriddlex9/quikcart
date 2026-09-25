"""PostgreSQL CDC via Debezium (kit/03 §8).

Bronze preserves the Debezium envelope largely as received (kit/04 §7);
a dedicated adapter normalizes it so Silver stays decoupled from broker
serialization details:

    source_table, operation, business key, before_json, after_json,
    source_event_time, source_position, ingested_at

Delete policy (deterministic, documented): deletes are applied as hard
deletes on Silver — the CDC log in Bronze remains the audit trail, and a
tombstone-style `_deleted` flag alternative is noted in docs/learning/phase-8.md.
"""

import argparse
from pathlib import Path

import structlog
from delta import DeltaTable
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import LongType, StringType, StructField, StructType

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.schemas import ORDERS_SCHEMA
from quickcart.lakehouse.common.spark import build_spark
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

CDC_TOPICS = {
    "quickcart.public.orders": "bronze_orders_cdc",
    "quickcart.public.inventory": "bronze_inventory_cdc",
    "quickcart.public.payments": "bronze_payments_cdc",
    "quickcart.public.order_items": "bronze_order_items_cdc",
    "quickcart.public.deliveries": "bronze_deliveries_cdc",
}

SOURCE_SCHEMA = StructType(
    [
        StructField("before", ORDERS_SCHEMA, True),
        StructField("after", ORDERS_SCHEMA, True),
        StructField("op", StringType(), True),  # c/u/d/r
        StructField(
            "source",
            StructType(
                [
                    StructField("ts_ms", LongType(), True),
                    StructField("lsn", StringType(), True),
                ]
            ),
            True,
        ),
    ]
)

SILVER_FOR_CDC = {"bronze_orders_cdc": "silver_orders"}


def normalize_debezium(batch: DataFrame) -> DataFrame:
    """Kafka micro-batch → normalized CDC rows (adapter layer, kit/04 §7)."""
    return (
        batch.selectExpr(
            "topic",
            "partition",
            "offset",
            "CAST(value AS STRING) as _json",
        )
        .withColumn("_envelope", F.from_json("_json", SOURCE_SCHEMA))
        .select(
            "topic",
            "partition",
            "offset",
            F.col("_envelope.op").alias("operation"),
            F.col("_envelope.after.order_id").alias("order_id_after"),
            F.col("_envelope.before.order_id").alias("order_id_before"),
            F.to_json("_envelope.after").alias("after_json"),
            F.to_json("_envelope.before").alias("before_json"),
            F.col("_envelope.source.ts_ms").alias("source_ts_ms"),
            F.col("_envelope.source.lsn").alias("source_lsn"),
            F.current_timestamp().alias("_ingested_at"),
        )
        .withColumnRenamed("topic", "_topic")
        .withColumnRenamed("partition", "_partition")
        .withColumnRenamed("offset", "_offset")
    )


def write_cdc_bronze_batch(batch: DataFrame, batch_id: int, root: Path) -> None:
    normalized = normalize_debezium(batch)
    for topic, bronze_table in CDC_TOPICS.items():
        rows = normalized.filter(F.col("_topic") == topic)
        if rows.head(1):
            rows.write.format("delta").mode("append").save(
                str(root / "bronze" / bronze_table)
            )
            log.info("cdc.bronze_appended", topic=topic, batch_id=batch_id)


def build_cdc_query(spark: SparkSession, bootstrap_servers: str, root: Path, checkpoint_dir: Path):
    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", bootstrap_servers)
        .option("subscribe", ",".join(CDC_TOPICS))
        .option("startingOffsets", "earliest")
        .load()
    )
    return (
        raw.writeStream.foreachBatch(
            lambda batch, batch_id: write_cdc_bronze_batch(batch, batch_id, root)
        )
        .option("checkpointLocation", str(checkpoint_dir))
        .trigger(processingTime="3 seconds")
        .start()
    )


def apply_cdc_to_silver(
    spark: SparkSession, root: Path, bronze_table: str = "bronze_orders_cdc"
) -> dict:
    """Apply the CDC log to Silver: upsert from latest op, hard-delete 'd'."""
    silver_table = SILVER_FOR_CDC[bronze_table]
    cdc_path = root / "bronze" / bronze_table
    if not cdc_path.exists():
        return {"inserted": 0, "updated": 0, "deleted": 0}
    bronze = spark.read.format("delta").load(str(cdc_path))
    if bronze.head(1) == []:
        return {"inserted": 0, "updated": 0, "deleted": 0}

    # Latest event per business key wins (deterministic replay).
    key = F.coalesce(F.col("order_id_after"), F.col("order_id_before"))
    window = Window.partitionBy(key).orderBy(F.col("source_ts_ms").desc())
    latest = (
        bronze.withColumn("_key", key)
        .withColumn("_rn", F.row_number().over(window))
        .filter("_rn = 1")
        .drop("_rn")
    )

    after_schema = ORDERS_SCHEMA
    upsert_rows = (
        latest.filter(F.col("operation").isin("c", "u", "r"))
        .withColumn("payload", F.from_json("after_json", after_schema))
        .select("payload.*")
    )
    delete_keys = (
        latest.filter(F.col("operation") == "d")
        .select(F.col("_key").alias("order_id"))
    )

    silver_path = root / "silver" / silver_table
    metrics = {"inserted": 0, "updated": 0, "deleted": 0}
    if not silver_path.exists():
        # First apply after a fresh Bronze CDC log: initialise Silver from
        # the log itself (snapshot rows carry full images); deleted keys are
        # excluded and reported.
        initial = upsert_rows.join(delete_keys, "order_id", "left_anti")
        initial.write.format("delta").mode("overwrite").save(str(silver_path))
        metrics["inserted"] = initial.count()
        metrics["deleted"] = delete_keys.count()
        return metrics
    if upsert_rows.head(1):
        target = DeltaTable.forPath(spark, str(silver_path))
        (
            target.alias("t")
            .merge(upsert_rows.alias("s"), "t.order_id = s.order_id")
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute()
        )
        history = target.history(1).first()["operationMetrics"] or {}
        metrics["inserted"] = int(history.get("numTargetRowsInserted", 0))
        metrics["updated"] = int(history.get("numTargetRowsUpdated", 0))
    if delete_keys.head(1):
        target = DeltaTable.forPath(spark, str(silver_path))
        (
            target.alias("t")
            .merge(delete_keys.alias("s"), "t.order_id = s.order_id")
            .whenMatchedDelete()
            .execute()
        )
        history = target.history(1).first()["operationMetrics"] or {}
        metrics["deleted"] = int(history.get("numTargetRowsDeleted", 0))
    return metrics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Debezium CDC consumer / Silver applier")
    parser.add_argument("mode", choices=["consume", "apply"])
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)

    settings = get_settings()
    root = settings.data_root
    spark = build_spark("quickcart-cdc")
    try:
        if args.mode == "consume":
            checkpoint = root / "checkpoints" / "bronze_cdc"
            query = build_cdc_query(spark, settings.redpanda_bootstrap_servers, root, checkpoint)
            if args.once:
                query.processAllAvailable()
                query.stop()
            else:
                query.awaitTermination()
        else:
            metrics = apply_cdc_to_silver(spark, root)
            log.info("cdc.silver_applied", **metrics)
    except KeyboardInterrupt:
        pass
    finally:
        spark.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
