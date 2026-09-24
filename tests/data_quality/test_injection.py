"""Failure-injection tests: every kit/04 §12 scenario must be caught by the
Silver rules (quarantine, never silently dropped) or handled exactly once
(dedup). Each scenario runs over real exported CSVs copied into tmp space."""

from datetime import date
from pathlib import Path

import pytest

from quickcart.ingestion.export import export_all
from quickcart.lakehouse.common.schemas import (
    CUSTOMERS_SCHEMA,
    DELIVERIES_SCHEMA,
    INVENTORY_SCHEMA,
    ORDER_ITEMS_SCHEMA,
    ORDERS_SCHEMA,
    PAYMENTS_SCHEMA,
    PRODUCTS_SCHEMA,
)
from quickcart.quality.injection import SCENARIOS, inject_defects

pytestmark = pytest.mark.data_quality

TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss"


@pytest.fixture(scope="module")
def raw_export(seeded_db, tmp_path_factory):
    root = tmp_path_factory.mktemp("raw_clean")
    export_all(data_root=root, load_date=date(2026, 9, 23))
    return root


def _read(spark_session, path: Path, schema):
    return (
        spark_session.read.schema(schema)
        .option("header", True)
        .option("timestampFormat", TIMESTAMP_FORMAT)
        .option("mode", "PERMISSIVE")
        .csv(str(path))
    )


def _csv(root: Path, entity: str) -> Path:
    return root / "raw" / entity / "load_date=2026-09-23" / f"{entity}.csv"


def _scenario_dir(tmp_path, raw_export, scenario) -> Path:
    out = tmp_path / f"injected_{scenario}"
    inject_defects(raw_export, out, [scenario], seed=7)
    return out


def test_all_scenarios_registered() -> None:
    expected = {
        "duplicate_order_event",
        "late_delivery_event",
        "missing_customer_reference",
        "unknown_product_reference",
        "negative_payment_amount",
        "malformed_timestamp",
        "new_optional_schema_field",
        "duplicate_payment_cdc",
        "out_of_order_status_event",
        "inventory_negative_discrepancy",
    }
    assert expected <= set(SCENARIOS)


def test_duplicate_order_event_removed_exactly_once(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_orders

    out = _scenario_dir(tmp_path, raw_export, "duplicate_order_event")
    before = _read(spark_session, _csv(raw_export, "orders"), ORDERS_SCHEMA)
    after = _read(spark_session, _csv(out, "orders"), ORDERS_SCHEMA)
    clean, quarantine, _ = clean_orders(after)
    assert after.count() == before.count() + 5
    assert quarantine.count() == 0
    assert clean.count() == before.count()  # duplicates collapse to one row per key


def test_late_delivery_event_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_deliveries

    out = _scenario_dir(tmp_path, raw_export, "late_delivery_event")
    df = _read(spark_session, _csv(out, "deliveries"), DELIVERIES_SCHEMA)
    _clean, quarantine, _ = clean_deliveries(df)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-DEL-001" in row["_error_codes"] for row in bad)


def test_missing_customer_reference_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_orders

    out = _scenario_dir(tmp_path, raw_export, "missing_customer_reference")
    df = _read(spark_session, _csv(out, "orders"), ORDERS_SCHEMA)
    customers = _read(spark_session, _csv(raw_export, "customers"), CUSTOMERS_SCHEMA)
    _clean, quarantine, _ = clean_orders(df, customers=customers)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-ORDER-003" in row["_error_codes"] for row in bad)


def test_unknown_product_reference_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_order_items

    out = _scenario_dir(tmp_path, raw_export, "unknown_product_reference")
    df = _read(spark_session, _csv(out, "order_items"), ORDER_ITEMS_SCHEMA)
    products = _read(spark_session, _csv(raw_export, "products"), PRODUCTS_SCHEMA)
    _clean, quarantine, _ = clean_order_items(df, products=products)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-ITEM-002" in row["_error_codes"] for row in bad)


def test_negative_payment_amount_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_payments

    out = _scenario_dir(tmp_path, raw_export, "negative_payment_amount")
    df = _read(spark_session, _csv(out, "payments"), PAYMENTS_SCHEMA)
    _clean, quarantine, _ = clean_payments(df)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-PAY-001" in row["_error_codes"] for row in bad)


def test_malformed_timestamp_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_orders

    out = _scenario_dir(tmp_path, raw_export, "malformed_timestamp")
    df = _read(spark_session, _csv(out, "orders"), ORDERS_SCHEMA)
    _clean, quarantine, _ = clean_orders(df)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-ORDER-006" in row["_error_codes"] for row in bad)


def test_duplicate_payment_cdc_removed_exactly_once(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_payments

    out = _scenario_dir(tmp_path, raw_export, "duplicate_payment_cdc")
    before = _read(spark_session, _csv(raw_export, "payments"), PAYMENTS_SCHEMA)
    after = _read(spark_session, _csv(out, "payments"), PAYMENTS_SCHEMA)
    clean, _quarantine, _ = clean_payments(after)
    assert after.count() == before.count() + 5
    assert clean.count() == before.count()


def test_out_of_order_status_event_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_deliveries

    out = _scenario_dir(tmp_path, raw_export, "out_of_order_status_event")
    df = _read(spark_session, _csv(out, "deliveries"), DELIVERIES_SCHEMA)
    _clean, quarantine, _ = clean_deliveries(df)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-DEL-004" in row["_error_codes"] for row in bad)


def test_inventory_negative_discrepancy_quarantined(raw_export, spark_session, tmp_path) -> None:
    from quickcart.lakehouse.silver.transforms import clean_inventory

    out = _scenario_dir(tmp_path, raw_export, "inventory_negative_discrepancy")
    df = _read(spark_session, _csv(out, "inventory"), INVENTORY_SCHEMA)
    _clean, quarantine, _ = clean_inventory(df)
    bad = quarantine.collect()
    assert len(bad) == 5
    assert all("DQ-INV-001" in row["_error_codes"] for row in bad)


def test_new_optional_schema_field_is_ignored_not_fatal(
    raw_export, spark_session, tmp_path
) -> None:
    out = _scenario_dir(tmp_path, raw_export, "new_optional_schema_field")
    df = _read(spark_session, _csv(out, "orders"), ORDERS_SCHEMA)
    assert df.count() > 0
    assert "loyalty_points" not in df.columns  # explicit contract wins
