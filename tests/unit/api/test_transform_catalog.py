"""Unit tests for the lakehouse transform catalog (CLEANERS / MARTS mirrors)."""

from __future__ import annotations

from quickcart.api.transform_catalog import (
    all_transform_ops,
    get_op,
    ops_for_table,
)
from quickcart.lakehouse.gold.marts import MARTS
from quickcart.lakehouse.silver.transforms import CLEANERS, SILVER_TABLE

MEDALLION = {"bronze", "silver", "quarantine", "gold"}


def test_catalog_covers_every_cleaner_and_mart() -> None:
    ops = all_transform_ops()
    ids = {op.id for op in ops}

    for bronze in CLEANERS:
        entity = bronze.removeprefix("bronze_")
        assert f"silver-clean-{entity}" in ids
        assert f"quarantine-{entity}" in ids

    for mart_name in MARTS:
        bare = mart_name.removeprefix("gold_")
        assert f"gold-build-{bare}" in ids


def test_every_op_has_sql_io_and_known_layer() -> None:
    for op in all_transform_ops():
        assert op.layer in MEDALLION
        assert op.id
        assert op.code.strip()
        assert op.inputs
        assert op.outputs


def test_silver_ops_expose_dq_rules() -> None:
    silver = [op for op in all_transform_ops() if op.layer == "silver"]
    assert silver
    with_rules = [op for op in silver if op.rules]
    assert with_rules, "silver cleaners must surface DQ rules for the console"


def test_ops_for_table_matches_silver_and_quarantine() -> None:
    bronze = next(iter(CLEANERS))
    silver = SILVER_TABLE[bronze]
    quarantine = f"{silver}_quarantine"

    silver_ops = ops_for_table(silver)
    assert any(op.layer == "silver" for op in silver_ops)

    q_ops = ops_for_table(quarantine)
    assert any(op.layer == "quarantine" for op in q_ops)


def test_get_op_round_trip() -> None:
    first = all_transform_ops()[0]
    assert get_op(first.id) is not None
    assert get_op(first.id).id == first.id
    assert get_op("does-not-exist") is None
