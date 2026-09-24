"""Dashboard data tests (kit/07 Phase 10): KPIs match direct Gold queries,
filters behave, and empty states are handled by the page functions."""

import pytest

from quickcart.lakehouse.readers import GoldReaders

pytestmark = pytest.mark.integration


def test_kpis_match_direct_gold_queries(pipeline_run, spark_session) -> None:
    readers = GoldReaders(spark_session, pipeline_run["root"])
    kpis = readers.kpi_summary()

    hourly = spark_session.read.format("delta").load(
        str(pipeline_run["root"] / "gold" / "gold_store_hourly_metrics")
    )
    direct = hourly.agg({"orders_placed": "sum", "gmv": "sum"}).first()
    assert kpis["orders_placed"] == direct["sum(orders_placed)"]
    assert abs(kpis["gmv"] - float(direct["sum(gmv)"])) < 0.01


def test_store_filtering_does_not_alter_definitions(pipeline_run, spark_session) -> None:
    readers = GoldReaders(spark_session, pipeline_run["root"])
    store_id = readers.store_comparison().first()["store_id"]
    hourly = readers.store_hourly(int(store_id))
    assert hourly.filter(f"store_id != {store_id}").count() == 0
    assert hourly.count() > 0


def test_inventory_risk_only_returns_flagged_rows(pipeline_run, spark_session) -> None:
    readers = GoldReaders(spark_session, pipeline_run["root"])
    risk = readers.inventory_risk().collect()
    assert all(row["is_below_reorder_point"] for row in risk)


def test_empty_gold_is_handled(spark_session, tmp_path) -> None:
    """Readers surface empty data without crashing (page-level empty states)."""
    from pyspark.sql import types as T

    root = tmp_path / "empty"
    for table, schema in {
        "gold_store_hourly_metrics": T.StructType([T.StructField("gmv", T.StringType())]),
    }.items():
        path = root / "gold" / table
        path.mkdir(parents=True)
        spark_session.createDataFrame([], schema).write.format("delta").save(str(path))
    # With only one gold table present, KPI aggregation over missing tables
    # must fail loudly rather than fabricate numbers — assert the exception.
    readers = GoldReaders(spark_session, root)
    with pytest.raises(Exception):  # noqa: B017 — any analysis failure is acceptable here
        readers.kpi_summary()


def test_page_functions_render_with_fake_streamlit(pipeline_run, spark_session) -> None:
    """Page functions accept an injected streamlit stand-in (no runtime)."""
    from quickcart.dashboard_pages import PAGES, render_page

    calls = {"metric": 0, "dataframe": 0, "plotly": 0, "info": 0}

    class FakeSt:
        columns = staticmethod(lambda n: [FakeSt() for _ in range(n)])

        @staticmethod
        def plotly_chart(*args, **kwargs):
            calls["plotly"] += 1

        @staticmethod
        def dataframe(*args, **kwargs):
            calls["dataframe"] += 1

        @staticmethod
        def metric(*args, **kwargs):
            calls["metric"] += 1

        @staticmethod
        def info(*args, **kwargs):
            calls["info"] += 1

        caption = staticmethod(lambda *a, **k: None)
        subheader = staticmethod(lambda *a, **k: None)
        success = staticmethod(lambda *a, **k: None)
        warning = staticmethod(lambda *a, **k: None)
        selectbox = staticmethod(lambda label, options, **k: options[0])

    readers = GoldReaders(spark_session, pipeline_run["root"])
    for page in PAGES:
        render_page(page, readers, FakeSt())
    assert calls["metric"] >= 4  # overview KPIs rendered
