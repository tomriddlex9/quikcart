"""Lineage topology and Delta transaction-log row-count tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from quickcart.api.catalog_lineage import (
    build_catalog_lineage,
    delta_layer_counts,
    delta_table_row_count,
)
from tests.unit.api.fakes import FakeConnectFactory


def _write_commit(table: Path, version: int, actions: list[dict[str, Any]]) -> None:
    log_dir = table / "_delta_log"
    log_dir.mkdir(parents=True, exist_ok=True)
    commit = log_dir / f"{version:020d}.json"
    commit.write_text(
        "".join(f"{json.dumps(action)}\n" for action in actions),
        encoding="utf-8",
    )


def test_delta_count_replays_adds_and_removes(tmp_path: Path) -> None:
    table = tmp_path / "gold" / "gold_store_hourly_metrics"
    _write_commit(
        table,
        0,
        [
            {"add": {"path": "part-0.parquet", "stats": json.dumps({"numRecords": 5})}},
            {"add": {"path": "part-1.parquet", "stats": json.dumps({"numRecords": 3})}},
        ],
    )
    _write_commit(table, 1, [{"remove": {"path": "part-0.parquet"}}])

    assert delta_table_row_count(table) == 3
    assert delta_layer_counts(tmp_path)["gold"] == {"gold_store_hourly_metrics": 3}


def test_delta_count_falls_back_to_zero_when_num_records_is_missing(tmp_path: Path) -> None:
    table = tmp_path / "bronze" / "bronze_orders"
    _write_commit(table, 0, [{"add": {"path": "part-0.parquet"}}])

    assert delta_table_row_count(table) == 0


def test_every_gold_node_has_a_path_from_raw(tmp_path: Path) -> None:
    raw_counts = FakeConnectFactory(
        columns=["table_name", "row_count"],
        rows=[{"table_name": "orders", "row_count": 12}],
    )
    lineage = build_catalog_lineage(connect_factory=raw_counts, data_root=tmp_path)
    reverse_edges: dict[str, set[str]] = {}
    for edge in lineage.edges:
        reverse_edges.setdefault(edge.target, set()).add(edge.source)

    def reaches_raw(node_id: str, seen: set[str] | None = None) -> bool:
        if node_id.startswith("raw."):
            return True
        visited = set() if seen is None else seen
        if node_id in visited:
            return False
        visited.add(node_id)
        return any(reaches_raw(parent, visited) for parent in reverse_edges.get(node_id, set()))

    gold_nodes = [node for node in lineage.nodes if node.layer == "gold"]
    assert gold_nodes
    assert all(reaches_raw(node.id) for node in gold_nodes)
    assert next(node for node in lineage.nodes if node.id == "raw.orders").row_count == 12
