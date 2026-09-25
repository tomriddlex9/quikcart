"""Data catalog reads for the console: raw PostgreSQL + Delta bronze/silver/gold.

Layers, and where their metadata comes from:

- ``raw`` — the operational PostgreSQL tables on the console allow-list
  (:data:`quickcart.api.sql_guard.POSTGRES_TABLES`). Columns and foreign keys
  come from ``information_schema``.
- ``bronze``/``silver``/``gold`` — Delta tables under the data root. Columns are
  read from the table's ``_delta_log`` metadata, which is a file read rather
  than a Spark job; a listing therefore never starts a Spark session. Spark is
  used only when a log read cannot produce a schema, and for row previews.

Postgres being down degrades a listing to the lakehouse half plus a note — it
never fabricates tables and never hides the failure.
"""

import json
import re
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import psycopg
import structlog
from psycopg.rows import dict_row

from quickcart.api.sql_guard import POSTGRES_TABLES
from quickcart.db.connection import connect
from quickcart.lakehouse.common.paths import data_root as resolve_data_root
from quickcart.lakehouse.common.paths import table_path

log = structlog.get_logger(__name__)

RAW_LAYER = "raw"
LAKEHOUSE_LAYERS = ("bronze", "silver", "gold")
CATALOG_LAYERS = (RAW_LAYER, *LAKEHOUSE_LAYERS)
PREVIEW_ROW_CAP = 500

# Delta table directory names are produced by our own pipelines; the pattern
# exists so a path segment from a URL can never escape the data root.
_TABLE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")

_COLUMNS_SQL = """
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND c.table_name = ANY(%s)
ORDER BY c.table_name, c.ordinal_position
"""

_FOREIGN_KEYS_SQL = """
SELECT kcu.table_name  AS from_table,
       kcu.column_name AS from_column,
       ccu.table_name  AS to_table,
       ccu.column_name AS to_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.constraint_schema = tc.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.constraint_schema = tc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND kcu.table_name = ANY(%s)
ORDER BY kcu.table_name, kcu.ordinal_position, ccu.column_name
"""


class CatalogError(Exception):
    """Catalog read failed; ``status_code``/``detail`` map straight onto HTTP."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _allow_listed() -> list[str]:
    return sorted(POSTGRES_TABLES)


def validate_layer(layer: str) -> str:
    if layer not in CATALOG_LAYERS:
        raise CatalogError(
            400, f"unknown layer {layer!r}; expected one of {', '.join(CATALOG_LAYERS)}"
        )
    return layer


def validate_table_name(layer: str, name: str) -> str:
    """Resolve a table name for ``layer`` against an allow-list/name pattern."""
    if layer == RAW_LAYER:
        if name not in POSTGRES_TABLES:
            raise CatalogError(
                404, f"table {name!r} is not on the operational allow-list"
            )
        return name
    if not _TABLE_NAME_RE.match(name):
        raise CatalogError(400, f"invalid table name {name!r}")
    return name


# --------------------------------------------------------------------------- #
# PostgreSQL (raw layer)
# --------------------------------------------------------------------------- #


def postgres_tables(
    connect_factory: Callable[..., psycopg.Connection] = connect,
) -> list[dict[str, Any]]:
    """Allow-listed public tables with their columns, from information_schema."""
    with connect_factory() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_COLUMNS_SQL, (_allow_listed(),))
        rows = cur.fetchall()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["table_name"], []).append(
            {
                "name": row["column_name"],
                "type": row["data_type"],
                "nullable": row["is_nullable"] == "YES",
            }
        )
    return [
        {"layer": RAW_LAYER, "name": name, "columns": columns, "location": f"public.{name}"}
        for name, columns in sorted(grouped.items())
    ]


def foreign_keys(
    connect_factory: Callable[..., psycopg.Connection] = connect,
) -> list[dict[str, str]]:
    """Single-column foreign keys between allow-listed tables.

    ``information_schema`` exposes composite keys as separate rows that this
    join cannot pair unambiguously; the core schema (kit/04) has none, and a
    composite key would show up here as one edge per column pair.
    """
    with connect_factory() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_FOREIGN_KEYS_SQL, (_allow_listed(),))
        rows = cur.fetchall()
    edges: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for row in rows:
        if row["to_table"] not in POSTGRES_TABLES:
            continue
        key = (row["from_table"], row["from_column"], row["to_table"], row["to_column"])
        if key in seen:
            continue
        seen.add(key)
        edges.append(
            {
                "from_table": row["from_table"],
                "from_column": row["from_column"],
                "to_table": row["to_table"],
                "to_column": row["to_column"],
            }
        )
    return edges


def preview_postgres(
    name: str,
    *,
    limit: int = 50,
    connect_factory: Callable[..., psycopg.Connection] = connect,
) -> dict[str, Any]:
    """Read the first ``limit`` rows of an allow-listed table, read-only.

    The table name is an allow-list member (never a raw request string) and the
    limit is an int, so the composed statement carries no user text; it still
    passes through the read-only guard and the READ ONLY transaction.
    """
    from quickcart.api.sql_service import SqlExecutionError, execute_postgres

    table = validate_table_name(RAW_LAYER, name)
    row_limit = _preview_limit(limit)
    # Read one extra row so `truncated` reports whether the table has more.
    fetch = min(row_limit + 1, PREVIEW_ROW_CAP)
    try:
        result = execute_postgres(
            f"SELECT * FROM {table} LIMIT {fetch}",
            limit=row_limit,
            connect_factory=connect_factory,
        )
    except SqlExecutionError as exc:
        raise CatalogError(exc.status_code, exc.detail) from exc
    return {
        "layer": RAW_LAYER,
        "name": table,
        "columns": result.columns,
        "rows": result.rows,
        "row_count": result.row_count,
        "truncated": result.truncated,
        "elapsed_ms": result.elapsed_ms,
        "source": "postgres",
    }


def _preview_limit(limit: int) -> int:
    if limit < 1:
        raise CatalogError(400, f"limit must be positive, got {limit}")
    return min(limit, PREVIEW_ROW_CAP)


# --------------------------------------------------------------------------- #
# Delta (bronze/silver/gold layers)
# --------------------------------------------------------------------------- #


def _delta_type_name(field_type: Any) -> str:
    if isinstance(field_type, str):
        return field_type
    if isinstance(field_type, dict):
        return str(field_type.get("type", "struct"))
    return str(field_type)


def delta_log_columns(path: Path) -> list[dict[str, Any]]:
    """Columns from the newest ``metaData`` action in the table's Delta log.

    Returns an empty list when no commit file carries a schema (for example a
    log truncated to checkpoints only); callers fall back to Spark.
    """
    log_dir = path / "_delta_log"
    if not log_dir.is_dir():
        return []
    for commit in sorted(log_dir.glob("*.json"), reverse=True):
        for line in reversed(commit.read_text(encoding="utf-8").splitlines()):
            if '"metaData"' not in line:
                continue
            try:
                action = json.loads(line)
                schema = json.loads(action["metaData"]["schemaString"])
            except (json.JSONDecodeError, KeyError, TypeError) as exc:
                log.warning("catalog.delta_log_unreadable", commit=str(commit), error=str(exc))
                continue
            return [
                {
                    "name": field["name"],
                    "type": _delta_type_name(field.get("type", "unknown")),
                    "nullable": bool(field.get("nullable", True)),
                }
                for field in schema.get("fields", [])
            ]
    return []


def _spark_columns(spark: Any, path: Path) -> list[dict[str, Any]]:
    schema = spark.read.format("delta").load(str(path)).schema
    return [
        {"name": field.name, "type": field.dataType.simpleString(), "nullable": field.nullable}
        for field in schema.fields
    ]


def delta_columns(path: Path, spark: Any | None = None) -> list[dict[str, Any]]:
    """Delta table columns: log metadata first, Spark only as a fallback."""
    columns = delta_log_columns(path)
    if columns or spark is None:
        return columns
    return _spark_columns(spark, path)


def _is_delta_table(path: Path) -> bool:
    return (path / "_delta_log").is_dir()


def delta_tables(
    data_root: Path | None = None, spark: Any | None = None
) -> list[dict[str, Any]]:
    """Every Delta table present under ``<data_root>/{bronze,silver,gold}``."""
    root = resolve_data_root(data_root)
    tables: list[dict[str, Any]] = []
    for layer in LAKEHOUSE_LAYERS:
        layer_dir = root / layer
        if not layer_dir.is_dir():
            continue
        for path in sorted(p for p in layer_dir.iterdir() if p.is_dir()):
            if not _is_delta_table(path):
                continue
            tables.append(
                {
                    "layer": layer,
                    "name": path.name,
                    "columns": delta_columns(path, spark),
                    "location": str(path),
                }
            )
    return tables


def preview_delta(
    layer: str,
    name: str,
    *,
    limit: int = 50,
    spark: Any,
    data_root: Path | None = None,
) -> dict[str, Any]:
    """Read the first ``limit`` rows of a Delta table through Spark."""
    from quickcart.api.sql_service import json_safe

    table = validate_table_name(layer, name)
    row_limit = _preview_limit(limit)
    path = table_path(layer, table, data_root)
    if not _is_delta_table(path):
        raise CatalogError(404, f"{layer} table {table!r} not found (looked in {path})")
    if spark is None:
        raise CatalogError(503, "Spark is not available for lakehouse previews")
    started = time.perf_counter()
    df = spark.read.format("delta").load(str(path))
    collected = [row.asDict(recursive=True) for row in df.limit(row_limit + 1).collect()]
    truncated = len(collected) > row_limit
    rows = [{str(k): json_safe(v) for k, v in row.items()} for row in collected[:row_limit]]
    return {
        "layer": layer,
        "name": table,
        "columns": list(df.columns),
        "rows": rows,
        "row_count": len(rows),
        "truncated": truncated,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
        "source": "lakehouse",
    }


# --------------------------------------------------------------------------- #
# Composed catalog views
# --------------------------------------------------------------------------- #


def list_tables(
    *,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    data_root: Path | None = None,
    spark: Any | None = None,
) -> dict[str, Any]:
    """All catalog tables (raw + lakehouse) with notes for anything unreachable."""
    notes: list[str] = []
    tables: list[dict[str, Any]] = []
    try:
        tables.extend(postgres_tables(connect_factory))
    except psycopg.Error as exc:
        log.warning("catalog.postgres_unavailable", error=str(exc))
        notes.append(f"raw layer unavailable: PostgreSQL error: {exc}")
    tables.extend(delta_tables(data_root, spark))
    if not any(table["layer"] in LAKEHOUSE_LAYERS for table in tables):
        notes.append(
            "no Delta tables under the data root; run the bronze/silver/gold pipeline"
        )
    return {"tables": tables, "notes": notes}


def preview_table(
    layer: str,
    name: str,
    *,
    limit: int = 50,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    spark: Any | None = None,
    data_root: Path | None = None,
) -> dict[str, Any]:
    """Preview rows for one table in ``layer`` (dispatches raw vs lakehouse)."""
    validate_layer(layer)
    if layer == RAW_LAYER:
        return preview_postgres(name, limit=limit, connect_factory=connect_factory)
    return preview_delta(layer, name, limit=limit, spark=spark, data_root=data_root)


def entity_relationships(
    connect_factory: Callable[..., psycopg.Connection] = connect,
) -> dict[str, Any]:
    """ER view of the operational schema: allow-listed tables and their FK edges."""
    try:
        tables = postgres_tables(connect_factory)
        edges = foreign_keys(connect_factory)
    except psycopg.Error as exc:
        log.warning("catalog.er_unavailable", error=str(exc))
        raise CatalogError(503, f"PostgreSQL is unavailable: {exc}") from exc
    return {
        "tables": [{"name": table["name"], "columns": table["columns"]} for table in tables],
        "edges": edges,
    }


def schema_summary(
    source: str,
    *,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    data_root: Path | None = None,
    spark: Any | None = None,
) -> tuple[str, list[str], list[str]]:
    """Prompt-sized schema text for SQL generation.

    Returns ``(schema_text, table_names, notes)``. The text lists only tables the
    guard would accept for ``source``, so a well-behaved model cannot be steered
    into a rejected statement by the prompt itself.
    """
    notes: list[str] = []
    if source == "postgres":
        try:
            tables = postgres_tables(connect_factory)
        except psycopg.Error as exc:
            log.warning("catalog.schema_summary_degraded", error=str(exc))
            notes.append(f"column names unavailable (PostgreSQL error: {exc})")
            tables = [
                {"name": name, "columns": []} for name in _allow_listed()
            ]
    else:
        tables = [
            table
            for table in delta_tables(data_root, spark)
            if table["layer"] in ("silver", "gold")
        ]
        if not tables:
            notes.append("no silver/gold Delta tables found under the data root")
    return _render_schema(tables), [table["name"] for table in tables], notes


def _render_schema(tables: Sequence[dict[str, Any]]) -> str:
    lines: list[str] = []
    for table in tables:
        columns = ", ".join(
            f"{column['name']} {column['type']}" for column in table.get("columns", [])
        )
        lines.append(f"- {table['name']}({columns})" if columns else f"- {table['name']}")
    return "\n".join(lines)
