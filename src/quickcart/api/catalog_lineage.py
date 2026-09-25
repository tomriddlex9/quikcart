"""Build live catalog lineage from the static topology and storage counts.

Delta counts are reconstructed from ``add`` and ``remove`` actions in JSON
transaction-log commits. This keeps the endpoint lightweight and avoids
starting Spark. Tables whose active files do not expose ``stats.numRecords``
degrade to a count of zero rather than reporting an invented partial count.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import structlog
from psycopg.rows import dict_row

from quickcart.api.lineage_map import lineage_edges, lineage_nodes
from quickcart.db.connection import connect
from quickcart.lakehouse.common.paths import data_root as resolve_data_root
from quickcart.live.contracts import CatalogLineage

log = structlog.get_logger(__name__)

DELTA_LAYERS = ("bronze", "silver", "gold", "quarantine")
RAW_TABLES = (
    "stores",
    "customers",
    "products",
    "inventory",
    "orders",
    "order_items",
    "payments",
    "deliveries",
    "riders",
    "pipeline_status",
)

_POSTGRES_COUNTS_SQL = "\nUNION ALL\n".join(
    f"SELECT '{table}' AS table_name, count(*)::bigint AS row_count FROM {table}"
    for table in RAW_TABLES
)


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def postgres_row_counts(
    connect_factory: Callable[..., psycopg.Connection] = connect,
) -> dict[str, int]:
    """Return exact counts for raw operational tables in one read-only query."""
    with connect_factory() as conn:
        conn.read_only = True
        with conn.transaction(), conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_POSTGRES_COUNTS_SQL)
            rows = cursor.fetchall()
    return {str(row["table_name"]): int(row["row_count"]) for row in rows}


def _num_records(add: dict[str, Any]) -> int | None:
    stats = add.get("stats")
    if isinstance(stats, str):
        try:
            stats = json.loads(stats)
        except json.JSONDecodeError:
            return None
    if not isinstance(stats, dict):
        return None
    value = stats.get("numRecords")
    if isinstance(value, bool):
        return None
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    return count if count >= 0 else None


def delta_table_row_count(table_path: Path) -> int:
    """Replay JSON Delta actions and return the current logical row count.

    A zero result is the documented no-Spark fallback for absent logs,
    checkpoint-only history, malformed commits, or active files without
    ``numRecords`` statistics.
    """
    log_dir = table_path / "_delta_log"
    if not log_dir.is_dir():
        return 0

    active_files: dict[str, int | None] = {}
    unreadable = False
    for commit in sorted(log_dir.glob("*.json")):
        try:
            lines = commit.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            log.warning("live.delta_commit_unreadable", commit=str(commit), error=str(exc))
            return 0
        for line in lines:
            try:
                action = json.loads(line)
            except json.JSONDecodeError:
                unreadable = True
                continue
            add = action.get("add")
            if isinstance(add, dict) and isinstance(add.get("path"), str):
                active_files[add["path"]] = _num_records(add)
            remove = action.get("remove")
            if isinstance(remove, dict) and isinstance(remove.get("path"), str):
                active_files.pop(remove["path"], None)

    if unreadable or any(count is None for count in active_files.values()):
        return 0
    return sum(count for count in active_files.values() if count is not None)


def delta_layer_counts(root: Path | None = None) -> dict[str, dict[str, int]]:
    """Count every local Delta table, grouped by medallion layer."""
    resolved = resolve_data_root(root)
    counts: dict[str, dict[str, int]] = {layer: {} for layer in DELTA_LAYERS}
    for layer in DELTA_LAYERS:
        layer_path = resolved / layer
        if not layer_path.is_dir():
            continue
        for table in sorted(path for path in layer_path.iterdir() if path.is_dir()):
            if (table / "_delta_log").is_dir():
                counts[layer][table.name] = delta_table_row_count(table)
    return counts


def build_catalog_lineage(
    *,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    data_root: Path | None = None,
    generated_at: datetime | None = None,
) -> CatalogLineage:
    """Combine static lineage topology with current Postgres and Delta counts."""
    try:
        raw_counts = postgres_row_counts(connect_factory)
    except psycopg.Error as exc:
        log.warning("live.lineage_postgres_unavailable", error=str(exc))
        raw_counts = {}
    delta_counts = delta_layer_counts(data_root)

    populated = []
    for node in lineage_nodes():
        if node.layer == "raw":
            count = raw_counts.get(node.name, 0)
        else:
            count = delta_counts.get(node.layer, {}).get(node.name, 0)
        populated.append(node.model_copy(update={"row_count": count}))

    now = generated_at or datetime.now(UTC)
    return CatalogLineage(
        generated_at=_utc_iso(now),
        nodes=populated,
        edges=lineage_edges(),
    )
