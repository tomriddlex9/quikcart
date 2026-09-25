"""Read-only SQL guards for the console SQL endpoints (kit/02 AR-002).

Two sibling validators with one result shape:

- ``guard_lakehouse_sql`` delegates to
  ``quickcart.agents.tools.validate_readonly_sql`` so the console and the
  Phase 13 agent share exactly one silver_*/gold_* guard — the analytical
  allow-list is never re-implemented here.
- ``guard_postgres_sql`` is the operational-database sibling. It repeats the
  same defence layers (comment stripping that honours string literals,
  stacked-statement rejection, SELECT-only start keyword, keyword blocklist,
  table allow-list, LIMIT cap) over a fixed list of ``public`` operational
  tables, and adds the Postgres-specific syntax a Spark guard never has to
  think about: quoted identifiers, dollar quoting, escape strings, locking
  clauses and filesystem/administrative functions are refused outright rather
  than parsed.

The guard is only the first of two defences. Postgres execution additionally
runs inside a READ ONLY transaction with a statement timeout
(:mod:`quickcart.api.sql_service`), so a statement that somehow slipped past
these regexes still cannot write.
"""

import re
from dataclasses import dataclass

from quickcart.agents.tools import SQL_ROW_CAP, ToolError, validate_readonly_sql

SOURCES = ("postgres", "lakehouse")

# Operational tables the console may read (kit/04 core schema + Phase 14 tables).
POSTGRES_TABLES: frozenset[str] = frozenset(
    {
        "stores",
        "customers",
        "customer_addresses",
        "products",
        "product_prices",
        "inventory",
        "inventory_movements",
        "riders",
        "promotions",
        "orders",
        "order_items",
        "payments",
        "deliveries",
        "support_tickets",
        "proposals",
        "proposal_audit",
    }
)

# Mutating/DDL/transaction-control words. Deliberately excludes words that are
# plausible column names in this schema (e.g. `value`, `status`, `comment`) so
# the blocklist never rejects a legitimate projection.
_PG_BLOCKED_WORDS = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "GRANT",
    "REVOKE",
    "TRUNCATE",
    "MERGE",
    "UPSERT",
    "COPY",
    "VACUUM",
    "ANALYZE",
    "CLUSTER",
    "REINDEX",
    "REFRESH",
    "LOCK",
    "SET",
    "RESET",
    "SHOW",
    "EXPLAIN",
    "DO",
    "CALL",
    "EXECUTE",
    "PREPARE",
    "DEALLOCATE",
    "DECLARE",
    "LISTEN",
    "UNLISTEN",
    "NOTIFY",
    "DISCARD",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT",
    "INTO",
    "RETURNING",
    "TABLE",  # DDL-flavoured `TABLE x`; FROM/JOIN references are allow-listed below
)
# Functions that read the server filesystem, stall the backend, reach out over
# the network, or move sequences — all read-only in SQL terms, none acceptable.
_PG_BLOCKED_FUNCTIONS = (
    "pg_sleep",
    "pg_sleep_for",
    "pg_sleep_until",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "pg_stat_file",
    "pg_reload_conf",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_logical_emit_message",
    "pg_create_restore_point",
    "lo_import",
    "lo_export",
    "dblink",
    "dblink_exec",
    "nextval",
    "setval",
    "currval",
    "query_to_xml",
)

_PG_BLOCKED_RE = re.compile(r"\b(" + "|".join(_PG_BLOCKED_WORDS) + r")\b", re.IGNORECASE)
_PG_BLOCKED_FUNCTION_RE = re.compile(
    r"\b(" + "|".join(_PG_BLOCKED_FUNCTIONS) + r")\s*\(", re.IGNORECASE
)
_LOCKING_RE = re.compile(
    r"\bfor\s+(?:update|share|no\s+key\s+update|key\s+share)\b", re.IGNORECASE
)
_ESCAPE_STRING_RE = re.compile(r"(?:\bE|\bU&)'", re.IGNORECASE)
_TABLE_REF_RE = re.compile(
    r"\b(?:from|join)\s+((?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?[A-Za-z_][A-Za-z0-9_]*)",
    re.IGNORECASE,
)
# EXTRACT / SUBSTRING / TRIM use "FROM" inside a function call — not a table ref.
_PSEUDO_FROM_FN_RE = re.compile(
    r"\b(?:extract|substring|substr|trim|overlay)\s*\([^)]*\)",
    re.IGNORECASE | re.DOTALL,
)
_CTE_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(", re.IGNORECASE)
_LIMIT_RE = re.compile(r"\blimit\s+(\d+)", re.IGNORECASE)
_START_RE = re.compile(r"\s*(?:select|with)\b", re.IGNORECASE)


class SqlGuardError(Exception):
    """A statement was refused before execution; ``detail`` is user-facing."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class GuardedSql:
    """A statement cleared for read-only execution.

    ``row_cap`` is the number of rows the caller may keep; ``limit_is_explicit``
    records whether the LIMIT came from the user (their own bound) or from this
    guard (a cap the caller must report as ``truncated`` when the result fills
    it).
    """

    sql: str
    tables: list[str]
    row_cap: int
    limit_is_explicit: bool
    source: str


def resolve_row_cap(limit: int | None) -> int:
    """Effective row cap: the request limit when smaller, else the hard cap."""
    if limit is None:
        return SQL_ROW_CAP
    if limit < 1:
        raise SqlGuardError(f"limit must be positive, got {limit}")
    return min(limit, SQL_ROW_CAP)


def _scan(sql: str) -> tuple[str, str]:
    """Strip comments and mask string contents; return ``(cleaned, masked)``.

    ``cleaned`` is the executable statement with every comment replaced by a
    space. ``masked`` is the safety view used for all keyword/table/LIMIT
    scanning: the *contents* of single-quoted literals are blanked (quotes
    kept) so ``'DELETE'`` is treated as data. Postgres block comments nest, so
    depth is tracked rather than searching for the first ``*/``. Syntax this
    scanner cannot mask safely (double-quoted identifiers, dollar quoting) is
    rejected by the caller.
    """
    out: list[str] = []
    masked: list[str] = []
    depth = 0
    in_string = False
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if depth:
            if ch == "/" and nxt == "*":
                depth += 1
                i += 2
                continue
            if ch == "*" and nxt == "/":
                depth -= 1
                i += 2
                continue
            i += 1
            continue
        if in_string:
            out.append(ch)
            masked.append(ch if ch == "'" else " ")
            if ch == "'":
                if nxt == "'":  # doubled quote = escaped quote, still inside
                    out.append(nxt)
                    masked.append(" ")
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            out.append(ch)
            masked.append(ch)
            i += 1
            continue
        if ch == "-" and nxt == "-":
            out.append(" ")
            masked.append(" ")
            i += 2
            while i < n and sql[i] != "\n":
                i += 1
            continue
        if ch == "/" and nxt == "*":
            depth = 1
            out.append(" ")
            masked.append(" ")
            i += 2
            continue
        out.append(ch)
        masked.append(ch)
        i += 1
    if depth:
        raise SqlGuardError("unterminated block comment; statement rejected")
    if in_string:
        raise SqlGuardError("unterminated string literal; statement rejected")
    masked_sql = "".join(masked)
    segments = masked_sql.split(";")
    if len(segments) > 2 or (len(segments) == 2 and segments[1].strip()):
        raise SqlGuardError("multiple statements are not allowed; submit one SELECT")
    return "".join(out).strip().rstrip(";"), masked_sql


def _reject_unsupported_syntax(masked: str) -> None:
    """Refuse Postgres syntax the scanner cannot mask, or that bypasses checks."""
    if '"' in masked:
        raise SqlGuardError(
            'double-quoted identifiers are not supported; write table and column'
            " names unquoted"
        )
    if "$" in masked:
        raise SqlGuardError("dollar-quoted strings and placeholders are not allowed")
    if _ESCAPE_STRING_RE.search(masked):
        raise SqlGuardError("escape string syntax (E'...' / U&'...') is not allowed")
    if _LOCKING_RE.search(masked):
        raise SqlGuardError("row locking clauses (FOR UPDATE/FOR SHARE) are not allowed")


def _normalize_table_ref(reference: str) -> str:
    """Return the bare table name; only the ``public`` schema may be qualified."""
    parts = [part.strip().lower() for part in reference.split(".")]
    if len(parts) == 1:
        return parts[0]
    schema, table = parts
    if schema != "public":
        raise SqlGuardError(
            f"schema {schema!r} is not readable; only public operational tables are allowed"
        )
    return table


def guard_postgres_sql(sql: str, limit: int | None = None) -> GuardedSql:
    """Validate one read-only SELECT against the operational Postgres tables."""
    row_cap = resolve_row_cap(limit)
    cleaned, masked = _scan(sql)
    if not _START_RE.match(masked):
        raise SqlGuardError("only a single SELECT (or WITH ... SELECT) statement is allowed")
    _reject_unsupported_syntax(masked)
    if hit := _PG_BLOCKED_RE.search(masked):
        raise SqlGuardError(
            f"statement contains forbidden keyword {hit.group(1).upper()!r};"
            " the SQL console may only run read-only SELECTs"
        )
    if hit := _PG_BLOCKED_FUNCTION_RE.search(masked):
        raise SqlGuardError(f"function {hit.group(1).lower()!r} is not allowed")
    table_scan = _PSEUDO_FROM_FN_RE.sub(" ", masked)
    references = [m.group(1) for m in _TABLE_REF_RE.finditer(table_scan)]
    if not references:
        raise SqlGuardError("statement must reference at least one operational table")
    cte_names = {m.group(1).lower() for m in _CTE_RE.finditer(table_scan)}
    physical: list[str] = []
    for reference in references:
        table = _normalize_table_ref(reference)
        if table in cte_names:
            continue  # reference to a CTE defined inside this same statement
        if table not in POSTGRES_TABLES:
            raise SqlGuardError(
                f"table {table!r} is not on the operational allow-list "
                f"({', '.join(sorted(POSTGRES_TABLES))})"
            )
        physical.append(table)
    if not physical:
        raise SqlGuardError("statement must reference at least one operational table")
    limits = [int(m.group(1)) for m in _LIMIT_RE.finditer(masked)]
    if len(limits) > 1:
        raise SqlGuardError("multiple LIMIT clauses are not allowed")
    if limits and limits[0] > SQL_ROW_CAP:
        raise SqlGuardError(f"LIMIT {limits[0]} exceeds the hard cap of {SQL_ROW_CAP}")
    final_sql = cleaned if limits else f"{cleaned} LIMIT {row_cap}"
    return GuardedSql(
        sql=final_sql,
        tables=physical,
        row_cap=row_cap,
        limit_is_explicit=bool(limits),
        source="postgres",
    )


def guard_lakehouse_sql(sql: str, limit: int | None = None) -> GuardedSql:
    """Validate one read-only SELECT over silver_*/gold_* Delta tables.

    The allow-list, keyword scan and hard row cap are the agent's
    ``validate_readonly_sql``; only the request-level row cap is layered on
    top. When the caller asked for fewer rows than the hard cap and the user
    wrote no LIMIT, the appended cap is lowered so Spark does not collect rows
    the response would discard.
    """
    row_cap = resolve_row_cap(limit)
    try:
        validated, tables = validate_readonly_sql(sql)
    except ToolError as exc:
        raise SqlGuardError(str(exc)) from exc
    # Only the `truncated` flag and the appended cap depend on this check, so a
    # plain regex (rather than the masked scan) is accurate enough here.
    limit_is_explicit = bool(_LIMIT_RE.search(sql))
    appended = f" LIMIT {SQL_ROW_CAP}"
    if not limit_is_explicit and row_cap < SQL_ROW_CAP and validated.endswith(appended):
        validated = f"{validated[: -len(appended)]} LIMIT {row_cap}"
    return GuardedSql(
        sql=validated,
        tables=tables,
        row_cap=row_cap,
        limit_is_explicit=limit_is_explicit,
        source="lakehouse",
    )


def guard_sql(source: str, sql: str, limit: int | None = None) -> GuardedSql:
    """Dispatch to the validator for ``source`` (``postgres`` or ``lakehouse``)."""
    if source == "postgres":
        return guard_postgres_sql(sql, limit)
    if source == "lakehouse":
        return guard_lakehouse_sql(sql, limit)
    raise SqlGuardError(f"unknown source {source!r}; expected one of {', '.join(SOURCES)}")


def apply_row_cap(
    rows: list[dict], guarded: GuardedSql
) -> tuple[list[dict], bool]:
    """Trim ``rows`` to the guard's cap and report whether the cap bound it.

    ``truncated`` is True when rows were dropped, and also when a cap *this
    guard* imposed was exactly filled — more rows may exist upstream. A LIMIT
    the user wrote themselves is their own bound and is never reported as
    truncation.
    """
    if len(rows) > guarded.row_cap:
        return rows[: guarded.row_cap], True
    return rows, not guarded.limit_is_explicit and len(rows) == guarded.row_cap
