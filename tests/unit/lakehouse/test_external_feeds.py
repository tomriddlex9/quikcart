"""Bronze/silver promotion for weather JSONL feeds."""

import json
from datetime import date

import pytest

from quickcart.lakehouse.bronze.external import run_bronze_external
from quickcart.lakehouse.silver.external import silver_city_hour_context
from quickcart.lakehouse.silver.load import _run_silver_external

pytestmark = pytest.mark.unit


def _write_weather_raw(root, day: date) -> None:
    partition = root / "raw" / "weather" / f"load_date={day.isoformat()}"
    partition.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "store_id": 10,
            "city": "Mumbai",
            "observed_at": "2026-03-01 10:30:00",
            "temperature_c": 31.0,
            "condition": "RAIN",
            "source": "fixture",
        }
    ]
    (partition / "weather.json").write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8"
    )


def test_bronze_silver_weather_promotion(spark_session, tmp_path) -> None:
    day = date(2026, 3, 1)
    _write_weather_raw(tmp_path, day)
    counts = run_bronze_external(spark_session, tmp_path, ingestion_date=day)
    assert counts["bronze_weather_feed"] == 1

    stats = _run_silver_external(spark_session, tmp_path)
    assert stats["silver_store_weather"]["clean_rows"] == 1
    assert stats["silver_city_hour_context"]["clean_rows"] == 1


def test_city_hour_context_counts_news(spark_session) -> None:
    weather = spark_session.createDataFrame(
        [(10, "Mumbai", "2026-03-01 10:30:00", 30.0, 0.0, "RAIN")],
        "store_id: long, city: string, observed_at: string, temp_c: double, precip_mm: double, "
        "condition: string",
    )
    news = spark_session.createDataFrame(
        [
            ("a1", "Mumbai", "2026-03-01 10:15:00", "One"),
            ("a2", "Mumbai", "2026-03-01 10:45:00", "Two"),
        ],
        "article_id: string, city: string, published_at: string, headline: string",
    )
    context = silver_city_hour_context(weather, news).collect()
    assert len(context) == 1
    assert context[0]["news_volume"] == 2
    assert float(context[0]["temp_c"]) == 30.0
