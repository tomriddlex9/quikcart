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
