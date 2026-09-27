"""Bronze loaders for external JSONL feeds (weather, news, traffic)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from quickcart.lakehouse.bronze.load import write_bronze
from quickcart.lakehouse.common.paths import latest_raw_partition
from quickcart.lakehouse.common.raw_jsonl import read_latest_raw_jsonl

EXTERNAL_SOURCES: dict[str, tuple[str, str]] = {
    "bronze_weather_feed": ("weather", "weather.json"),
    "bronze_news_feed": ("news", "news.json"),
    "bronze_traffic_feed": ("traffic", "traffic.json"),
}


def _stamp_bronze(df: DataFrame, *, source_system: str, source_file: str, day: date) -> DataFrame:
    return df.select(
        "*",
        F.current_timestamp().alias("_ingested_at"),
        F.lit(source_system).alias("_source_system"),
        F.lit(source_file).alias("_source_file"),
        F.lit(1).alias("_schema_version"),
        F.lit(day.isoformat()).alias("_ingestion_date"),
    )


def normalize_weather_bronze(raw: DataFrame, partition_path: Path, day: date) -> DataFrame:
    columns = set(raw.columns)
    if "temperature_c" in columns:
        temp = F.col("temperature_c")
    elif "temp_c" in columns:
        temp = F.col("temp_c")
    else:
        temp = F.lit(None)
    precip = F.col("precip_mm") if "precip_mm" in columns else F.lit(0.0)
    df = raw.select(
        F.col("store_id").cast("long").alias("store_id"),
        F.col("city").cast("string").alias("city"),
        F.col("observed_at").cast("string").alias("observed_at"),
        temp.cast("double").alias("temp_c"),
        precip.cast("double").alias("precip_mm"),
        F.col("condition").cast("string").alias("condition"),
    )
    return _stamp_bronze(
        df,
        source_system="open-meteo",
        source_file=str(partition_path / "weather.json"),
        day=day,
    )


def normalize_news_bronze(raw: DataFrame, partition_path: Path, day: date) -> DataFrame:
    df = raw.select(
        F.col("article_id").cast("string").alias("article_id"),
        F.col("city").cast("string").alias("city"),
        F.col("published_at").cast("string").alias("published_at"),
        F.col("headline").cast("string").alias("headline"),
        F.coalesce(F.col("sentiment"), F.lit("neutral")).cast("string").alias("sentiment"),
    )
    return _stamp_bronze(
        df,
        source_system="city-rss",
        source_file=str(partition_path / "news.json"),
        day=day,
    )


def normalize_traffic_bronze(raw: DataFrame, partition_path: Path, day: date) -> DataFrame:
    df = raw.select(
        F.col("store_id").cast("long").alias("store_id"),
        F.col("city").cast("string").alias("city"),
        F.col("observed_at").cast("string").alias("observed_at"),
        F.col("eta_delay_sec").cast("long").alias("eta_delay_sec"),
        F.col("baseline_eta_sec").cast("long").alias("baseline_eta_sec"),
        F.coalesce(F.col("source"), F.lit("unknown")).cast("string").alias("source"),
    )
    return _stamp_bronze(
        df,
        source_system="traffic",
        source_file=str(partition_path / "traffic.json"),
        day=day,
    )


def load_external_bronze_table(
    spark: SparkSession,
    root: Path | None,
    table: str,
    *,
    ingestion_date: date | None = None,
) -> int | None:
    if table not in EXTERNAL_SOURCES:
        raise KeyError(f"unknown external bronze table {table!r}")
    entity, filename = EXTERNAL_SOURCES[table]
    raw = read_latest_raw_jsonl(spark, root, entity, filename)
    if raw is None:
        return None
    day = ingestion_date or date.today()
    partition = latest_raw_partition(root, entity)
    if table == "bronze_weather_feed":
        df = normalize_weather_bronze(raw, partition, day)
    elif table == "bronze_news_feed":
        df = normalize_news_bronze(raw, partition, day)
    else:
        df = normalize_traffic_bronze(raw, partition, day)
    write_bronze(df, root, table)
    return df.count()


def run_bronze_external(
    spark: SparkSession, root: Path | None = None, *, ingestion_date: date | None = None
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in EXTERNAL_SOURCES:
        loaded = load_external_bronze_table(spark, root, table, ingestion_date=ingestion_date)
        if loaded is not None:
            counts[table] = loaded
    return counts
