"""Business service: turns read-model figures into plain-language API responses.

All wording, units, and status rules come from the semantic registry. This
module only assembles, compares against the same day last week, and ranks.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from quickcart.api.business.readmodel import ReadModel, StoreDay
from quickcart.api.business.schemas import (
    AlertsResponse,
    AttentionItem,
    CategoryMoney,
    CustomerRow,
    CustomersHealthResponse,
    DeliveryHealthResponse,
    DeliveryStoreRow,
    JourneyStep,
    JourneySummary,
    Meta,
    MetricDefinition,
    MetricExplainResponse,
    MetricsCatalogResponse,
    MetricValue,
    MoneyResponse,
    ProductRow,
    ProductsResponse,
    ReportCreate,
    ReportRow,
    ReportsResponse,
    Status,
    StoreDetail,
    StoreScorecard,
    StoreScorecardsResponse,
    TargetRow,
    TargetsResponse,
    TodayResponse,
    TrendPoint,
)
from quickcart.business.snapshot import BASELINE_OFFSET_DAYS, HEALTH_METRICS, SCORECARD_COLUMNS
from quickcart.semantics.registry import (
    MetricDef,
    delta_pct,
    format_display,
    format_inr,
    get_metric,
    list_metrics,
    render_explanation,
    status_for,
)

HEADLINE_KEYS = ("sales_gmv", "orders", "average_basket", "on_time_rate", "cancel_rate")
MORE_KEYS = (
    "avg_delivery_minutes",
    "late_rate",
    "payment_failure_rate",
    "availability_bestsellers",
    "stockout_risk_count",
    "active_customers",
    "repeat_rate",
)
TREND_DAYS = 14
MAX_ATTENTION = 8
_SEVERITY_RANK = {"bad": 2, "watch": 1}
_STATUS_RANK = {"unknown": 0, "good": 1, "watch": 2, "bad": 3}


class NotFoundError(LookupError):
    """The requested store, metric, or journey does not exist."""


def _f(value: Decimal | float | int | None) -> float | None:
    return None if value is None else float(value)


def _worst(statuses: list[Status]) -> Status:
    known = [s for s in statuses if s != "unknown"]
    return max(known, key=_STATUS_RANK.__getitem__) if known else "unknown"


class BusinessService:
    def __init__(self, readmodel: ReadModel, *, now: datetime | None = None) -> None:
        self._rm = readmodel
        self._now = now or datetime.now(UTC)

    # --- shared helpers ----------------------------------------------------------------
    @property
    def day(self) -> date:
        return self._rm.as_of().day

    @property
    def baseline_day(self) -> date:
        return self.day - timedelta(days=BASELINE_OFFSET_DAYS)

    def meta(self, note: str | None = None) -> Meta:
        as_of = self._rm.as_of()
        return Meta(
            as_of_day=as_of.day,
            is_today=as_of.day == self._now.date(),
            source=as_of.source,  # type: ignore[arg-type]
            snapshot_run_id=as_of.snapshot_run_id,
            snapshot_finished_at=as_of.finished_at,
            generated_at=self._now,
            note=note
            if note is not None
            else (
                None
                if as_of.day == self._now.date()
                else f"Showing the latest day with orders ({as_of.day:%d %b %Y})."
            ),
        )

    def metric_value(
        self,
        key: str,
        value: Decimal | float | None,
        baseline: Decimal | float | None = None,
    ) -> MetricValue:
        metric = get_metric(key)
        v, b = _f(value), _f(baseline)
        change = delta_pct(v, b)
        return MetricValue(
            key=key,
            label=metric.label,
            value=v,
            display=format_display(v, metric.unit),
            unit=metric.unit,
            status=status_for(v, metric, b),
            direction=metric.direction,
            baseline_value=b,
            baseline_display=None if b is None else format_display(b, metric.unit),
            delta_pct=None if change is None else round(change, 1),
            compare_to=metric.compare_default,
            compare_label=metric.compare_label,
            explanation=render_explanation(metric, v, change),
            plain_description=metric.plain_description,
            is_partial=metric.status == "partial",
            as_of=self.day,
        )

    def _metrics_for(
        self, keys: tuple[str, ...], values: dict[str, dict[date, Any]]
    ) -> list[MetricValue]:
        return [
            self.metric_value(
                key,
                values.get(key, {}).get(self.day),
                values.get(key, {}).get(self.baseline_day),
            )
            for key in keys
        ]

    def _global_series(self) -> dict[str, dict[date, Any]]:
        return self._rm.metric_series("global", "all", [self.day, self.baseline_day])

    # --- today ---------------------------------------------------------------------------
    def today(self) -> TodayResponse:
        series = self._global_series()
        headline = self._metrics_for(HEADLINE_KEYS, series)
        more = self._metrics_for(MORE_KEYS, series)
        all_attention = self._attention()
        attention = all_attention[:MAX_ATTENTION]
        sales = headline[0]
        bad = sum(1 for item in all_attention if item.severity == "bad")
        if sales.value is None:
            summary = "No orders found yet."
        elif not all_attention:
            summary = f"{sales.explanation} Nothing needs attention right now."
        else:
            summary = (
                f"{sales.explanation} {len(all_attention)} "
                f"{'thing needs' if len(all_attention) == 1 else 'things need'} attention"
                f"{f', {bad} urgent' if bad else ''}."
            )
        return TodayResponse(
            meta=self.meta(), summary=summary, headline=headline, more=more, attention=attention
        )

    def _attention(self) -> list[AttentionItem]:
        items: list[AttentionItem] = []
        for metric in self._metrics_for(HEADLINE_KEYS + MORE_KEYS, self._global_series()):
            if metric.status in ("watch", "bad"):
                items.append(
                    AttentionItem(
                        id=f"all:{metric.key}",
                        severity=metric.status,  # type: ignore[arg-type]
                        title=f"Check {metric.label.lower()}",
                        detail=metric.explanation,
                        metric_key=metric.key,
                    )
                )
        stores = self._rm.stores()
        by_day = self._rm.store_days([self.day, self.baseline_day])
        today_rows = by_day.get(self.day, {})
        base_rows = by_day.get(self.baseline_day, {})
        for store_id, info in stores.items():
            current = today_rows.get(store_id)
            if current is None:
                continue
            for key in HEALTH_METRICS:
                baseline = base_rows.get(store_id)
                metric = self.metric_value(
                    key, current.values.get(key), baseline.values.get(key) if baseline else None
                )
                if metric.status in ("watch", "bad"):
                    items.append(
                        AttentionItem(
                            id=f"{store_id}:{key}",
                            severity=metric.status,  # type: ignore[arg-type]
                            title=f"{info.name}: check {metric.label.lower()}",
                            detail=metric.explanation,
                            metric_key=key,
                            store_id=store_id,
                            store_name=info.name,
                        )
                    )
        items.sort(key=lambda i: (-_SEVERITY_RANK[i.severity], i.store_id is not None, i.id))
        return items

    # --- stores --------------------------------------------------------------------------
    def _scorecard(
        self,
        store_id: int,
        name: str,
        city: str | None,
        today: StoreDay | None,
        base: StoreDay | None,
    ) -> StoreScorecard:
        metrics: dict[str, MetricValue] = {}
        for key in SCORECARD_COLUMNS:
            metrics[key] = self.metric_value(
                key,
                today.values.get(key) if today else None,
                base.values.get(key) if base else None,
            )
        status = _worst([metrics[key].status for key in HEALTH_METRICS])
        notes = [
            f"{metrics[key].label}: {metrics[key].display}"
            for key in HEALTH_METRICS
            if metrics[key].status in ("watch", "bad")
        ]
        return StoreScorecard(
            store_id=store_id,
            store_name=name,
            city=city,
            status=status,
            metrics=metrics,
            attention=notes,
        )

    def store_scorecards(self) -> StoreScorecardsResponse:
        by_day = self._rm.store_days([self.day, self.baseline_day])
        today_rows, base_rows = by_day.get(self.day, {}), by_day.get(self.baseline_day, {})
        cards = [
            self._scorecard(
                info.store_id, info.name, info.city, today_rows.get(sid), base_rows.get(sid)
            )
            for sid, info in self._rm.stores().items()
        ]
        cards.sort(key=lambda c: (-_STATUS_RANK[c.status], -(c.metrics["sales_gmv"].value or 0.0)))
        return StoreScorecardsResponse(meta=self.meta(), stores=cards)

    def store_detail(self, store_id: int) -> StoreDetail:
        stores = self._rm.stores()
        info = stores.get(store_id)
        if info is None:
            raise NotFoundError(f"store {store_id} not found")
        by_day = self._rm.store_days([self.day, self.baseline_day])
        card = self._scorecard(
            store_id,
            info.name,
            info.city,
            by_day.get(self.day, {}).get(store_id),
            by_day.get(self.baseline_day, {}).get(store_id),
        )
        trend_days = [self.day - timedelta(days=n) for n in range(TREND_DAYS - 1, -1, -1)]
        series = self._rm.metric_series("store", str(store_id), trend_days)
        daily = [
            TrendPoint(
                at=day,
                sales=_f(series.get("sales_gmv", {}).get(day)),
                orders=_int(series.get("orders", {}).get(day)),
            )
            for day in trend_days
        ]
        hourly = [
            TrendPoint(at=p["at"], sales=_f(p.get("sales")), orders=_int(p.get("orders")))
            for p in self._rm.hourly_trend("store", str(store_id), self.day)
        ]
        low = [self._low_row(r) for r in self._rm.running_low(10, store_id)]
        return StoreDetail(
            meta=self.meta(),
            scorecard=card,
            hourly_trend=hourly,
            daily_trend=daily,
            running_low=low,
        )

    # --- products ------------------------------------------------------------------------
    @staticmethod
    def _low_row(row: dict[str, Any]) -> ProductRow:
        on_hand, reorder = int(row["on_hand_qty"]), int(row["reorder_point"])
        units_7d = int(row["units_7d"] or 0)
        cover = round(on_hand / (units_7d / 168.0), 1) if units_7d > 0 else None
        if on_hand == 0:
            status: Status = "bad"
            note = f"Out of stock at {row['store_name']}."
        elif cover is not None and cover < 12:
            status = "bad"
            note = (
                f"Only {on_hand} left at {row['store_name']}: "
                f"about {cover:.0f} hours at the recent pace."
            )
        else:
            status = "watch"
            pace = f", about {cover:.0f} hours at the recent pace" if cover is not None else ""
            note = f"{on_hand} left at {row['store_name']}; reorder level is {reorder}{pace}."
        return ProductRow(
            product_id=int(row["product_id"]),
            sku=row["sku"],
            name=row["name"],
            category=row["category"],
            store_id=int(row["store_id"]),
            store_name=row["store_name"],
            on_hand_qty=on_hand,
            reorder_point=reorder,
            units_sold=units_7d,
            stock_cover_hours=cover,
            status=status,
            note=note,
        )

    def products(
        self, tab: Literal["running_low", "bestsellers", "slow"], limit: int = 20
    ) -> ProductsResponse:
        if tab == "running_low":
            return ProductsResponse(
                meta=self.meta(),
                tab=tab,
                title="Products running low",
                description="Stock at or below the reorder level, emptiest first.",
                items=[self._low_row(r) for r in self._rm.running_low(limit)],
            )
        if tab == "bestsellers":
            items = [
                ProductRow(
                    product_id=int(r["product_id"]),
                    sku=r["sku"],
                    name=r["name"],
                    category=r["category"],
                    units_sold=int(r["units"]),
                    revenue=_f(r["revenue"]),
                    revenue_display=format_inr(float(r["revenue"])),
                    status="good",
                    note=f"Sold {int(r['units']):,} units for {format_inr(float(r['revenue']))} "
                    "in the last 7 days.",
                )
                for r in self._rm.bestsellers(limit)
            ]
            return ProductsResponse(
                meta=self.meta(),
                tab=tab,
                title="Bestsellers",
                description="Top products by sales over the last 7 days.",
                items=items,
            )
        items = [
            ProductRow(
                product_id=int(r["product_id"]),
                sku=r["sku"],
                name=r["name"],
                category=r["category"],
                units_sold=int(r["units"]),
                revenue=_f(r["revenue"]),
                revenue_display=format_inr(float(r["revenue"])),
                on_hand_qty=int(r["on_hand"]),
                status="watch",
                note=(
                    f"No sales in the last 14 days with {int(r['on_hand']):,} units in stock."
                    if int(r["units"]) == 0
                    else f"Only {int(r['units']):,} sold in 14 days "
                    f"with {int(r['on_hand']):,} in stock."
                ),
            )
            for r in self._rm.slow_movers(limit)
        ]
        return ProductsResponse(
            meta=self.meta(),
            tab="slow",
            title="Slow movers",
            description="Products with stock on the shelf that sold least over the last 14 days.",
            items=items,
        )

    # --- delivery / customers / money --------------------------------------------------
    def delivery_health(self) -> DeliveryHealthResponse:
        metrics = self._metrics_for(
            ("on_time_rate", "late_rate", "avg_delivery_minutes"), self._global_series()
        )
        by_day = self._rm.store_days([self.day, self.baseline_day])
        today_rows, base_rows = by_day.get(self.day, {}), by_day.get(self.baseline_day, {})
        rows: list[DeliveryStoreRow] = []
        for sid, info in self._rm.stores().items():
            cur, base = today_rows.get(sid), base_rows.get(sid)
            on_time = self.metric_value(
                "on_time_rate",
                cur.values.get("on_time_rate") if cur else None,
                base.values.get("on_time_rate") if base else None,
            )
            minutes = self.metric_value(
                "avg_delivery_minutes",
                cur.values.get("avg_delivery_minutes") if cur else None,
                base.values.get("avg_delivery_minutes") if base else None,
            )
            rows.append(
                DeliveryStoreRow(
                    store_id=sid,
                    store_name=info.name,
                    status=_worst([on_time.status, minutes.status]),
                    on_time_rate=on_time,
                    avg_delivery_minutes=minutes,
                )
            )
        rows.sort(key=lambda r: (-_STATUS_RANK[r.status], r.on_time_rate.value or 2.0))
        state = self._rm.delivery_state()
        return DeliveryHealthResponse(
            meta=self.meta(),
            metrics=metrics,
            by_store=rows,
            in_progress=state["in_progress"],
            riders=state["riders"],
        )

    def customers_health(self) -> CustomersHealthResponse:
        metrics = self._metrics_for(("active_customers", "repeat_rate"), self._global_series())
        state = self._rm.customer_state(self.day)
        top = [
            CustomerRow(
                customer_code=r["customer_code"],
                orders=int(r["orders"]),
                spend=float(r["spend"]),
                spend_display=format_inr(float(r["spend"])),
                last_order_at=r["last_order_at"],
            )
            for r in state["top_customers"]
        ]
        return CustomersHealthResponse(
            meta=self.meta(),
            metrics=metrics,
            new_customers=state["new_customers"],
            total_customers=state["total_customers"],
            top_customers=top,
        )

    def money(self) -> MoneyResponse:
        series = self._global_series()
        sales, basket = self._metrics_for(("sales_gmv", "average_basket"), series)
        state = self._rm.money_state(self.day)
        discounts, refunds = state["discounts"], state["refunds"]
        gross = Decimal(str(sales.value)) if sales.value is not None else None
        net = None if gross is None else gross - refunds
        margin = self._rm.margin_for_day(self.day)
        cogs = margin.get("cogs")
        contribution = margin.get("contribution_margin")
        if contribution is None and net is not None and cogs is not None:
            contribution = net - cogs
        margin_pct = None
        if contribution is not None and net and net > 0:
            margin_pct = round(float(contribution / net) * 100, 1)
        categories = self._rm.category_sales([self.day])
        total = sum((c["sales"] for c in categories), Decimal(0))
        trend_days = [self.day - timedelta(days=n) for n in range(6, -1, -1)]
        trend_series = self._rm.metric_series("global", "all", trend_days)
        return MoneyResponse(
            meta=self.meta(),
            sales=sales,
            average_basket=basket,
            discounts=float(discounts),
            discounts_display=format_inr(float(discounts)),
            discount_share_pct=(
                None if not gross else round(float(discounts / (gross + discounts)), 4)
            ),
            refunds=float(refunds),
            refunds_display=format_inr(float(refunds)),
            net_sales=_f(net),
            net_sales_display=format_display(_f(net), "inr"),
            cogs=_f(cogs),
            cogs_display=None if cogs is None else format_inr(float(cogs)),
            contribution_margin=_f(contribution),
            contribution_margin_display=(
                None if contribution is None else format_inr(float(contribution))
            ),
            margin_pct=margin_pct,
            by_category=[
                CategoryMoney(
                    category=c["category"],
                    sales=float(c["sales"]),
                    sales_display=format_inr(float(c["sales"])),
                    # 0..1 fraction — matches MetricValue pct unit / frontend formatShare.
                    share_pct=None if not total else round(float(c["sales"] / total), 4),
                    units=c["units"],
                )
                for c in categories
            ],
            daily_trend=[
                TrendPoint(
                    at=day,
                    sales=_f(trend_series.get("sales_gmv", {}).get(day)),
                    orders=_int(trend_series.get("orders", {}).get(day)),
                )
                for day in trend_days
            ],
        )

    def targets(self) -> TargetsResponse:
        period_start = self.day.replace(day=1)
        rows = self._rm.list_targets(period_start)
        if not rows:
            return TargetsResponse(
                meta=self.meta(),
                period_start=period_start,
                items=[],
                note="No targets yet. Run `python -m quickcart.simulator.business` after seeding, "
                "or set targets with target:write.",
            )
        items: list[TargetRow] = []
        for row in rows:
            metric_key = row["metric_key"]
            try:
                metric = get_metric(metric_key)
                label = metric.label
                unit = metric.unit
            except KeyError:
                label = metric_key
                unit = "count"
            scope_type = row["scope_type"]
            scope_value = row["scope_value"]
            # serving uses 'global'; targets table uses 'global' too (V010).
            series_scope = "global" if scope_type in ("global", "company") else scope_type
            series_value = "all" if series_scope == "global" else scope_value
            actual = self._rm.mtd_actual(
                metric_key, series_scope, series_value, period_start, self.day
            )
            target = Decimal(str(row["target_value"]))
            pace = None if actual is None or target <= 0 else float(actual / target) * 100
            # Elapsed share of the month for additive metrics.
            days_elapsed = (self.day - period_start).days + 1
            days_in_month = monthrange(period_start.year, period_start.month)[1]
            expected_pace = (days_elapsed / max(days_in_month, 1)) * 100
            if pace is None:
                status: Status = "unknown"
            elif pace + 3 >= expected_pace:
                status = "good"
            elif pace + 10 >= expected_pace:
                status = "watch"
            else:
                status = "bad"
            if scope_type == "store":
                scope_label = f"Store {scope_value}"
            elif scope_type in ("global", "company"):
                scope_label = "All stores"
            else:
                scope_label = f"{scope_type}:{scope_value}"
            items.append(
                TargetRow(
                    scope_type=scope_type,
                    scope_value=scope_value,
                    scope_label=scope_label,
                    metric_key=metric_key,
                    metric_label=label,
                    period_type=row["period_type"],
                    period_start=row["period_start"],
                    target_value=float(target),
                    target_display=format_display(float(target), unit),  # type: ignore[arg-type]
                    actual_value=_f(actual),
                    actual_display=None if actual is None else format_display(float(actual), unit),  # type: ignore[arg-type]
                    pace_pct=None if pace is None else round(pace, 1),
                    status=status,
                    set_by=row.get("set_by") or "system",
                )
            )
        return TargetsResponse(
            meta=self.meta(),
            period_start=period_start,
            items=items,
        )

    def alerts(self) -> AlertsResponse:
        rows = self._rm.open_alerts()
        items = [
            AttentionItem(
                id=str(r["alert_id"]),
                severity="bad" if r["severity"] == "bad" else "watch",
                title=r["title"],
                detail=r["detail"],
                metric_key=r.get("metric_key"),
                store_id=r.get("store_id"),
            )
            for r in rows
        ]
        note = (
            "Alerts come from stock risks and suggestions waiting on you."
            if items
            else (
                "Nothing needs you right now. "
                "Run `python -m quickcart.business.alerts` after seeding to refresh."
            )
        )
        return AlertsResponse(meta=self.meta(), items=items, note=note)

    def reports(self) -> ReportsResponse:
        rows = self._rm.list_reports()
        return ReportsResponse(
            meta=self.meta(),
            items=[
                ReportRow(
                    report_id=r["report_id"],
                    title=r["title"],
                    created_at=r.get("created_at"),
                    schedule=r.get("schedule"),
                )
                for r in rows
            ],
        )

    def create_report(self, body: ReportCreate, user_id: int | None = None) -> ReportRow:
        row = self._rm.create_report(body.title, body.spec, user_id)
        return ReportRow(
            report_id=row["report_id"],
            title=row["title"],
            created_at=row.get("created_at"),
            schedule=row.get("schedule"),
        )

    # --- metric glossary -----------------------------------------------------------------
    @staticmethod
    def _definition(metric: MetricDef) -> MetricDefinition:
        return MetricDefinition(
            key=metric.key,
            label=metric.label,
            plain_description=metric.plain_description,
            formula_text=metric.formula_text,
            unit=metric.unit,
            direction=metric.direction,
            gold_source=metric.gold_source,
            synonyms=metric.synonyms,
            compare_default=metric.compare_default,
            watch_at=metric.thresholds.watch,
            bad_at=metric.thresholds.bad,
            is_partial=metric.status == "partial",
            partial_note=metric.partial_note,
        )

    @classmethod
    def metrics_catalog(cls) -> MetricsCatalogResponse:
        return MetricsCatalogResponse(metrics=[cls._definition(m) for m in list_metrics()])

    def explain_metric(self, key: str) -> MetricExplainResponse:
        try:
            metric = get_metric(key)
        except KeyError:
            raise NotFoundError(f"metric {key!r} not found") from None
        series = self._global_series()
        current = self._metrics_for((key,), series)[0]
        return MetricExplainResponse(
            definition=self._definition(metric), current=current, meta=self.meta()
        )


def _int(value: Decimal | float | int | None) -> int | None:
    return None if value is None else int(value)


# --- guided journeys (static) ------------------------------------------------------------

_JOURNEYS: dict[str, dict[str, Any]] = {
    "A": {
        "title": "Start my day",
        "audience": "Store and operations managers",
        "summary": "Check how yesterday's pace compares, spot the stores that need help, "
        "and see what is about to run out.",
        "steps": [
            (
                "See today at a glance",
                "Start with sales, orders, and the basket size. "
                "Each number is compared with the same day last week.",
                "/b/today",
                ["sales_gmv", "orders", "average_basket"],
            ),
            (
                "Find the stores that need help",
                "Stores are sorted worst first. Open one to see its hourly pattern.",
                "/b/stores",
                ["on_time_rate", "cancel_rate"],
            ),
            (
                "Check what is running low",
                "These stock lines are at or below their reorder level and may sell out soon.",
                "/b/products?tab=running_low",
                ["stockout_risk_count", "availability_bestsellers"],
            ),
            (
                "Review alerts",
                "Anything that crossed a watch or bad line shows here.",
                "/b/alerts",
                [],
            ),
        ],
    },
    "B": {
        "title": "Why are deliveries slow?",
        "audience": "Delivery and rider operations",
        "summary": "Follow late deliveries from the company view down to the store.",
        "steps": [
            (
                "Check delivery health",
                "On-time share, late share, and average delivery time for the day.",
                "/b/delivery",
                ["on_time_rate", "late_rate", "avg_delivery_minutes"],
            ),
            (
                "Compare stores",
                "The table lists stores worst first so you can see whether "
                "slowness is everywhere or in a few places.",
                "/b/delivery",
                ["on_time_rate"],
            ),
            (
                "Understand the number",
                "Read exactly how late rate is defined before acting on it.",
                "/b/metrics/late_rate",
                ["late_rate"],
            ),
            (
                "Look at the busiest store",
                "Open the weakest store to compare its hourly orders with its delivery times.",
                "/b/stores",
                ["orders"],
            ),
        ],
    },
    "C": {
        "title": "Is the money healthy?",
        "audience": "Finance and leadership",
        "summary": "Sales, discounts, refunds, and which categories carry the day.",
        "steps": [
            (
                "Sales and basket",
                "Total sales and the average basket against last week.",
                "/b/money",
                ["sales_gmv", "average_basket"],
            ),
            (
                "Discounts and refunds",
                "How much was given away and how much came back.",
                "/b/money",
                [],
            ),
            (
                "Category mix",
                "Which categories contribute the most sales today.",
                "/b/money",
                [],
            ),
            (
                "Customer health",
                "Active and returning customers behind the sales.",
                "/b/customers",
                ["active_customers", "repeat_rate"],
            ),
        ],
    },
    "D": {
        "title": "Did my promo work?",
        "audience": "Category and city managers",
        "summary": "See discount spend, which promotions were redeemed, and whether sales moved.",
        "steps": [
            (
                "Look at discount spend",
                "Open Money and check how much was given away versus last week.",
                "/b/money",
                ["sales_gmv"],
            ),
            (
                "Check sales pace",
                "Compare sales and basket size for the promo window with the same weekdays before.",
                "/b/today",
                ["sales_gmv", "average_basket"],
            ),
            (
                "See who bought",
                "New versus returning customers help tell whether the promo brought new demand.",
                "/b/customers",
                ["active_customers", "repeat_rate"],
            ),
            (
                "Decide next step",
                "Pause, extend, or leave the promo alone — the assistant can draft a suggestion.",
                "/b/actions",
                [],
            ),
        ],
    },
    "E": {
        "title": "Prepare my weekly review",
        "audience": "City managers and leadership",
        "summary": "Build a short weekly story: sales, stores, delivery, stock, customers.",
        "steps": [
            (
                "Sales this week",
                "Start on Today, then open Money for the seven-day trend.",
                "/b/today",
                ["sales_gmv", "orders"],
            ),
            (
                "Best and worst stores",
                "The store list is sorted worst first — note one win and one risk.",
                "/b/stores",
                ["on_time_rate", "cancel_rate"],
            ),
            (
                "Delivery promise",
                "Check on-time share and average delivery time.",
                "/b/delivery",
                ["on_time_rate", "avg_delivery_minutes"],
            ),
            (
                "Stock and customers",
                "Scan products running low and whether customers keep coming back.",
                "/b/products?tab=running_low",
                ["stockout_risk_count", "repeat_rate"],
            ),
            (
                "Targets and report",
                "Confirm month-to-date pace, then save a report draft.",
                "/b/targets",
                ["sales_gmv"],
            ),
        ],
    },
}


def list_journeys() -> list[JourneySummary]:
    return [
        JourneySummary(
            id=jid,
            title=j["title"],
            audience=j["audience"],
            summary=j["summary"],
            step_count=len(j["steps"]),
        )
        for jid, j in _JOURNEYS.items()
    ]


def journey_step(journey_id: str, n: int) -> JourneyStep:
    journey = _JOURNEYS.get(journey_id.upper())
    if journey is None:
        raise NotFoundError(f"journey {journey_id!r} not found")
    steps = journey["steps"]
    if not 1 <= n <= len(steps):
        raise NotFoundError(f"journey {journey_id.upper()} has no step {n}")
    title, body, link, keys = steps[n - 1]
    return JourneyStep(
        journey_id=journey_id.upper(),
        n=n,
        total=len(steps),
        title=title,
        body=body,
        link=link,
        metric_keys=keys,
        prev_n=n - 1 if n > 1 else None,
        next_n=n + 1 if n < len(steps) else None,
    )
