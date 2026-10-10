"""Unit tests for metric → medallion lineage resolution."""

from __future__ import annotations

import pytest

from quickcart.api.metric_lineage import (
    MetricLineageError,
    build_metric_lineage,
    headline_metric_keys,
    parse_gold_source,
)
from quickcart.api.transform_catalog import all_transform_ops
from quickcart.lakehouse.gold.marts import MARTS


@pytest.mark.parametrize(
    ("source", "table", "column"),
    [
        ("gold_store_hourly_metrics.gmv", "gold_store_hourly_metrics", "gmv"),
        (
            "gold_store_hourly_metrics.late_delivery_rate (1 - late_rate)",
            "gold_store_hourly_metrics",
            "late_delivery_rate",
        ),
        ("gold_customer_360", "gold_customer_360", None),
        (
            "gold_inventory_health.is_below_reorder_point + gold_product_performance",
            "gold_inventory_health",
            "is_below_reorder_point",
        ),
    ],
)
def test_parse_gold_source(source: str, table: str, column: str | None) -> None:
    assert parse_gold_source(source) == (table, column)


def test_parse_gold_source_rejects_empty() -> None:
    with pytest.raises(MetricLineageError):
        parse_gold_source("no gold table here")


def test_transform_catalog_covers_every_mart() -> None:
    ids = {op.id for op in all_transform_ops()}
    for mart_name in MARTS:
        bare = mart_name.removeprefix("gold_")
        assert f"gold-build-{bare}" in ids


@pytest.mark.parametrize("key", headline_metric_keys())
def test_headline_metric_lineage_has_raw_and_gold(key: str) -> None:
    payload = build_metric_lineage(key)
    assert payload["metric_key"] == key
    assert payload["label"]
    assert payload["formula_text"]
    layers = {step["layer"] for step in payload["steps"]}
    assert "raw" in layers
    assert "gold" in layers
    gold_steps = [s for s in payload["steps"] if s["layer"] == "gold"]
    assert gold_steps
    primary = gold_steps[0]
    assert primary["table"].startswith("gold_")
    # At least one transform op with code along the path
    codes = [op["code"] for step in payload["steps"] for op in step["ops"]]
    assert any(c.strip() for c in codes), f"{key} lineage has no transform code"
    assert payload["edges"]


def test_unknown_metric_raises() -> None:
    with pytest.raises(MetricLineageError):
        build_metric_lineage("not_a_real_metric")


def test_sales_gmv_points_at_hourly_mart_and_source_path() -> None:
    payload = build_metric_lineage("sales_gmv")
    gold = next(s for s in payload["steps"] if s["table"] == "gold_store_hourly_metrics")
    assert gold["column"] == "gmv"
    gold_ops = gold["ops"]
    assert gold_ops
    assert any(
        op.get("source_path", "").endswith("gold_store_hourly_metrics") for op in gold_ops
    )
