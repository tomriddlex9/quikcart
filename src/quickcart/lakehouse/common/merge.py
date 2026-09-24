"""Delta MERGE upserts (kit/03 §5.4).

Generic key-based upsert used by CDC apply (Phase 8) and SCD2 rewrites.
Deterministic and idempotent: rerunning with the same source rows produces
the same table state.
"""

from pathlib import Path

from delta import DeltaTable
from pyspark.sql import DataFrame, SparkSession


def upsert(
    spark: SparkSession,
    target_path: Path,
    source: DataFrame,
    key: str,
) -> dict[str, int]:
    """INSERT new keys / UPDATE existing keys. Returns merge metrics."""
    target = DeltaTable.forPath(spark, str(target_path))
    (
        target.alias("t")
        .merge(source.alias("s"), f"t.{key} = s.{key}")
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute()
    )
    history = target.history(1).first()
    metrics = history["operationMetrics"] or {}
    return {
        "inserted": int(metrics.get("numTargetRowsInserted", 0)),
        "updated": int(metrics.get("numTargetRowsUpdated", 0)),
        "deleted": int(metrics.get("numTargetRowsDeleted", 0)),
    }


def delete_keys(
    spark: SparkSession,
    target_path: Path,
    keys_df: DataFrame,
    key: str,
) -> dict[str, int]:
    """DELETE rows whose key appears in keys_df (CDC tombstone application)."""
    target = DeltaTable.forPath(spark, str(target_path))
    (
        target.alias("t")
        .merge(keys_df.alias("s"), f"t.{key} = s.{key}")
        .whenMatchedDelete()
        .execute()
    )
    history = target.history(1).first()
    metrics = history["operationMetrics"] or {}
    return {"deleted": int(metrics.get("numTargetRowsDeleted", 0))}
