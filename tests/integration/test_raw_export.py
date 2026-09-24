from datetime import date

import pytest

from quickcart.ingestion.export import export_all
from quickcart.lakehouse.learning import schemas


@pytest.mark.integration
def test_export_produces_all_sources(seeded_db, tmp_path) -> None:
    written = export_all(data_root=tmp_path, load_date=date(2026, 9, 23))
    names = {p.name for p in written}
    assert "orders.csv" in names
    assert "supplier_catalog.csv" in names
    assert "order_events.jsonl" in names
    assert len(written) == 16  # 14 tables + supplier catalog + order events
    for path in written:
        assert path.stat().st_size > 0, path


@pytest.mark.integration
def test_spark_reads_exported_orders_with_matching_count(
    seeded_db, spark_session, tmp_path
) -> None:
    export_all(data_root=tmp_path, load_date=date(2026, 9, 23))
    orders = (
        spark_session.read.schema(schemas.ORDERS_SCHEMA)
        .option("header", True)
        .option("timestampFormat", "yyyy-MM-dd HH:mm:ss")
        .csv(str(tmp_path / "raw" / "orders" / "load_date=2026-09-23" / "orders.csv"))
    )
    assert orders.count() == len(seeded_db.orders)
    assert orders.filter("placed_at IS NULL").count() == 0


@pytest.mark.integration
def test_supplier_catalog_is_deterministic(seeded_db, tmp_path) -> None:
    first = export_all(data_root=tmp_path / "a", load_date=date(2026, 9, 23))
    second = export_all(data_root=tmp_path / "b", load_date=date(2026, 9, 23))
    catalog_a = next(p for p in first if p.name == "supplier_catalog.csv")
    catalog_b = next(p for p in second if p.name == "supplier_catalog.csv")
    assert catalog_a.read_text() == catalog_b.read_text()
