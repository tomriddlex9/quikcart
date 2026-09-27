"""Read latest raw JSONL partitions (weather, news, traffic)."""

from __future__ import annotations

from pathlib import Path

from pyspark.sql import DataFrame, SparkSession

from quickcart.lakehouse.common.paths import latest_raw_partition


def read_latest_raw_jsonl(
    spark: SparkSession,
    root: Path | None,
    entity: str,
    filename: str,
) -> DataFrame | None:
    try:
        partition = latest_raw_partition(root, entity)
    except FileNotFoundError:
        return None
    path = partition / filename
    if not path.exists():
        return None
    return spark.read.json(str(path))
