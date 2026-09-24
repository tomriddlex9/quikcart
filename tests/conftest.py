"""Shared fixtures. The seeded database is session-scoped and disposable:
reset + re-migrate + smoke-seed keeps `uv run pytest` self-contained when the
core profile is up, and skips cleanly when PostgreSQL is unreachable.
"""

import pytest

from quickcart.db.connection import is_reachable


@pytest.fixture(scope="session")
def seeded_db():
    if not is_reachable():
        pytest.skip("PostgreSQL unreachable; start it with: docker compose --profile core up -d")

    from quickcart.db.connection import connect
    from quickcart.db.load import load_history, load_reference
    from quickcart.db.reset import reset_schema
    from quickcart.simulator.config import SimulatorConfig
    from quickcart.simulator.generator import generate_history, generate_reference

    reset_schema()
    cfg = SimulatorConfig().smoke()
    ref = generate_reference(cfg)
    history = generate_history(cfg)
    with connect() as conn, conn.transaction(), conn.cursor() as cur:
        load_reference(cur, ref)
        load_history(cur, history)
    return history


@pytest.fixture(scope="session")
def spark_session():
    pytest.importorskip("pyspark", reason="spark dependency group not installed")
    from quickcart.lakehouse.common.spark import build_spark

    spark = build_spark("quickcart-tests", test=True)
    yield spark
    spark.stop()


@pytest.fixture(scope="session")
def pipeline_run(seeded_db, spark_session, tmp_path_factory):
    """Export → bronze → silver → gold against a tmp data root, once per session."""
    from datetime import date

    from quickcart.ingestion.export import export_all
    from quickcart.lakehouse.bronze.load import run_bronze
    from quickcart.lakehouse.gold.load import run_gold
    from quickcart.lakehouse.silver.load import run_silver, silver_quality_gate

    root = tmp_path_factory.mktemp("lakehouse")
    export_all(data_root=root, load_date=date(2026, 9, 23))
    bronze_counts = run_bronze(spark_session, root)
    silver_stats = run_silver(spark_session, root)
    failures = silver_quality_gate(silver_stats)
    assert failures == [], failures
    gold_counts = run_gold(spark_session, root)
    return {"root": root, "bronze": bronze_counts, "silver": silver_stats, "gold": gold_counts}
