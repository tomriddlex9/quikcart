"""Silver promotion for external feeds (weather, news, traffic)."""

from __future__ import annotations

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F


def silver_store_weather(bronze_weather: DataFrame) -> DataFrame:
    """One row per store per hour with the latest observed condition."""
    hourly = bronze_weather.withColumn(
        "weather_hour",
        F.date_trunc("hour", F.to_timestamp("observed_at")),
    )
    window = Window.partitionBy("store_id", "weather_hour").orderBy(
        F.col("observed_at").desc(), F.col("_ingested_at").desc()
    )
    return (
        hourly.withColumn("_rn", F.row_number().over(window))
        .filter(F.col("_rn") == 1)
        .select(
            "store_id",
            "city",
            "weather_hour",
            F.col("condition").alias("weather_condition"),
            F.col("temp_c"),
            F.col("precip_mm"),
        )
        .orderBy("store_id", "weather_hour")
    )


def silver_city_hour_context(
    bronze_weather: DataFrame, bronze_news: DataFrame | None = None
) -> DataFrame:
    """City-hour context for demand ML features and lineage."""
    weather_h = (
        bronze_weather.withColumn("hour", F.date_trunc("hour", F.to_timestamp("observed_at")))
        .groupBy("city", "hour")
        .agg(
            F.avg("temp_c").alias("temp_c"),
            F.avg("precip_mm").alias("precip_mm"),
            F.first("condition", ignorenulls=True).alias("condition"),
        )
    )
    if bronze_news is None:
        return weather_h.withColumn("news_volume", F.lit(0).cast("long")).orderBy("city", "hour")

    news_h = (
        bronze_news.withColumn("hour", F.date_trunc("hour", F.to_timestamp("published_at")))
        .groupBy("city", "hour")
        .agg(F.count("*").alias("news_volume"))
    )
    return (
        weather_h.join(news_h, ["city", "hour"], "outer")
        .withColumn("news_volume", F.coalesce(F.col("news_volume"), F.lit(0)))
        .withColumn("temp_c", F.col("temp_c"))
        .orderBy("city", "hour")
    )
