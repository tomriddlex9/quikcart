"""Business tools for the Assistant v2 (Phase B4).

Thin, bounded wrappers over the same `BusinessService` the ``/api/v1/b`` routes
use, so the assistant, the console and the semantic registry can never disagree
on a definition, a unit or a status rule.

Every result carries, besides the usual ``ok``/``summary``/``evidence``:

* ``facts``       — ``{ref: Fact}`` the answer may cite (see `agents.cards`);
* ``model_view``  — the compact view the *model* sees (refs + display strings);
* ``card_drafts`` — sensible default cards for the API/voice surface.

Rules: read tools only read; ``draft_action`` can only create a PENDING proposal
(a human approves elsewhere); company-level aggregates are visible to anyone
with ``kpi:read`` (as in the router) while per-store rows are filtered to the
caller's data scope.
"""

from __future__ import annotations

import contextlib
import re
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import Any, Literal, Protocol

import psycopg
import structlog
from pydantic import BaseModel, Field

from quickcart.agents.cards import (
    Fact,
    RiskItem,
    SeriesPoint,
    delta_display,
    proposal_fact_from_row,
)
from quickcart.agents.tools import (
    SupportsProposalCreate,
    ToolError,
    ToolSpec,
    _json_safe,
    current_tool_context,
)
from quickcart.api.business.readmodel import ReadModel
from quickcart.api.business.schemas import AttentionItem, MetricValue
from quickcart.api.business.service import BusinessService, NotFoundError
from quickcart.business.snapshot import SCORECARD_COLUMNS
from quickcart.identity.rbac import scope_filter
from quickcart.semantics.registry import find_metric, format_display, list_metrics
from quickcart.semantics.registry import get_metric as registry_metric

logger = structlog.get_logger(__name__)

STORE_CITY_TTL_SECONDS = 60.0
MAX_TABLE_ROWS = 10

# metric -> metrics whose movement usually explains it (all exist in metrics.yaml)
DRIVERS: dict[str, tuple[str, ...]] = {
    "sales_gmv": ("orders", "average_basket"),
    "average_basket": ("sales_gmv", "orders"),
    "orders": ("cancel_rate", "active_customers"),
    "on_time_rate": ("avg_delivery_minutes", "late_rate"),
    "late_rate": ("avg_delivery_minutes", "on_time_rate"),
    "avg_delivery_minutes": ("late_rate", "orders"),
    "cancel_rate": ("payment_failure_rate", "stockout_risk_count", "availability_bestsellers"),
    "payment_failure_rate": ("cancel_rate",),
    "availability_bestsellers": ("stockout_risk_count",),
    "stockout_risk_count": ("availability_bestsellers",),
    "active_customers": ("orders", "repeat_rate"),
    "repeat_rate": ("active_customers",),
}
_TREND_KEYS = ("sales_gmv", "orders")
_STATUS_RANK = {"bad": 3, "watch": 2, "good": 1, "unknown": 0}


# --------------------------------------------------------------------------- #
# Dependencies
# --------------------------------------------------------------------------- #

ServiceOpener = Callable[[], AbstractContextManager[BusinessService]]


class SupportsStoreDirectory(Protocol):
    def store_city(self, store_id: int) -> str | None: ...


def connect_business_service(
    connect_factory: Callable[..., psycopg.Connection] | None = None,
) -> ServiceOpener:
    """Opener yielding a `BusinessService` over a fresh read-only connection."""

    @contextlib.contextmanager
    def opener() -> Iterator[BusinessService]:
        factory = connect_factory
        if factory is None:
            from quickcart.db.connection import connect as factory
        try:
            conn = factory()
        except psycopg.OperationalError as exc:
            raise ToolError("the business data store is not reachable right now") from exc
        with conn:
            conn.read_only = True
            try:
                yield BusinessService(ReadModel(conn))
            except psycopg.OperationalError as exc:
                raise ToolError("the business data store is not reachable right now") from exc

    return opener


class BusinessDeps:
    """Injectable backends for the business tools (fakes in tests, PostgreSQL in prod)."""

    def __init__(
        self,
        open_service: ServiceOpener | None = None,
        proposal_service: SupportsProposalCreate | None = None,
    ) -> None:
        self.open_service = open_service or connect_business_service()
        self.proposal_service = proposal_service
        self._city_cache: tuple[float, dict[int, str | None]] | None = None

    def store_city(self, store_id: int) -> str | None:
        """City of a store (cached briefly); ``None`` when unknown → scope check fails closed."""
        now = time.monotonic()
        if self._city_cache is None or now >= self._city_cache[0]:
            with self.open_service() as svc:
                cities = {c.store_id: c.city for c in svc.store_scorecards().stores}
            self._city_cache = (now + STORE_CITY_TTL_SECONDS, cities)
        return self._city_cache[1].get(store_id)


# --------------------------------------------------------------------------- #
# Argument schemas
# --------------------------------------------------------------------------- #

_METRIC_HELP = (
    "Metric key, label or synonym, e.g. "
    + ", ".join(m.key for m in list_metrics())
    + " (also: sales, revenue, delivery time, cancellations)."
)


class GetMetricArgs(BaseModel):
    metric: str = Field(min_length=1, description=_METRIC_HELP)
    store_id: int | None = Field(
        default=None, gt=0, description="Limit to one store; omit for the whole company."
    )
    include_trend: bool = Field(
        default=False, description="Add a daily trend (only sales_gmv and orders have one)."
    )


class CompareStoresArgs(BaseModel):
    metric: str = Field(min_length=1, description=_METRIC_HELP)
    order: Literal["worst_first", "best_first"] = "worst_first"
    limit: int = Field(default=5, ge=1, le=MAX_TABLE_ROWS)


class ExplainMetricChangeArgs(BaseModel):
    metric: str = Field(min_length=1, description=_METRIC_HELP)
    store_id: int | None = Field(
        default=None, gt=0, description="Explain one store; omit for the whole company."
    )


class GetBriefingArgs(BaseModel):
    pass


class GetAlertsArgs(BaseModel):
    store_id: int | None = Field(default=None, gt=0, description="Only this store.")


class DraftActionArgs(BaseModel):
    action_type: Literal["RESTOCK", "INCIDENT", "OPS_NOTIFICATION"]
    store_id: int = Field(gt=0)
    product_id: int | None = Field(default=None, gt=0, description="Required for RESTOCK.")
    quantity: int | None = Field(default=None, gt=0, description="Units; required for RESTOCK.")
    reason: str = Field(min_length=1, description="Why, in plain language, citing the evidence.")
    evidence: list[str] = Field(default_factory=list, max_length=10)


# --------------------------------------------------------------------------- #
# Fact / view builders
# --------------------------------------------------------------------------- #


def metric_ref(key: str, store_id: int | None = None) -> str:
    return f"metric:{key}:store:{store_id}" if store_id is not None else f"metric:{key}:all"


def _metric_fact(
    mv: MetricValue, *, store_id: int | None = None, store_name: str | None = None
) -> Fact:
    return Fact(
        ref=metric_ref(mv.key, store_id),
        kind="metric",
        label=f"{store_name} · {mv.label}" if store_name else mv.label,
        value=mv.value,
        display=mv.display,
        unit=mv.unit,
        status=mv.status,
        delta_pct=mv.delta_pct,
        baseline_display=mv.baseline_display,
        compare_label=mv.compare_label,
        explanation=mv.explanation,
        as_of=mv.as_of.isoformat() if mv.as_of else None,
        data={
            "metric_key": mv.key,
            "direction": mv.direction,
            "store_id": store_id,
            "is_partial": mv.is_partial,
        },
    )


def _view_of(fact: Fact) -> dict[str, Any]:
    """Compact, display-only view of a fact for the model (no raw floats)."""
    base: dict[str, Any] = {"ref": fact.ref, "kind": fact.kind, "label": fact.label}
    if fact.kind == "metric":
        base.update(
            value=fact.display,
            status=fact.status,
            change=delta_display(fact.delta_pct),
            compared_with=(
                f"{fact.baseline_display} ({fact.compare_label})" if fact.baseline_display else None
            ),
            explanation=fact.explanation,
        )
    elif fact.kind == "series":
        base["points"] = [{"at": p.at, "value": p.display} for p in fact.points]
    elif fact.kind == "table":
        base.update(columns=fact.columns, rows=fact.rows)
    elif fact.kind == "risk_list":
        base["items"] = [
            {"title": i.title, "detail": i.detail, "severity": i.severity, "store_id": i.store_id}
            for i in fact.items
        ]
    elif fact.kind == "proposal":
        base.update(status=fact.data.get("status"), detail=fact.display)
    return base


def _result(
    summary: str,
    facts: list[Fact],
    cards: list[dict[str, Any]],
    *,
    meta: Any = None,
    extra_view: dict[str, Any] | None = None,
    found: bool = True,
) -> dict[str, Any]:
    views = [_view_of(f) for f in facts]
    meta_view: dict[str, Any] = {}
    if meta is not None:
        meta_view = {
            "as_of_day": meta.as_of_day.isoformat() if meta.as_of_day else None,
            "is_today": meta.is_today,
            "source": meta.source,
            "note": meta.note,
        }
    view = {
        "found": found,
        "summary": summary,
        "facts": views,
        "meta": meta_view,
        "how_to_cite": (
            "Embed figures as {{ref}} placeholders; point cards at refs. Never type numbers."
        ),
        **(extra_view or {}),
    }
    return {
        "ok": True,
        "summary": summary,
        "evidence": _json_safe({"type": "business", "found": found, "facts": views, **meta_view}),
        "facts": {f.ref: f.model_dump(mode="json") for f in facts},
        "model_view": _json_safe(view),
        "card_drafts": cards,
    }


def _not_found(message: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return _result(message, [], [], found=False, extra_view=extra)


def _tokens(text: str) -> frozenset[str]:
    return frozenset(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def _resolve_metric(term: str) -> str | None:
    """Key for a metric key, label, synonym or a close paraphrase (``on-time rate``)."""
    metric = find_metric(term)
    if metric is not None:
        return metric.key
    wanted = _tokens(term)
    best: tuple[int, str] | None = None
    for candidate in list_metrics():
        names = [candidate.key, candidate.label, *candidate.synonyms]
        for name in names:
            tokens = _tokens(name)
            if tokens and tokens <= wanted and (best is None or len(tokens) > best[0]):
                best = (len(tokens), candidate.key)
    return best[1] if best else None


def _unknown_metric(term: str) -> dict[str, Any]:
    return _not_found(
        f"I don't track a metric called {term!r}.",
        {"available_metrics": {m.key: m.label for m in list_metrics()}},
    )


def _in_scope(store_id: int | None, city: str | None = None) -> bool:
    principal = current_tool_context().principal
    if principal is None:
        return True
    try:
        scope_filter(principal, store_id=store_id, store_city=city)
    except PermissionError:
        return False
    return True


def _global_metrics(svc: BusinessService) -> tuple[dict[str, MetricValue], Any]:
    today = svc.today()
    return {m.key: m for m in [*today.headline, *today.more]}, today


def _series_fact(
    key: str, scope_label: str, ref_scope: str, points: list[tuple[str, float | None]]
) -> Fact:
    unit = registry_metric(key).unit
    return Fact(
        ref=f"series:{key}:{ref_scope}",
        kind="series",
        label=f"{registry_metric(key).label} · {scope_label}",
        unit=unit,
        points=[SeriesPoint(at=at, value=v, display=format_display(v, unit)) for at, v in points],
    )


def _risk_items(items: list[AttentionItem]) -> list[RiskItem]:
    return [
        RiskItem(
            title=i.title,
            detail=i.detail,
            severity=i.severity,
            store_id=i.store_id,
            ref=metric_ref(i.metric_key, i.store_id) if i.metric_key else None,
        )
        for i in items
        if i.store_id is None or _in_scope(i.store_id)
    ]


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #


def _get_metric(deps: BusinessDeps, args: GetMetricArgs) -> dict[str, Any]:
    key = _resolve_metric(args.metric)
    if key is None:
        return _unknown_metric(args.metric)
    with deps.open_service() as svc:
        facts: list[Fact] = []
        meta = svc.meta()
        if args.store_id is None:
            metrics, _ = _global_metrics(svc)
            mv = metrics.get(key) or svc.explain_metric(key).current
            fact = _metric_fact(mv)
            series_points = (
                [
                    (t.at.isoformat(), t.sales if key == "sales_gmv" else t.orders)
                    for t in svc.money().daily_trend
                ]
                if args.include_trend and key in _TREND_KEYS
                else None
            )
            scope_label = "all stores"
            ref_scope = "all"
        else:
            try:
                detail = svc.store_detail(args.store_id)
            except NotFoundError:
                return _not_found(f"Store {args.store_id} was not found.")
            mv = detail.scorecard.metrics.get(key)
            if mv is None:
                return _not_found(
                    f"{registry_metric(key).label} is not tracked per store.",
                    {"per_store_metrics": sorted(SCORECARD_COLUMNS)},
                )
            name = detail.scorecard.store_name
            fact = _metric_fact(mv, store_id=args.store_id, store_name=name)
            series_points = (
                [
                    (t.at.isoformat(), t.sales if key == "sales_gmv" else t.orders)
                    for t in detail.daily_trend
                ]
                if args.include_trend and key in _TREND_KEYS
                else None
            )
            scope_label, ref_scope = name, f"store:{args.store_id}"
        facts.append(fact)
        cards: list[dict[str, Any]] = [{"type": "kpi", "ref": fact.ref}]
        if series_points:
            series = _series_fact(key, scope_label, ref_scope, series_points)
            facts.append(series)
            cards.append({"type": "trend", "ref": series.ref})
    definition = registry_metric(key)
    extra: dict[str, Any] = {"definition": definition.plain_description}
    if definition.status == "partial":
        extra["caveat"] = definition.partial_note
    if args.include_trend and key not in _TREND_KEYS:
        extra["trend_note"] = "Daily trends exist only for sales_gmv and orders."
    return _result(fact.explanation or fact.label, facts, cards, meta=meta, extra_view=extra)


def _order_key(direction: str, worst_first: bool) -> Callable[[MetricValue], tuple[int, float]]:
    def key(mv: MetricValue) -> tuple[int, float]:
        if mv.value is None:
            return (1, 0.0)
        bad_is_low = direction == "higher_better"
        low_first = bad_is_low == worst_first
        return (0, mv.value if low_first else -mv.value)

    return key


def _compare_stores(deps: BusinessDeps, args: CompareStoresArgs) -> dict[str, Any]:
    key = _resolve_metric(args.metric)
    if key is None:
        return _unknown_metric(args.metric)
    if key not in SCORECARD_COLUMNS:
        return _not_found(
            f"{registry_metric(key).label} is not tracked per store.",
            {"per_store_metrics": sorted(SCORECARD_COLUMNS)},
        )
    metric = registry_metric(key)
    with deps.open_service() as svc:
        meta = svc.meta()
        cards_by_store = [c for c in svc.store_scorecards().stores if _in_scope(c.store_id, c.city)]
    rows = [(c, c.metrics[key]) for c in cards_by_store if key in c.metrics]
    rows.sort(key=lambda pair: _order_key(metric.direction, args.order == "worst_first")(pair[1]))
    rows = rows[: args.limit]
    if not rows:
        return _not_found("No stores are visible for that comparison.")
    facts = [
        _metric_fact(mv, store_id=card.store_id, store_name=card.store_name) for card, mv in rows
    ]
    table = Fact(
        ref=f"stores:{key}",
        kind="table",
        label=f"Stores by {metric.label.lower()} ({args.order.replace('_', ' ')})",
        columns=["Store", "City", metric.label, "Status", "Change"],
        rows=[
            {
                "Store": card.store_name,
                "City": card.city or "—",
                metric.label: mv.display,
                "Status": mv.status,
                "Change": delta_display(mv.delta_pct) or "—",
            }
            for card, mv in rows
        ],
    )
    cards: list[dict[str, Any]] = [{"type": "table", "ref": table.ref}]
    if len(facts) >= 2:
        cards.append({"type": "compare", "refs": [f.ref for f in facts[:3]]})
    first_card, first_mv = rows[0]
    summary = (
        f"{first_card.store_name} is {'weakest' if args.order == 'worst_first' else 'strongest'}"
        f" on {metric.label.lower()}: {first_mv.display}."
    )
    return _result(
        summary,
        [table, *facts],
        cards,
        meta=meta,
        extra_view={"store_count": len(rows), "direction": metric.direction},
    )


def _explain_metric_change(deps: BusinessDeps, args: ExplainMetricChangeArgs) -> dict[str, Any]:
    key = _resolve_metric(args.metric)
    if key is None:
        return _unknown_metric(args.metric)
    metric = registry_metric(key)
    with deps.open_service() as svc:
        meta = svc.meta()
        movers: list[tuple[str, MetricValue]] = []
        if args.store_id is None:
            metrics, _ = _global_metrics(svc)
            target = metrics.get(key) or svc.explain_metric(key).current
            driver_values = {k: metrics[k] for k in DRIVERS.get(key, ()) if k in metrics}
            if key in SCORECARD_COLUMNS:
                movers = [
                    (c.store_name, c.metrics[key])
                    for c in svc.store_scorecards().stores
                    if key in c.metrics and _in_scope(c.store_id, c.city)
                ]
            store_id, store_name = None, None
        else:
            try:
                detail = svc.store_detail(args.store_id)
            except NotFoundError:
                return _not_found(f"Store {args.store_id} was not found.")
            target = detail.scorecard.metrics.get(key)
            if target is None:
                return _not_found(f"{metric.label} is not tracked per store.")
            driver_values = {
                k: detail.scorecard.metrics[k]
                for k in DRIVERS.get(key, ())
                if k in detail.scorecard.metrics
            }
            store_id, store_name = args.store_id, detail.scorecard.store_name

    facts = [_metric_fact(target, store_id=store_id, store_name=store_name)]
    facts += [
        _metric_fact(v, store_id=store_id, store_name=store_name) for v in driver_values.values()
    ]
    adverse_sign = -1 if metric.direction == "higher_better" else 1
    movers_view: list[dict[str, Any]] = []
    if movers:
        movers = [(n, m) for n, m in movers if m.delta_pct is not None]
        movers.sort(key=lambda pair: adverse_sign * (pair[1].delta_pct or 0.0), reverse=True)
        movers = movers[:5]
        table = Fact(
            ref=f"movers:{key}",
            kind="table",
            label=f"Stores moving {metric.label.lower()} the most (against the trend first)",
            columns=["Store", "Now", "Before", "Change"],
            rows=[
                {
                    "Store": name,
                    "Now": mv.display,
                    "Before": mv.baseline_display or "—",
                    "Change": delta_display(mv.delta_pct) or "—",
                }
                for name, mv in movers
            ],
        )
        facts.append(table)
        movers_view = table.rows
    drivers_view = [
        {"ref": metric_ref(v.key, store_id), "label": v.label, "change": delta_display(v.delta_pct)}
        for v in driver_values.values()
    ]
    cards: list[dict[str, Any]] = [{"type": "kpi", "ref": facts[0].ref}]
    if driver_values:
        cards.append(
            {
                "type": "compare",
                "refs": [f.ref for f in facts[: 1 + len(driver_values)]],
                "title": "What moved with it",
            }
        )
    if movers_view:
        cards.append({"type": "table", "ref": f"movers:{key}"})
    return _result(
        target.explanation,
        facts,
        cards,
        meta=meta,
        extra_view={
            "compared_with": target.compare_label,
            "drivers": drivers_view,
            "driver_hint": "Describe movement using the change/status of the drivers; "
            "do not claim causation beyond what moved together.",
        },
    )


def _get_briefing(deps: BusinessDeps, args: GetBriefingArgs) -> dict[str, Any]:
    with deps.open_service() as svc:
        today = svc.today()
    headline = [_metric_fact(m) for m in today.headline]
    risk = Fact(
        ref="risk:attention",
        kind="risk_list",
        label="Needs attention",
        items=_risk_items(today.attention),
    )
    cards: list[dict[str, Any]] = [{"type": "kpi", "ref": f.ref} for f in headline[:3]]
    if risk.items:
        cards.append({"type": "risk_list", "ref": risk.ref})
    return _result(
        today.summary,
        [*headline, risk],
        cards,
        meta=today.meta,
        extra_view={"briefing": today.summary, "attention_count": len(risk.items)},
    )


def _get_alerts(deps: BusinessDeps, args: GetAlertsArgs) -> dict[str, Any]:
    with deps.open_service() as svc:
        alerts = svc.alerts()
        items = list(alerts.items)
        fallback = False
        if not items:
            items = list(svc.today().attention)
            fallback = True
    risk_items = [i for i in _risk_items(items) if args.store_id in (None, i.store_id)]
    risk = Fact(
        ref="risk:alerts",
        kind="risk_list",
        label="Alerts" if not fallback else "Needs attention",
        items=risk_items,
    )
    note = (
        "No alert rules are configured yet, so these are the items currently needing attention."
        if fallback
        else None
    )
    summary = (
        f"{len(risk_items)} item(s) need attention." if risk_items else "Nothing needs attention."
    )
    return _result(
        summary,
        [risk],
        [{"type": "risk_list", "ref": risk.ref}] if risk_items else [],
        meta=alerts.meta,
        extra_view={"note": note, "source": "attention" if fallback else "alert_rules"},
    )


def _draft_action(deps: BusinessDeps, args: DraftActionArgs) -> dict[str, Any]:
    """Create a PENDING proposal — never executes anything (human approval elsewhere)."""
    if deps.proposal_service is None:
        raise ToolError("proposal service not configured")
    from quickcart.api.models import ProposalCreate
    from quickcart.api.proposals import ProposalError

    scope: dict[str, int] = {"store_id": args.store_id}
    if args.action_type == "RESTOCK":
        if args.product_id is None or args.quantity is None:
            raise ToolError("RESTOCK needs both product_id and quantity")
        scope.update(product_id=args.product_id, quantity=args.quantity)
        action = (
            f"Restock store {args.store_id} with {args.quantity} units of product {args.product_id}"
        )
    elif args.action_type == "INCIDENT":
        action = f"Open an incident for store {args.store_id}"
    else:
        action = f"Notify operations about store {args.store_id}"
    body = ProposalCreate(
        proposal_type=args.action_type,
        entity_scope=scope,
        recommended_action=action,
        reason=args.reason,
        evidence=args.evidence,
        source_request_id=None,
    )
    try:
        row = deps.proposal_service.create(body)
    except ProposalError as exc:
        raise ToolError(f"proposal rejected by validation: {exc.detail}") from exc
    fact = proposal_fact_from_row({**row, "recommended_action": action})
    summary = (
        f"Proposal {row['proposal_id']} created with status {row['status']}; "
        "it needs human approval before anything happens."
    )
    return _result(
        summary,
        [fact],
        [{"type": "proposal", "ref": fact.ref}],
        extra_view={"status": row["status"], "executes": False},
    )


# --------------------------------------------------------------------------- #
# Registration
# --------------------------------------------------------------------------- #


def business_specs(deps: BusinessDeps) -> list[ToolSpec]:
    """Tool specs bound to ``deps`` (registered by `tools.build_registry`)."""

    def bind(
        impl: Callable[[BusinessDeps, Any], dict[str, Any]],
    ) -> Callable[[Any], dict[str, Any]]:
        return lambda args: impl(deps, args)

    return [
        ToolSpec(
            "get_metric",
            "Current value of one business metric (company-wide or one store) with status and "
            "change versus last week; optionally a daily trend for sales or orders.",
            GetMetricArgs,
            bind(_get_metric),
            permission="kpi:read",
        ),
        ToolSpec(
            "compare_stores",
            "Rank stores on one metric (worst or best first) with status and change.",
            CompareStoresArgs,
            bind(_compare_stores),
            permission="kpi:read",
        ),
        ToolSpec(
            "explain_metric_change",
            "Why a metric moved: its change versus last week, the related metrics that moved "
            "with it, and which stores moved it the most.",
            ExplainMetricChangeArgs,
            bind(_explain_metric_change),
            permission="kpi:read",
        ),
        ToolSpec(
            "get_briefing",
            "Today's briefing: headline numbers and what needs attention.",
            GetBriefingArgs,
            bind(_get_briefing),
            permission="kpi:read",
        ),
        ToolSpec(
            "get_alerts",
            "Alerts / items that need attention now, optionally for one store.",
            GetAlertsArgs,
            bind(_get_alerts),
            permission="kpi:read",
        ),
        ToolSpec(
            "draft_action",
            "Draft an action (restock, incident, ops notification) as a PENDING proposal. "
            "It never executes; a human must approve it.",
            DraftActionArgs,
            bind(_draft_action),
            permission="proposal:create",
            risk="propose",
        ),
    ]
