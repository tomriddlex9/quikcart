"""Typed, bounded agent tools (kit/03 §13.2, kit/02 AR-001/002/004, kit/05 §14).

Design rules:

- Every tool takes Pydantic-validated arguments; validation failures raise
  `ToolError` with the reason — never silently coerced.
- Tool results are plain dicts shaped for grounding: ``ok``, ``summary``,
  and an ``evidence`` fact bundle the answer node may cite. Hard backend
  failures raise `ToolError`; soft "nothing found" outcomes stay facts
  (``found: False`` / ``supported: False``) so the answer can state them.
- Backends are injected through `ToolDeps` behind small protocols, so the
  offline evaluation suite and unit tests run with fakes — no Spark, no
  Qdrant, no PostgreSQL, no Ollama.
- `create_restock_proposal` delegates to `quickcart.api.proposals.ProposalService`
  and can only *create* a PENDING proposal — execution requires human
  approval in Phase 14 and never happens here (AR-006).
- `run_readonly_sql` is the single raw-SQL escape hatch: one allow-listed,
  row-capped, timed-out SELECT, validated by `validate_readonly_sql` without
  extra dependencies (kit/03 §13.3).
"""

import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field, ValidationError

from quickcart.lakehouse.common.paths import table_path

logger = structlog.get_logger(__name__)

# --- caps (kit/02 AR-004: large results aggregated/paginated before the LLM) ---
SQL_ROW_CAP = 500
TOOL_ROW_CAP = 50
RESULT_CHAR_CAP = 20_000

# Analytics + prediction tables the read-only SQL tool may touch (kit/02 AR-002).
SQL_TABLE_PATTERN = re.compile(r"^(silver|gold)_[a-z][a-z0-9_]*$")


class ToolError(Exception):
    """A tool refused to run or its backend failed; the graph degrades on these."""


# --------------------------------------------------------------------------- #
# Argument schemas (kit/03 §13.2 — typed tools with Pydantic)
# --------------------------------------------------------------------------- #


class GetStoreMetricsArgs(BaseModel):
    store_id: int = Field(gt=0)


class GetKpiSummaryArgs(BaseModel):
    pass


class GetInventoryRiskArgs(BaseModel):
    store_id: int | None = Field(default=None, gt=0)


class GetDeliveryPredictionArgs(BaseModel):
    order_id: int = Field(gt=0)


class GetDemandForecastArgs(BaseModel):
    store_id: int = Field(gt=0)
    category: str | None = Field(default=None, min_length=1)


class ListActiveAnomaliesArgs(BaseModel):
    store_id: int | None = Field(default=None, gt=0)


class SearchCompanyDocsArgs(BaseModel):
    query: str = Field(min_length=1)


class CreateRestockProposalArgs(BaseModel):
    store_id: int = Field(gt=0)
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0)
    reason: str = Field(min_length=1)
    evidence: list[str] = Field(default_factory=list)


class RunReadonlySqlArgs(BaseModel):
    sql: str = Field(min_length=1)


# --------------------------------------------------------------------------- #
# Backend protocols (structural — real objects and fakes both satisfy these)
# --------------------------------------------------------------------------- #


class SupportsGoldReads(Protocol):
    def kpi_summary(self) -> dict: ...
    def store_comparison(self) -> Any: ...
    def store_hourly(self, store_id: int) -> Any: ...
    def inventory_risk(self, limit: int = 50) -> Any: ...


class SupportsGroundedSearch(Protocol):
    def grounded_search(self, query: str, k: int = 5) -> Any: ...


class SupportsProposalCreate(Protocol):
    def create(self, body: Any) -> dict: ...


@dataclass(frozen=True)
class ToolDeps:
    """Injectable backends. `sql_runner` overrides Spark execution (tests/eval)."""

    readers: SupportsGoldReads | None = None
    retriever: SupportsGroundedSearch | None = None
    proposal_service: SupportsProposalCreate | None = None
    spark: Any | None = None
    data_root: Path | None = None
    sql_runner: Callable[[str], list[dict[str, Any]]] | None = None
    sql_timeout_seconds: float = 30.0


# --------------------------------------------------------------------------- #
# JSON-safe result shaping (evidence must serialize into the trace + API)
# --------------------------------------------------------------------------- #


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _ok(summary: str, evidence: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True, "summary": summary}
    if evidence is not None:
        result["evidence"] = _json_safe(evidence)
    result.update(_json_safe(extra))
    return result


def _cap_rows(rows: list[dict[str, Any]], cap: int) -> list[dict[str, Any]]:
    if len(rows) <= cap:
        return rows
    return rows[:cap]


# --------------------------------------------------------------------------- #
# SQL guard (kit/03 §13.3 / kit/02 AR-002) — strict validation, no new deps
# --------------------------------------------------------------------------- #

_BLOCKED_WORDS = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "GRANT",
    "TRUNCATE",
    "MERGE",
    "REPLACE",
    "UPSERT",
    "VACUUM",
    "ANALYZE",
    "ATTACH",
    "DETACH",
    "CALL",
    "COPY",
    "EXPORT",
    "IMPORT",
    "SET",
    "RESET",
    "USE",
    "SHOW",
    "DESCRIBE",
    "INTO",
    "TABLE",  # DDL-flavoured `TABLE x`; real FROM/JOIN references are allow-listed below
)
_BLOCKED_RE = re.compile(r"\b(" + "|".join(_BLOCKED_WORDS) + r")\b", re.IGNORECASE)
_TABLE_REF_RE = re.compile(r"\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE)
_CTE_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(", re.IGNORECASE)
_LIMIT_RE = re.compile(r"\blimit\s+(\d+)", re.IGNORECASE)
_START_RE = re.compile(r"\s*(select|with)\b", re.IGNORECASE)


def _strip_comments_and_scan(sql: str) -> tuple[str, str]:
    """Strip comments and mask string literals; return `(cleaned, masked)`.

    `cleaned` is the executable SQL with every comment replaced by a space.
    `masked` is the safety view used for keyword/table/LIMIT scanning: string
    literal *contents* are blanked (quotes kept) so `'DELETE'` inside a
    literal is treated as data, not syntax. Raises `ToolError` on an
    unterminated block comment — a classic bypass attempt — or on stacked
    statements (`;` outside string literals with trailing content).
    """
    out: list[str] = []
    masked: list[str] = []
    i = 0
    n = len(sql)
    in_string = False
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
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
            end = sql.find("*/", i + 2)
            if end == -1:
                raise ToolError("unterminated block comment; statement rejected")
            out.append(" ")
            masked.append(" ")
            i = end + 2
            continue
        out.append(ch)
        masked.append(ch)
        i += 1
    cleaned = "".join(out)
    if in_string:
        raise ToolError("unterminated string literal; statement rejected")
    # Stacked-statement check on the safety view: `;` inside string literals
    # is data and cannot smuggle a second statement past this.
    segments = "".join(masked).split(";")
    if len(segments) > 2 or (len(segments) == 2 and segments[1].strip()):
        raise ToolError("multiple statements are not allowed; submit one SELECT")
    return cleaned.strip().rstrip(";"), "".join(masked)


def validate_readonly_sql(sql: str) -> tuple[str, list[str]]:
    """Validate one read-only SELECT; return `(sql_with_limit, tables)`.

    Defence layers, in order:
    1. comment stripping that honours string literals (comments cannot smuggle
       keywords or statement separators past the checks below);
    2. stacked-statement rejection;
    3. SELECT-only start keyword;
    4. whole-word blocklist scan outside string literals (mutating/DDL words
       like DELETE or `SELECT ... INTO`);
    5. table allow-list: every FROM/JOIN reference must match silver_*/gold_*;
    6. LIMIT <= SQL_ROW_CAP, appended when absent.
    """
    cleaned, masked = _strip_comments_and_scan(sql)
    if not _START_RE.match(masked):
        raise ToolError("only a single SELECT statement is allowed")
    hit = _BLOCKED_RE.search(masked)
    if hit:
        raise ToolError(
            f"statement contains forbidden keyword {hit.group(1).upper()!r};"
            " the agent may only run read-only SELECTs"
        )
    tables = [m.group(1) for m in _TABLE_REF_RE.finditer(masked)]
    if not tables:
        raise ToolError("statement must reference at least one silver_*/gold_* table")
    cte_names = {m.group(1).lower() for m in _CTE_RE.finditer(masked)}
    for table in tables:
        if table.lower() in cte_names:
            continue  # reference to a CTE defined inside this same statement
        if not SQL_TABLE_PATTERN.match(table):
            raise ToolError(f"table {table!r} is not on the silver_*/gold_* allow-list")
    physical_tables = [t for t in tables if t.lower() not in cte_names]
    if not physical_tables:
        raise ToolError("statement must reference at least one silver_*/gold_* table")
    limits = [int(m.group(1)) for m in _LIMIT_RE.finditer(masked)]
    if len(limits) > 1:
        raise ToolError("multiple LIMIT clauses are not allowed")
    if limits and limits[0] > SQL_ROW_CAP:
        raise ToolError(f"LIMIT {limits[0]} exceeds the hard cap of {SQL_ROW_CAP}")
    final_sql = cleaned if limits else f"{cleaned} LIMIT {SQL_ROW_CAP}"
    return final_sql, physical_tables


def _spark_sql(deps: ToolDeps, sql: str, tables: list[str]) -> list[dict[str, Any]]:
    """Execute the validated SELECT against Delta tables via Spark SQL.

    Views are registered per referenced allow-listed table, the job runs under
    a named group with a wall-clock deadline, and the group is cancelled on
    timeout (kit/03 §13.3 — statement timeout).
    """
    spark = deps.spark
    if spark is None:
        raise ToolError("spark backend not configured for run_readonly_sql")
    for table in tables:
        layer = "silver" if table.startswith("silver_") else "gold"
        path = table_path(layer, table, deps.data_root)
        if not path.exists():
            raise ToolError(f"table {table!r} not found under {path}")
        spark.read.format("delta").load(str(path)).createOrReplaceTempView(table)
    group = f"agent_sql_{uuid4().hex}"
    spark.sparkContext.setJobGroup(group, "quickcart agent run_readonly_sql")
    box: dict[str, Any] = {}

    def _run() -> None:
        box["rows"] = [row.asDict() for row in spark.sql(sql).collect()]

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(deps.sql_timeout_seconds)
    if worker.is_alive():
        spark.sparkContext.cancelJobGroup(group)
        raise ToolError(
            f"statement timed out after {deps.sql_timeout_seconds:.0f}s and was cancelled"
        )
    rows = box["rows"]
    return _cap_rows(rows, SQL_ROW_CAP)


# --------------------------------------------------------------------------- #
# Tool implementations
# --------------------------------------------------------------------------- #


def _get_store_metrics(deps: ToolDeps, args: GetStoreMetricsArgs) -> dict[str, Any]:
    if deps.readers is None:
        raise ToolError("gold readers backend not configured")
    from pyspark.sql import functions as F

    comparison = deps.readers.store_comparison().filter(F.col("store_id") == args.store_id)
    row = comparison.first()
    hourly = deps.readers.store_hourly(args.store_id)
    latest = [r.asDict() for r in hourly.orderBy(F.desc("metric_hour")).limit(6).collect()]
    if row is None and not latest:
        return _ok(
            f"store {args.store_id}: no Gold metrics found",
            {"type": "metric", "store_id": args.store_id, "found": False},
        )
    facts = {
        "type": "metric",
        "store_id": args.store_id,
        "found": True,
        "comparison": row.asDict() if row is not None else None,
        "latest_hours": latest,
    }
    return _ok(f"store {args.store_id}: {len(latest)} latest hourly metric rows", facts)


def _get_kpi_summary(deps: ToolDeps, args: GetKpiSummaryArgs) -> dict[str, Any]:
    if deps.readers is None:
        raise ToolError("gold readers backend not configured")
    facts = {"type": "metric", "scope": "all_stores", **deps.readers.kpi_summary()}
    return _ok("headline KPIs across all stores", facts)


def _get_inventory_risk(deps: ToolDeps, args: GetInventoryRiskArgs) -> dict[str, Any]:
    if deps.readers is None:
        raise ToolError("gold readers backend not configured")
    from pyspark.sql import functions as F

    df = deps.readers.inventory_risk(limit=TOOL_ROW_CAP)
    if args.store_id is not None:
        df = df.filter(F.col("store_id") == args.store_id)
    rows = _cap_rows([r.asDict() for r in df.collect()], TOOL_ROW_CAP)
    facts = {
        "type": "metric",
        "store_id": args.store_id,
        "risk_skus": rows,
        "row_count": len(rows),
        "capped_at": TOOL_ROW_CAP,
    }
    return _ok(f"inventory risk: {len(rows)} SKU row(s) below reorder point", facts)


def _read_gold_row(deps: ToolDeps, table: str, key: str, value: int) -> dict[str, Any] | None:
    if deps.spark is None:
        raise ToolError("spark backend not configured")
    path = table_path("gold", table, deps.data_root)
    if not path.exists():
        raise ToolError(f"{table} not built yet (run the Phase 11 models first)")
    from pyspark.sql import functions as F

    df = deps.spark.read.format("delta").load(str(path))
    row = df.filter(F.col(key) == value).first()
    return row.asDict() if row is not None else None


def _get_delivery_prediction(deps: ToolDeps, args: GetDeliveryPredictionArgs) -> dict[str, Any]:
    row = _read_gold_row(deps, "gold_delivery_predictions", "order_id", args.order_id)
    if row is None:
        return _ok(
            f"order {args.order_id}: no persisted delivery prediction",
            {"type": "prediction", "order_id": args.order_id, "found": False},
        )
    facts = {"type": "prediction", "order_id": args.order_id, "found": True, "prediction": row}
    return _ok(f"order {args.order_id}: persisted late-risk prediction retrieved", facts)


def _get_demand_forecast(deps: ToolDeps, args: GetDemandForecastArgs) -> dict[str, Any]:
    if deps.spark is None:
        raise ToolError("spark backend not configured")
    path = table_path("gold", "gold_demand_forecasts", deps.data_root)
    if not path.exists():
        raise ToolError("gold_demand_forecasts not built yet (run the Phase 11 demand model)")
    from pyspark.sql import functions as F

    df = deps.spark.read.format("delta").load(str(path)).filter(F.col("store_id") == args.store_id)
    if args.category is not None:
        df = df.filter(F.col("category") == args.category)
    rows = _cap_rows(
        [r.asDict() for r in df.orderBy(F.asc("forecast_date")).limit(TOOL_ROW_CAP).collect()],
        TOOL_ROW_CAP,
    )
    facts = {
        "type": "prediction",
        "store_id": args.store_id,
        "category": args.category,
        "forecast_rows": rows,
        "row_count": len(rows),
        "capped_at": TOOL_ROW_CAP,
    }
    return _ok(f"demand forecast for store {args.store_id}: {len(rows)} row(s)", facts)


def _list_active_anomalies(deps: ToolDeps, args: ListActiveAnomaliesArgs) -> dict[str, Any]:
    if deps.spark is None:
        raise ToolError("spark backend not configured")
    path = table_path("gold", "gold_anomalies", deps.data_root)
    if not path.exists():
        raise ToolError("gold_anomalies not built yet (run the Phase 11 anomaly model)")
    from pyspark.sql import functions as F

    df = deps.spark.read.format("delta").load(str(path))
    if args.store_id is not None:
        df = df.filter(F.col("store_id") == args.store_id)
    rows = _cap_rows(
        [r.asDict() for r in df.orderBy(F.desc("observed_on")).limit(TOOL_ROW_CAP).collect()],
        TOOL_ROW_CAP,
    )
    facts = {
        "type": "prediction",
        "source": "anomaly_model",
        "store_id": args.store_id,
        "anomalies": rows,
        "row_count": len(rows),
        "capped_at": TOOL_ROW_CAP,
    }
    return _ok(f"anomalies: {len(rows)} row(s)", facts)


def _search_company_docs(deps: ToolDeps, args: SearchCompanyDocsArgs) -> dict[str, Any]:
    if deps.retriever is None:
        raise ToolError("document retriever not configured")
    result = deps.retriever.grounded_search(args.query)
    if not result.supported:
        # Explicit uncertainty (kit/02 RAGR-004) — the message IS the fact.
        return _ok(
            f"document search unsupported: {result.message}",
            {"type": "document", "supported": False, "message": result.message},
        )
    chunks = [
        {
            "chunk_id": chunk.chunk_id,
            "doc_id": chunk.doc_id,
            "title": chunk.title,
            "section_heading": chunk.section_heading,
            "version": chunk.version,
            "effective_date": chunk.effective_date,
            "score": round(float(chunk.score), 4),
            "text": chunk.text,
        }
        for chunk in result.chunks
    ]
    facts = {"type": "document", "supported": True, "chunks": chunks}
    return _ok(f"document evidence: {len(chunks)} chunk(s) above the score floor", facts)


def _create_restock_proposal(deps: ToolDeps, args: CreateRestockProposalArgs) -> dict[str, Any]:
    """Create a PENDING restock proposal via ProposalService — never execute.

    Phase 14's service owns validation (SKU/store existence, quantity bounds,
    freshness, duplicate-open check); this tool only recommends, and human
    approval is required before anything mutates (kit/02 AR-006).
    """
    if deps.proposal_service is None:
        raise ToolError("proposal service not configured")
    from quickcart.api.models import ProposalCreate
    from quickcart.api.proposals import ProposalError

    body = ProposalCreate(
        proposal_type="RESTOCK",
        entity_scope={
            "store_id": args.store_id,
            "product_id": args.product_id,
            "quantity": args.quantity,
        },
        recommended_action=(
            f"Restock store {args.store_id} with {args.quantity} units of product "
            f"{args.product_id}"
        ),
        reason=args.reason,
        evidence=args.evidence,
        source_request_id=None,
    )
    try:
        row = deps.proposal_service.create(body)
    except ProposalError as exc:
        raise ToolError(f"proposal rejected by validation: {exc.detail}") from exc
    return _ok(
        f"proposal {row['proposal_id']} created with status {row['status']} "
        "(awaits human approval)",
        {
            "type": "proposal",
            "proposal_id": row["proposal_id"],
            "proposal_type": row["proposal_type"],
            "status": row["status"],
            "entity_scope": row["entity_scope"],
            "reason": row["reason"],
        },
    )


def _run_readonly_sql(deps: ToolDeps, args: RunReadonlySqlArgs) -> dict[str, Any]:
    final_sql, tables = validate_readonly_sql(args.sql)  # raises ToolError on violation
    if deps.sql_runner is not None:
        rows = deps.sql_runner(final_sql)
    else:
        rows = _spark_sql(deps, final_sql, tables)
    rows = _cap_rows(rows, SQL_ROW_CAP)
    facts = {"type": "metric", "via": "run_readonly_sql", "sql": final_sql, "rows": rows}
    summary = f"{len(rows)} row(s) from silver/gold (LIMIT {SQL_ROW_CAP} enforced)"
    return _ok(summary, facts, row_count=len(rows), sql=final_sql)


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    func: Callable[[BaseModel], dict[str, Any]]


def build_registry(deps: ToolDeps) -> "ToolRegistry":
    """Wire the real tool implementations to the injected backends."""

    def wrap(model: type[BaseModel], impl: Callable[[Any], dict[str, Any]]) -> Callable:
        return lambda args: impl(deps, args)

    specs = [
        ToolSpec("get_store_metrics", "Gold metrics for one store", GetStoreMetricsArgs,
                 wrap(GetStoreMetricsArgs, _get_store_metrics)),
        ToolSpec("get_kpi_summary", "Headline KPIs across all stores", GetKpiSummaryArgs,
                 wrap(GetKpiSummaryArgs, _get_kpi_summary)),
        ToolSpec("get_inventory_risk", "SKUs below reorder point / low stock cover",
                 GetInventoryRiskArgs, wrap(GetInventoryRiskArgs, _get_inventory_risk)),
        ToolSpec("get_delivery_prediction", "Persisted late-delivery prediction for an order",
                 GetDeliveryPredictionArgs, wrap(GetDeliveryPredictionArgs,
                                                 _get_delivery_prediction)),
        ToolSpec("get_demand_forecast", "Persisted demand forecast rows for a store",
                 GetDemandForecastArgs, wrap(GetDemandForecastArgs, _get_demand_forecast)),
        ToolSpec("list_active_anomalies", "Persisted anomaly rows", ListActiveAnomaliesArgs,
                 wrap(ListActiveAnomaliesArgs, _list_active_anomalies)),
        ToolSpec("search_company_docs", "Grounded retrieval over internal documents",
                 SearchCompanyDocsArgs, wrap(SearchCompanyDocsArgs, _search_company_docs)),
        ToolSpec("create_restock_proposal",
                 "Create a PENDING restock proposal (never executes; needs human approval)",
                 CreateRestockProposalArgs, wrap(CreateRestockProposalArgs,
                                                 _create_restock_proposal)),
        ToolSpec("run_readonly_sql",
                 "One read-only SELECT over silver_*/gold_* Delta tables (LIMIT enforced)",
                 RunReadonlySqlArgs, wrap(RunReadonlySqlArgs, _run_readonly_sql)),
    ]
    return ToolRegistry({spec.name: spec for spec in specs})


class ToolRegistry:
    """Name → spec map with Pydantic argument validation on every call."""

    def __init__(self, specs: dict[str, ToolSpec]) -> None:
        self._specs = dict(specs)

    @property
    def names(self) -> list[str]:
        return sorted(self._specs)

    def describe(self) -> dict[str, str]:
        return {name: spec.description for name, spec in sorted(self._specs.items())}

    def with_overrides(self, *specs: ToolSpec) -> "ToolRegistry":
        """Return a new registry with `specs` replacing same-named entries."""
        merged = dict(self._specs)
        merged.update({spec.name: spec for spec in specs})
        return ToolRegistry(merged)

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        spec = self._specs.get(name)
        if spec is None:
            raise ToolError(f"unknown tool {name!r}; available: {', '.join(self.names)}")
        try:
            args = spec.args_model.model_validate(arguments or {})
        except ValidationError as exc:
            detail = exc.errors(include_url=False)
            raise ToolError(f"invalid arguments for {name}: {detail}") from exc
        logger.debug("agent.tool_call", tool=name, arguments=arguments)
        return spec.func(args)
