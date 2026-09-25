"""Execution and generation adapters for the console SQL endpoints.

Two execution paths, both read-only and both bounded:

- ``execute_postgres`` runs the guarded statement inside a **READ ONLY**
  transaction with a ``statement_timeout``. The guard in
  :mod:`quickcart.api.sql_guard` is the first defence; this transaction is the
  one that cannot be regex-bypassed — PostgreSQL itself refuses a write.
- ``execute_lakehouse`` mirrors the agent's ``run_readonly_sql`` execution
  pattern (temp views per allow-listed Delta table, a named job group, a
  wall-clock deadline, ``cancelJobGroup`` on timeout).

``generate_sql`` is deliberately separate from execution: it asks the local
Ollama model for a *candidate* statement, validates it with the same guard, and
returns it. Nothing generated here is ever executed. When Ollama is unreachable
the result is a loud, degraded answer (never an exception dressed up as a
successful one).
"""

import contextlib
import json
import re
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from datetime import time as time_of_day
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import structlog
from psycopg.rows import dict_row

from quickcart.api.sql_guard import (
    GuardedSql,
    SqlGuardError,
    apply_row_cap,
    guard_lakehouse_sql,
    guard_postgres_sql,
)
from quickcart.db.connection import connect
from quickcart.lakehouse.common.paths import table_path

log = structlog.get_logger(__name__)

STATEMENT_TIMEOUT_SECONDS = 30.0
# qwen3 spends tokens on reasoning before it emits content, so too small a
# budget comes back empty. Measured locally with qwen3:4b on CPU: 700 tokens
# always returned an empty reply, 1600 answers in roughly one to two minutes,
# and 2400 runs past the client timeout in `agents.llm`. Generation is therefore
# a slow request by nature; whatever does not fit the budget degrades with a
# note instead of failing the call.
GENERATE_MAX_TOKENS = 1600

_FENCE_RE = re.compile(r"```(?:sql)?(.*?)```", re.IGNORECASE | re.DOTALL)
_THINK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
# A statement must start its own line: a model that answers in prose ("I cannot
# help with that") must not look like a `WITH` query. Non-SELECT verbs are
# matched on purpose so the guard rejects them with a reason instead of the
# reply being reported as "no SQL".
_STATEMENT_START_RE = re.compile(
    r"(?:^|\n)[ \t]*"
    r"(select|with|insert|update|delete|drop|alter|create|truncate|grant|merge|copy)\b",
    re.IGNORECASE,
)

GENERATE_SYSTEM_PROMPT = (
    "You are a SQL assistant for the QuickCart data platform. Translate the "
    "user's question into exactly ONE read-only SQL SELECT statement.\n"
    "Rules:\n"
    '- Reply with JSON only, shaped {"sql": "SELECT ..."}.\n'
    "- One statement. No semicolon-separated statements.\n"
    "- Read-only: never INSERT, UPDATE, DELETE, or any DDL.\n"
    "- Use only the tables and columns listed in the schema.\n"
    "- Always end with an explicit LIMIT of at most 500 rows.\n"
)


class SqlExecutionError(Exception):
    """Execution failed; ``status_code``/``detail`` map straight onto HTTP."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class SqlResult:
    """One console query result (the /api/v1/sql/execute response body)."""

    source: str
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
    elapsed_ms: float


@dataclass(frozen=True)
class GeneratedSql:
    """A candidate statement from the local model — never executed here."""

    source: str
    sql: str
    model: str | None
    valid: bool
    degraded: bool
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# JSON-safe row shaping (psycopg and Spark both hand back rich Python types)
# --------------------------------------------------------------------------- #


def json_safe(value: Any) -> Any:
    """Convert driver values into JSON-encodable ones without losing meaning.

    ``Decimal`` becomes ``float`` to match the rest of the API surface (the
    console renders and charts these; NUMERIC semantics stay in the database
    and in the pipelines). Anything unexpected degrades to ``str`` rather than
    failing serialization silently.
    """
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time_of_day)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    return str(value)


def _safe_rows(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{str(k): json_safe(v) for k, v in row.items()} for row in rows]


def _result(
    guarded: GuardedSql,
    columns: list[str],
    rows: list[dict[str, Any]],
    started: float,
) -> SqlResult:
    capped, truncated = apply_row_cap(_safe_rows(rows), guarded)
    return SqlResult(
        source=guarded.source,
        columns=columns,
        rows=capped,
        row_count=len(capped),
        truncated=truncated,
        elapsed_ms=round((time.perf_counter() - started) * 1000, 3),
    )


# --------------------------------------------------------------------------- #
# PostgreSQL (READ ONLY transaction + statement timeout)
# --------------------------------------------------------------------------- #


def execute_postgres(
    sql: str,
    *,
    limit: int | None = None,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    timeout_seconds: float = STATEMENT_TIMEOUT_SECONDS,
) -> SqlResult:
    """Run one guarded SELECT against PostgreSQL, read-only and time-bounded.

    Both guarantees are set on the server: ``connection.read_only`` makes
    psycopg open the transaction with ``BEGIN READ ONLY``, and ``SET LOCAL
    statement_timeout`` bounds it. A write that somehow passed the regex guard
    fails with ``25006 read_only_sql_transaction``.
    """
    guarded = guard_postgres_sql(sql, limit)
    timeout_ms = max(int(timeout_seconds * 1000), 1)
    started = time.perf_counter()
    try:
        with connect_factory() as conn:
            conn.read_only = True
            with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
                cur.execute(f"SET LOCAL statement_timeout = {timeout_ms}")
                cur.execute(guarded.sql)
                columns = [column.name for column in cur.description or ()]
                rows = cur.fetchall()
    except psycopg.errors.QueryCanceled as exc:
        log.warning("sql.postgres_timeout", timeout_ms=timeout_ms, sql=guarded.sql)
        raise SqlExecutionError(
            504, f"statement timed out after {timeout_seconds:.0f}s and was cancelled"
        ) from exc
    except psycopg.OperationalError as exc:
        log.warning("sql.postgres_unavailable", error=str(exc))
        raise SqlExecutionError(503, f"PostgreSQL is unavailable: {exc}") from exc
    except psycopg.Error as exc:
        log.warning("sql.postgres_rejected", sqlstate=exc.sqlstate, error=str(exc))
        raise SqlExecutionError(400, f"PostgreSQL rejected the statement: {exc}") from exc
    log.info(
        "sql.executed",
        source="postgres",
        tables=guarded.tables,
        row_count=len(rows),
    )
    return _result(guarded, columns, list(rows), started)


# --------------------------------------------------------------------------- #
# Lakehouse (Spark SQL over Delta, same pattern as the agent's tool)
# --------------------------------------------------------------------------- #


def _register_views(spark: Any, tables: Sequence[str], data_root: Path | None) -> None:
    for table in tables:
        layer = "silver" if table.startswith("silver_") else "gold"
        path = table_path(layer, table, data_root)
        if not path.exists():
            raise SqlExecutionError(404, f"table {table!r} is not built yet (looked in {path})")
        spark.read.format("delta").load(str(path)).createOrReplaceTempView(table)


def execute_lakehouse(
    sql: str,
    *,
    spark: Any,
    limit: int | None = None,
    data_root: Path | None = None,
    timeout_seconds: float = STATEMENT_TIMEOUT_SECONDS,
) -> SqlResult:
    """Run one guarded SELECT over silver_*/gold_* Delta tables via Spark SQL."""
    guarded = guard_lakehouse_sql(sql, limit)
    if spark is None:
        raise SqlExecutionError(503, "Spark is not available for lakehouse queries")
    _register_views(spark, guarded.tables, data_root)
    group = f"console_sql_{uuid4().hex}"
    spark.sparkContext.setJobGroup(group, "quickcart console sql/execute")
    box: dict[str, Any] = {}
    started = time.perf_counter()

    def _run() -> None:
        try:
            df = spark.sql(guarded.sql)
            box["columns"] = list(df.columns)
            box["rows"] = [row.asDict(recursive=True) for row in df.collect()]
        except Exception as exc:  # surfaced below; never swallowed
            box["error"] = exc

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(timeout_seconds)
    if worker.is_alive():
        spark.sparkContext.cancelJobGroup(group)
        log.warning("sql.lakehouse_timeout", timeout_seconds=timeout_seconds, sql=guarded.sql)
        raise SqlExecutionError(
            504, f"statement timed out after {timeout_seconds:.0f}s and was cancelled"
        )
    if (error := box.get("error")) is not None:
        log.warning("sql.lakehouse_rejected", error=str(error), sql=guarded.sql)
        raise SqlExecutionError(400, f"Spark rejected the statement: {error}")
    log.info(
        "sql.executed",
        source="lakehouse",
        tables=guarded.tables,
        row_count=len(box["rows"]),
    )
    return _result(guarded, box["columns"], box["rows"], started)


def execute_sql(
    source: str,
    sql: str,
    *,
    limit: int | None = None,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    spark: Any | None = None,
    data_root: Path | None = None,
    timeout_seconds: float = STATEMENT_TIMEOUT_SECONDS,
) -> SqlResult:
    """Dispatch to the execution adapter for ``source``."""
    if source == "postgres":
        return execute_postgres(
            sql,
            limit=limit,
            connect_factory=connect_factory,
            timeout_seconds=timeout_seconds,
        )
    if source == "lakehouse":
        return execute_lakehouse(
            sql,
            spark=spark,
            limit=limit,
            data_root=data_root,
            timeout_seconds=timeout_seconds,
        )
    raise SqlGuardError(f"unknown source {source!r}; expected 'postgres' or 'lakehouse'")


# --------------------------------------------------------------------------- #
# Natural language -> candidate SQL (local Ollama, generation only)
# --------------------------------------------------------------------------- #


def extract_sql(reply: str) -> str:
    """Pull the statement out of a model reply (JSON, fences, reasoning, prose).

    The prompt asks for ``{"sql": ...}`` because small local models stay on
    contract better in JSON mode, but a plain or fenced statement is accepted
    too — the guard, not the parser, decides whether the result is usable.
    """
    text = _THINK_RE.sub(" ", reply)
    with contextlib.suppress(json.JSONDecodeError, TypeError):
        payload = json.loads(text)
        if isinstance(payload, dict) and isinstance(payload.get("sql"), str):
            text = payload["sql"]
    if fence := _FENCE_RE.search(text):
        text = fence.group(1)
    match = _STATEMENT_START_RE.search(text)
    if match is None:
        return ""
    statement = text[match.start(1) :].strip()
    statement = statement.split(";")[0].strip()
    return " ".join(statement.split())


def heuristic_sql(question: str, tables: Sequence[str], row_cap: int = 50) -> str:
    """Offline fallback: preview the table whose name the question mentions."""
    asked = question.lower()
    matches = [table for table in tables if table.lower() in asked]
    if not matches:
        # `orders` should still match "how many order lines" — try the stem.
        matches = [table for table in tables if table.lower().rstrip("s") in asked]
    if not matches:
        return ""
    best = max(matches, key=len)
    return f"SELECT * FROM {best} LIMIT {row_cap}"


def _guard_for(source: str) -> Callable[[str], GuardedSql]:
    return guard_postgres_sql if source == "postgres" else guard_lakehouse_sql


def generate_sql(
    question: str,
    source: str,
    *,
    schema: str,
    tables: Sequence[str] = (),
    llm: Any | None = None,
    notes: Sequence[str] = (),
) -> GeneratedSql:
    """Ask the local model for one candidate SELECT; never execute it.

    Ollama being down is an expected local condition, not a server fault: the
    result carries ``degraded=True`` plus notes and a heuristic statement (or
    an empty one), so the console can still say something honest.
    """
    collected: list[str] = list(notes)
    if llm is None:
        try:
            from quickcart.agents.llm import OllamaLLM

            llm = OllamaLLM()
        except Exception as exc:  # model not configured / package missing
            log.warning("sql.generate_llm_unavailable", error=str(exc))
            collected.append(f"local model unavailable: {exc}")
            return GeneratedSql(
                source=source,
                sql=heuristic_sql(question, tables),
                model=None,
                valid=False,
                degraded=True,
                notes=collected,
            )
    model = getattr(llm, "model", None)
    messages = [
        {"role": "system", "content": GENERATE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Source: {source}\n\nSchema:\n{schema}\n\nQuestion: {question}\n\nSQL:"
            ),
        },
    ]
    try:
        reply = llm.chat(messages, json_mode=True, max_tokens=GENERATE_MAX_TOKENS)
    except Exception as exc:  # LLMError and any transport failure
        log.warning("sql.generate_failed", model=model, error=str(exc))
        collected.append(f"local model call failed: {exc}")
        return GeneratedSql(
            source=source,
            sql=heuristic_sql(question, tables),
            model=model,
            valid=False,
            degraded=True,
            notes=collected,
        )
    candidate = extract_sql(reply)
    if not candidate:
        collected.append("the model returned no SQL statement")
        return GeneratedSql(
            source=source,
            sql=heuristic_sql(question, tables),
            model=model,
            valid=False,
            degraded=False,
            notes=collected,
        )
    try:
        guarded = _guard_for(source)(candidate)
    except SqlGuardError as exc:
        log.info("sql.generate_rejected", model=model, detail=exc.detail)
        collected.append(f"candidate rejected by the read-only guard: {exc.detail}")
        return GeneratedSql(
            source=source,
            sql=candidate,
            model=model,
            valid=False,
            degraded=False,
            notes=collected,
        )
    return GeneratedSql(
        source=source,
        sql=guarded.sql,
        model=model,
        valid=True,
        degraded=False,
        notes=collected,
    )
