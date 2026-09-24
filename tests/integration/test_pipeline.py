"""End-to-end pipeline integration: export → bronze → silver → gold, twice.

Proves the kit/07 Phase 4 acceptance gates:
- Bronze carries raw payload + ingestion metadata
- Silver + quarantine tables are produced and the quality gate passes
- Gold marts are non-empty
- a full rerun does not duplicate anything (idempotency)
"""

from quickcart.lakehouse.bronze.load import run_bronze
from quickcart.lakehouse.common.paths import table_path
from quickcart.lakehouse.gold.load import run_gold
from quickcart.lakehouse.silver.load import run_silver


def test_bronze_preserves_payload_and_adds_metadata(pipeline_run, spark_session) -> None:
    path = table_path("bronze", "bronze_orders", pipeline_run["root"])
    df = spark_session.read.format("delta").load(str(path))
    for column in ("_ingested_at", "_source_system", "_source_file", "_schema_version"):
        assert column in df.columns, column
    assert df.count() == pipeline_run["bronze"]["bronze_orders"]


def test_silver_tables_and_quarantine_exist(pipeline_run, spark_session) -> None:
    stats = pipeline_run["silver"]
    assert stats["silver_orders"]["clean_rows"] > 0
    for table, counts in stats.items():
        quarantine_path = table_path("quarantine", f"{table}_quarantine", pipeline_run["root"])
        assert quarantine_path.exists(), table
        stored = spark_session.read.format("delta").load(str(quarantine_path))
        assert stored.count() == counts["quarantined_rows"]


def test_gold_marts_non_empty(pipeline_run) -> None:
    assert set(pipeline_run["gold"]) == {
        "gold_store_hourly_metrics",
        "gold_customer_360",
        "gold_inventory_health",
        "gold_delivery_performance",
        "gold_product_performance",
    }
    for table, count in pipeline_run["gold"].items():
        assert count > 0, f"{table} is empty"


def test_full_rerun_is_idempotent(pipeline_run, spark_session) -> None:
    root = pipeline_run["root"]
    run_bronze(spark_session, root)
    silver_stats = run_silver(spark_session, root)
    gold_counts = run_gold(spark_session, root)
    assert silver_stats == pipeline_run["silver"]
    assert gold_counts == pipeline_run["gold"]

    metrics = spark_session.read.format("delta").load(
        str(table_path("gold", "gold_store_hourly_metrics", root))
    )
    assert metrics.count() == pipeline_run["gold"]["gold_store_hourly_metrics"]
