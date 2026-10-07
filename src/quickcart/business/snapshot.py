"""Serving snapshot job: aggregate business metrics into ``serving.*``.

Two input paths produce the same facts, and one pure builder turns facts into
rows, so Gold and the Postgres fallback cannot drift apart:

* **Gold** (when ``GoldReaders`` is supplied): order, cancel, GMV, and delivery
  facts come from ``gold_store_hourly_metrics``.
* **Postgres fallback** (no Spark, or Gold unreadable): the same facts are
  computed from ``orders`` and ``deliveries``.

Payments, distinct customers, inventory, and categories always come from the
operational tables (Gold has no daily grain for them). Writes are upserts keyed
by (scope, metric, period), so re-running is idempotent.

Days and hours are UTC. Percent values are 0..1 fractions.

CLI: ``python -m quickcart.business.snapshot [--days N] [--no-gold]``.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any

import psycopg
import structlog
from psycopg.rows import dict_row

from quickcart.semantics.registry import get_metric, status_for

if TYPE_CHECKING:
    from quickcart.lakehouse.readers import GoldReaders

log = structlog.get_logger(__name__)

DEFAULT_WINDOW_DAYS = 14
BASELINE_OFFSET_DAYS = 7  # compare_default: same_day_last_week
REPEAT_WINDOW_DAYS = 30
TOP_PRODUCTS = 20
_QUANT = Decimal("0.0001")
ZERO = Decimal(0)

# Metrics shown on a store scorecard and the column that stores each one.
SCORECARD_COLUMNS: dict[str, str] = {
    "sales_gmv": "sales",
    "orders": "orders",
    "average_basket": "average_basket",
    "on_time_rate": "on_time_rate",
    "late_rate": "late_rate",
    "cancel_rate": "cancel_rate",
    "avg_delivery_minutes": "avg_delivery_minutes",
    "payment_failure_rate": "payment_failure_rate",
    "stockout_risk_count": "stockout_risk_count",
    "active_customers": "active_customers",
}
# Metrics that drive a store's overall health colour (a subset of the above).
HEALTH_METRICS = (
    "sales_gmv",
    "orders",
    "on_time_rate",
    "cancel_rate",
    "payment_failure_rate",
    "stockout_risk_count",
)


# --- facts ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StoreHourFact:
    """Order and delivery counts for one store-hour, attributed to the order's placed hour."""

    hour: datetime  # tz-aware UTC, truncated to the hour
    store_id: int
    orders: int
    cancelled: int
    gmv: Decimal
    delivered: int = 0
    late: int = 0
    timed_deliveries: int = 0  # delivered orders with both pick-up and delivery timestamps
    delivery_minutes_sum: Decimal = ZERO


@dataclass(frozen=True)
class InventoryFact:
    below_reorder: int
    top_lines: int
    top_below: int


@dataclass(frozen=True)
class CategoryFact:
    day: date
    category: str
    sales: Decimal
    units: int
    orders: int


@dataclass
class SnapshotInputs:
    source: str  # 'gold' | 'postgres'
    as_of: date
    days: list[date]
    store_ids: list[int]
    hour_facts: list[StoreHourFact]
    payments: dict[tuple[datetime, int], tuple[int, int]] = field(default_factory=dict)
    customers: dict[tuple[date, int | None], int] = field(default_factory=dict)
    repeat: dict[date, tuple[int, int]] = field(default_factory=dict)  # day -> (repeaters, buyers)
    inventory: dict[int | None, InventoryFact] = field(default_factory=dict)
    categories: list[CategoryFact] = field(default_factory=list)
    detail: dict[str, Any] = field(default_factory=dict)


# --- plan rows -----------------------------------------------------------------------


@dataclass(frozen=True)
class DailyRow:
    scope_type: str
    scope_value: str
    metric_key: str
    day: date
    value: Decimal | None
    numerator: Decimal | None = None
    denominator: Decimal | None = None


@dataclass(frozen=True)
class HourlyRow:
    scope_type: str
    scope_value: str
    metric_key: str
    hour_start: datetime
    value: Decimal | None


@dataclass(frozen=True)
class ScorecardRow:
    store_id: int
    day: date
    values: dict[str, Decimal | None]  # keyed by SCORECARD_COLUMNS column names
    health_status: str


@dataclass
class SnapshotPlan:
    daily: list[DailyRow] = field(default_factory=list)
    hourly: list[HourlyRow] = field(default_factory=list)
    scorecards: list[ScorecardRow] = field(default_factory=list)
    categories: list[CategoryFact] = field(default_factory=list)

    @property
    def row_count(self) -> int:
        return len(self.daily) + len(self.hourly) + len(self.scorecards) + len(self.categories)


# --- pure aggregation ----------------------------------------------------------------


@dataclass
class _Agg:
    orders: int = 0
    cancelled: int = 0
    gmv: Decimal = ZERO
    delivered: int = 0
    late: int = 0
    timed: int = 0
    minutes: Decimal = ZERO
    pay_attempts: int = 0
    pay_failed: int = 0

    def add(self, other: _Agg) -> None:
        self.orders += other.orders
        self.cancelled += other.cancelled
        self.gmv += other.gmv
        self.delivered += other.delivered
        self.late += other.late
        self.timed += other.timed
        self.minutes += other.minutes
        self.pay_attempts += other.pay_attempts
        self.pay_failed += other.pay_failed


def _q(value: Decimal | float | int | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value)).quantize(_QUANT, rounding=ROUND_HALF_UP)


def _ratio(numerator: int | Decimal, denominator: int | Decimal) -> Decimal | None:
    if not denominator:
        return None
    return _q(Decimal(numerator) / Decimal(denominator))


def _day_of(hour: datetime) -> date:
    return hour.astimezone(UTC).date()


def _agg_metrics(agg: _Agg) -> dict[str, tuple[Decimal | None, Decimal | None, Decimal | None]]:
    """metric_key -> (value, numerator, denominator) for the order/delivery/payment metrics."""
    successful = agg.orders - agg.cancelled
    late_rate = _ratio(agg.late, agg.delivered)
    return {
        "sales_gmv": (_q(agg.gmv), None, None),
        "orders": (Decimal(agg.orders), None, None),
        "average_basket": (_ratio(agg.gmv, successful), agg.gmv, Decimal(successful)),
        "cancel_rate": (
            _ratio(agg.cancelled, agg.orders),
            Decimal(agg.cancelled),
            Decimal(agg.orders),
        ),
        "late_rate": (late_rate, Decimal(agg.late), Decimal(agg.delivered)),
        "on_time_rate": (
            None if late_rate is None else _q(Decimal(1) - late_rate),
            Decimal(agg.delivered - agg.late),
            Decimal(agg.delivered),
        ),
        "avg_delivery_minutes": (
            _ratio(agg.minutes, agg.timed),
            _q(agg.minutes),
            Decimal(agg.timed),
        ),
        "payment_failure_rate": (
            _ratio(agg.pay_failed, agg.pay_attempts),
            Decimal(agg.pay_failed),
            Decimal(agg.pay_attempts),
        ),
    }


def _worst_status(statuses: Iterable[str]) -> str:
    rank = {"good": 1, "watch": 2, "bad": 3}
    known = [s for s in statuses if s in rank]
    return max(known, key=rank.__getitem__) if known else "unknown"


def build_plan(inputs: SnapshotInputs) -> SnapshotPlan:
    """Turn facts into serving rows (pure; no I/O)."""
    by_store_day: dict[tuple[int, date], _Agg] = defaultdict(_Agg)
    hourly_store: dict[tuple[int, datetime], _Agg] = defaultdict(_Agg)
    hourly_global: dict[datetime, _Agg] = defaultdict(_Agg)

    for fact in inputs.hour_facts:
        hour = fact.hour.astimezone(UTC)
        piece = _Agg(
            orders=fact.orders,
            cancelled=fact.cancelled,
            gmv=fact.gmv,
            delivered=fact.delivered,
            late=fact.late,
            timed=fact.timed_deliveries,
            minutes=fact.delivery_minutes_sum,
        )
        by_store_day[(fact.store_id, _day_of(hour))].add(piece)
        hourly_store[(fact.store_id, hour)].add(piece)
        hourly_global[hour].add(piece)

    for (hour, store_id), (attempts, failed) in inputs.payments.items():
        piece = _Agg(pay_attempts=attempts, pay_failed=failed)
        by_store_day[(store_id, _day_of(hour))].add(piece)

    store_ids = sorted(set(inputs.store_ids) | {sid for sid, _ in by_store_day})
    plan = SnapshotPlan(categories=list(inputs.categories))
    day_values: dict[tuple[str, str, str, date], Decimal | None] = {}

    def emit(
        scope_type: str,
        scope_value: str,
        key: str,
        day: date,
        value: Decimal | None,
        num: Decimal | None = None,
        den: Decimal | None = None,
    ) -> None:
        plan.daily.append(DailyRow(scope_type, scope_value, key, day, value, num, den))
        day_values[(scope_type, scope_value, key, day)] = value

    for day in inputs.days:
        global_agg = _Agg()
        for store_id in store_ids:
            store_agg = by_store_day.get((store_id, day), _Agg())
            global_agg.add(store_agg)
            for key, (value, num, den) in _agg_metrics(store_agg).items():
                emit("store", str(store_id), key, day, value, num, den)
        for key, (value, num, den) in _agg_metrics(global_agg).items():
            emit("global", "all", key, day, value, num, den)

        for (cust_day, cust_store), count in inputs.customers.items():
            if cust_day != day:
                continue
            scope = ("global", "all") if cust_store is None else ("store", str(cust_store))
            emit(scope[0], scope[1], "active_customers", day, Decimal(count))
        for store_id in store_ids:  # a store with no buyers has zero active customers
            if ("store", str(store_id), "active_customers", day) not in day_values:
                emit("store", str(store_id), "active_customers", day, ZERO)
        if ("global", "all", "active_customers", day) not in day_values:
            emit("global", "all", "active_customers", day, ZERO)

        if day in inputs.repeat:
            repeaters, buyers = inputs.repeat[day]
            emit(
                "global",
                "all",
                "repeat_rate",
                day,
                _ratio(repeaters, buyers),
                Decimal(repeaters),
                Decimal(buyers),
            )

    # Inventory is a current-stock reading, so it is stamped on the as-of day only.
    for scope_store, inv in inputs.inventory.items():
        scope = ("global", "all") if scope_store is None else ("store", str(scope_store))
        emit(*scope, "stockout_risk_count", inputs.as_of, Decimal(inv.below_reorder))
        emit(
            *scope,
            "availability_bestsellers",
            inputs.as_of,
            None if inv.top_lines == 0 else _ratio(inv.top_lines - inv.top_below, inv.top_lines),
            Decimal(inv.top_lines - inv.top_below),
            Decimal(inv.top_lines),
        )

    for (store_id, hour), agg in sorted(hourly_store.items()):
        plan.hourly.append(HourlyRow("store", str(store_id), "sales_gmv", hour, _q(agg.gmv)))
        plan.hourly.append(HourlyRow("store", str(store_id), "orders", hour, Decimal(agg.orders)))
    for hour, agg in sorted(hourly_global.items()):
        plan.hourly.append(HourlyRow("global", "all", "sales_gmv", hour, _q(agg.gmv)))
        plan.hourly.append(HourlyRow("global", "all", "orders", hour, Decimal(agg.orders)))

    for day in inputs.days:
        baseline_day = day - timedelta(days=BASELINE_OFFSET_DAYS)
        for store_id in store_ids:
            values = {
                column: day_values.get(("store", str(store_id), key, day))
                for key, column in SCORECARD_COLUMNS.items()
            }
            statuses = [
                status_for(
                    day_values.get(("store", str(store_id), key, day)),
                    get_metric(key),
                    day_values.get(("store", str(store_id), key, baseline_day)),
                )
                for key in HEALTH_METRICS
            ]
            plan.scorecards.append(ScorecardRow(store_id, day, values, _worst_status(statuses)))
    return plan


# --- Postgres inputs -----------------------------------------------------------------

_AS_OF_SQL = "SELECT max((placed_at AT TIME ZONE 'UTC')::date) AS as_of FROM orders"

_STORES_SQL = "SELECT store_id FROM stores WHERE is_active ORDER BY store_id"

_HOUR_FACTS_SQL = """
SELECT
    date_trunc('hour', o.placed_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour_start,
    o.store_id,
    count(*)::int AS orders,
    (count(*) FILTER (WHERE o.status = 'CANCELLED'))::int AS cancelled,
    coalesce(sum(o.total_amount) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS gmv,
    (count(d.delivery_id) FILTER (
        WHERE d.status = 'DELIVERED' AND d.delivered_at IS NOT NULL))::int AS delivered,
    (count(d.delivery_id) FILTER (
        WHERE d.status = 'DELIVERED' AND d.delivered_at > d.promised_by))::int AS late,
    (count(d.delivery_id) FILTER (
        WHERE d.status = 'DELIVERED'
          AND d.delivered_at IS NOT NULL AND d.picked_up_at IS NOT NULL))::int AS timed,
    coalesce(sum(extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60.0) FILTER (
        WHERE d.status = 'DELIVERED'
          AND d.delivered_at IS NOT NULL AND d.picked_up_at IS NOT NULL), 0) AS minutes_sum
FROM orders o
LEFT JOIN deliveries d ON d.order_id = o.order_id
WHERE o.placed_at >= %(start)s AND o.placed_at < %(end)s
GROUP BY 1, 2
"""

_PAYMENTS_SQL = """
SELECT
    date_trunc('hour', o.placed_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour_start,
    o.store_id,
    count(*)::int AS attempts,
    (count(*) FILTER (WHERE p.status = 'FAILED'))::int AS failed
FROM payments p
JOIN orders o ON o.order_id = p.order_id
WHERE o.placed_at >= %(start)s AND o.placed_at < %(end)s
GROUP BY 1, 2
"""

_CUSTOMERS_SQL = """
SELECT
    (placed_at AT TIME ZONE 'UTC')::date AS day,
    store_id,
    count(DISTINCT customer_id)::int AS customers
FROM orders
WHERE status <> 'CANCELLED' AND placed_at >= %(start)s AND placed_at < %(end)s
GROUP BY GROUPING SETS ((1, 2), (1))
"""

_REPEAT_SQL = """
SELECT
    (count(*) FILTER (WHERE n >= 2))::int AS repeaters,
    count(*)::int AS buyers
FROM (
    SELECT customer_id, count(*) AS n
    FROM orders
    WHERE status <> 'CANCELLED' AND placed_at >= %(start)s AND placed_at < %(end)s
    GROUP BY customer_id
) per_customer
"""

_INVENTORY_SQL = """
WITH top_products AS (
    SELECT oi.product_id
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    WHERE o.status <> 'CANCELLED' AND o.placed_at >= %(top_start)s AND o.placed_at < %(end)s
    GROUP BY oi.product_id
    ORDER BY sum(oi.line_total) DESC, oi.product_id
    LIMIT %(top_n)s
)
SELECT
    i.store_id,
    (count(*) FILTER (WHERE i.on_hand_qty <= i.reorder_point))::int AS below_reorder,
    (count(*) FILTER (WHERE i.product_id IN (SELECT product_id FROM top_products)))::int
        AS top_lines,
    (count(*) FILTER (
        WHERE i.product_id IN (SELECT product_id FROM top_products)
          AND i.on_hand_qty <= i.reorder_point))::int AS top_below
FROM inventory i
GROUP BY ROLLUP (i.store_id)
"""

_CATEGORIES_SQL = """
SELECT
    (o.placed_at AT TIME ZONE 'UTC')::date AS day,
    p.category,
    coalesce(sum(oi.line_total), 0) AS sales,
    coalesce(sum(oi.quantity), 0)::bigint AS units,
    count(DISTINCT o.order_id)::int AS orders
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN products p ON p.product_id = oi.product_id
WHERE o.status <> 'CANCELLED' AND o.placed_at >= %(start)s AND o.placed_at < %(end)s
GROUP BY 1, 2
"""


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def window_days(as_of: date, days: int) -> list[date]:
    """``days`` consecutive UTC days ending at ``as_of`` (oldest first)."""
    return [as_of - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def _fetch(conn: psycopg.Connection, sql: str, params: dict[str, Any] | None = None) -> list[Any]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params or {})
        return list(cur.fetchall())


def resolve_as_of(conn: psycopg.Connection) -> date:
    """Latest UTC day with orders, so a demo on historical data still has a 'today'."""
    rows = _fetch(conn, _AS_OF_SQL)
    latest = rows[0]["as_of"] if rows else None
    return latest or datetime.now(UTC).date()


def _postgres_hour_facts(
    conn: psycopg.Connection, start: datetime, end: datetime
) -> list[StoreHourFact]:
    return [
        StoreHourFact(
            hour=row["hour_start"].astimezone(UTC),
            store_id=int(row["store_id"]),
            orders=int(row["orders"]),
            cancelled=int(row["cancelled"]),
            gmv=Decimal(row["gmv"]),
            delivered=int(row["delivered"]),
            late=int(row["late"]),
            timed_deliveries=int(row["timed"]),
            delivery_minutes_sum=Decimal(str(row["minutes_sum"])),
        )
        for row in _fetch(conn, _HOUR_FACTS_SQL, {"start": start, "end": end})
    ]


def _collect_ops_inputs(
    conn: psycopg.Connection,
    *,
    source: str,
    as_of: date,
    days: list[date],
    hour_facts: list[StoreHourFact] | None,
    detail: dict[str, Any],
) -> SnapshotInputs:
    """Read what Gold cannot provide (plus order facts for the fallback) in one transaction."""
    start, end = _day_start(days[0]), _day_start(as_of) + timedelta(days=1)
    window = {"start": start, "end": end}
    with conn.transaction():
        stores = [int(r["store_id"]) for r in _fetch(conn, _STORES_SQL)]
        facts = hour_facts if hour_facts is not None else _postgres_hour_facts(conn, start, end)
        payments = {
            (row["hour_start"].astimezone(UTC), int(row["store_id"])): (
                int(row["attempts"]),
                int(row["failed"]),
            )
            for row in _fetch(conn, _PAYMENTS_SQL, window)
        }
        customers = {
            (row["day"], None if row["store_id"] is None else int(row["store_id"])): int(
                row["customers"]
            )
            for row in _fetch(conn, _CUSTOMERS_SQL, window)
        }
        repeat: dict[date, tuple[int, int]] = {}
        for day in (as_of, as_of - timedelta(days=BASELINE_OFFSET_DAYS)):
            if day not in days:
                continue
            row = _fetch(
                conn,
                _REPEAT_SQL,
                {
                    "start": _day_start(day) - timedelta(days=REPEAT_WINDOW_DAYS - 1),
                    "end": _day_start(day) + timedelta(days=1),
                },
            )[0]
            repeat[day] = (int(row["repeaters"]), int(row["buyers"]))
        inventory = {
            (None if row["store_id"] is None else int(row["store_id"])): InventoryFact(
                int(row["below_reorder"]), int(row["top_lines"]), int(row["top_below"])
            )
            for row in _fetch(
                conn,
                _INVENTORY_SQL,
                {"top_start": end - timedelta(days=7), "end": end, "top_n": TOP_PRODUCTS},
            )
        }
        categories = [
            CategoryFact(
                day=row["day"],
                category=row["category"],
                sales=Decimal(row["sales"]),
                units=int(row["units"]),
                orders=int(row["orders"]),
            )
            for row in _fetch(conn, _CATEGORIES_SQL, window)
        ]
    return SnapshotInputs(
        source=source,
        as_of=as_of,
        days=days,
        store_ids=stores,
        hour_facts=facts,
        payments=payments,
        customers=customers,
        repeat=repeat,
        inventory=inventory,
        categories=categories,
        detail=detail,
    )


def collect_postgres_inputs(
    conn: psycopg.Connection,
    *,
    days: int = DEFAULT_WINDOW_DAYS,
    as_of: date | None = None,
) -> SnapshotInputs:
    """Compute every input from operational tables (no Spark needed)."""
    with conn.transaction():
        resolved = as_of or resolve_as_of(conn)
    return _collect_ops_inputs(
        conn,
        source="postgres",
        as_of=resolved,
        days=window_days(resolved, days),
        hour_facts=None,
        detail={},
    )


# --- Gold inputs ---------------------------------------------------------------------


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def collect_gold_hour_facts(readers: GoldReaders, *, days: int) -> tuple[date, list[StoreHourFact]]:
    """Read ``gold_store_hourly_metrics`` for the last ``days`` days up to Gold's latest hour."""
    from pyspark.sql import functions as F

    hourly = readers.store_hourly_metrics()
    latest = hourly.agg(F.max("metric_hour")).first()[0]
    if latest is None:
        raise RuntimeError("gold_store_hourly_metrics is empty")
    as_of = _as_utc(latest).date()
    start = _day_start(as_of - timedelta(days=days - 1))
    rows = hourly.filter(F.col("metric_hour") >= F.lit(start.replace(tzinfo=None))).collect()
    facts: list[StoreHourFact] = []
    for row in rows:
        delivered = int(row["orders_delivered"] or 0)
        late_rate = row["late_delivery_rate"]
        avg_minutes = row["avg_delivery_minutes"]
        timed = delivered if avg_minutes is not None else 0
        facts.append(
            StoreHourFact(
                hour=_as_utc(row["metric_hour"]),
                store_id=int(row["store_id"]),
                orders=int(row["orders_placed"] or 0),
                cancelled=int(row["orders_cancelled"] or 0),
                gmv=Decimal(row["gmv"] or 0),
                delivered=delivered,
                late=round(float(late_rate or 0) * delivered),
                timed_deliveries=timed,
                delivery_minutes_sum=Decimal(str(float(avg_minutes or 0) * timed)),
            )
        )
    return as_of, facts


# --- writes --------------------------------------------------------------------------

_DAILY_UPSERT = """
INSERT INTO serving.metric_daily (
    scope_type, scope_value, metric_key, day, value, numerator, denominator,
    snapshot_run_id, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (scope_type, scope_value, metric_key, day) DO UPDATE SET
    value = EXCLUDED.value,
    numerator = EXCLUDED.numerator,
    denominator = EXCLUDED.denominator,
    snapshot_run_id = EXCLUDED.snapshot_run_id,
    updated_at = now()
"""

_HOURLY_UPSERT = """
INSERT INTO serving.metric_hourly (
    scope_type, scope_value, metric_key, hour_start, value, snapshot_run_id, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, now())
ON CONFLICT (scope_type, scope_value, metric_key, hour_start) DO UPDATE SET
    value = EXCLUDED.value,
    snapshot_run_id = EXCLUDED.snapshot_run_id,
    updated_at = now()
"""

_SCORECARD_UPSERT = """
INSERT INTO serving.store_scorecard (
    store_id, day, sales, orders, average_basket, on_time_rate, late_rate, cancel_rate,
    avg_delivery_minutes, payment_failure_rate, stockout_risk_count, active_customers,
    health_status, snapshot_run_id, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (store_id, day) DO UPDATE SET
    sales = EXCLUDED.sales,
    orders = EXCLUDED.orders,
    average_basket = EXCLUDED.average_basket,
    on_time_rate = EXCLUDED.on_time_rate,
    late_rate = EXCLUDED.late_rate,
    cancel_rate = EXCLUDED.cancel_rate,
    avg_delivery_minutes = EXCLUDED.avg_delivery_minutes,
    payment_failure_rate = EXCLUDED.payment_failure_rate,
    stockout_risk_count = EXCLUDED.stockout_risk_count,
    active_customers = EXCLUDED.active_customers,
    health_status = EXCLUDED.health_status,
    snapshot_run_id = EXCLUDED.snapshot_run_id,
    updated_at = now()
"""

_CATEGORY_UPSERT = """
INSERT INTO serving.category_daily (
    category, day, sales, units, orders, snapshot_run_id, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, now())
ON CONFLICT (category, day) DO UPDATE SET
    sales = EXCLUDED.sales,
    units = EXCLUDED.units,
    orders = EXCLUDED.orders,
    snapshot_run_id = EXCLUDED.snapshot_run_id,
    updated_at = now()
"""

_MARGIN_UPSERT = """
INSERT INTO serving.margin_daily (
    store_id, day, gross_sales, discounts, net_sales, cogs, cost_coverage,
    refunds, contribution_margin, margin_pct, orders, updated_at
) VALUES (
    %(store_id)s, %(day)s, %(gross_sales)s, %(discounts)s, %(net_sales)s,
    %(cogs)s, %(cost_coverage)s, %(refunds)s, %(contribution_margin)s,
    %(margin_pct)s, %(orders)s, now()
)
ON CONFLICT (store_id, day) DO UPDATE SET
    gross_sales = EXCLUDED.gross_sales,
    discounts = EXCLUDED.discounts,
    net_sales = EXCLUDED.net_sales,
    cogs = EXCLUDED.cogs,
    cost_coverage = EXCLUDED.cost_coverage,
    refunds = EXCLUDED.refunds,
    contribution_margin = EXCLUDED.contribution_margin,
    margin_pct = EXCLUDED.margin_pct,
    orders = EXCLUDED.orders,
    updated_at = now()
"""

_MARGIN_SQL = """
WITH bounds AS (
  SELECT
    (max((placed_at AT TIME ZONE 'UTC')::date) - (%(days)s - 1)) AS start_day,
    max((placed_at AT TIME ZONE 'UTC')::date) AS end_day
  FROM orders
),
order_day AS (
  SELECT
    o.store_id,
    (o.placed_at AT TIME ZONE 'UTC')::date AS day,
    o.order_id,
    o.status,
    coalesce(o.subtotal, o.total_amount) + coalesce(o.item_discount, 0)
      + coalesce(o.promo_discount, 0) AS gross,
    coalesce(o.item_discount, 0) + coalesce(o.promo_discount, 0) AS discounts,
    o.total_amount
  FROM orders o, bounds b
  WHERE (o.placed_at AT TIME ZONE 'UTC')::date BETWEEN b.start_day AND b.end_day
    AND o.status <> 'CANCELLED'
),
order_agg AS (
  SELECT store_id, day,
         coalesce(sum(gross), 0) AS gross_sales,
         coalesce(sum(discounts), 0) AS discounts,
         coalesce(sum(gross - discounts), 0) AS net_sales,
         coalesce(sum(total_amount) FILTER (WHERE status = 'REFUNDED'), 0) AS refunds,
         count(*)::int AS orders
  FROM order_day
  GROUP BY store_id, day
),
cogs_agg AS (
  SELECT od.store_id, od.day,
         sum(oi.quantity * oi.unit_cost)
           FILTER (WHERE oi.unit_cost IS NOT NULL) AS cogs,
         avg(CASE WHEN oi.unit_cost IS NOT NULL THEN 1.0 ELSE 0.0 END) AS cost_coverage
  FROM order_day od
  JOIN order_items oi ON oi.order_id = od.order_id
  GROUP BY od.store_id, od.day
)
SELECT
  a.store_id, a.day, a.gross_sales, a.discounts, a.net_sales,
  c.cogs, c.cost_coverage, a.refunds,
  CASE WHEN c.cogs IS NOT NULL THEN a.net_sales - c.cogs - a.refunds END
    AS contribution_margin,
  CASE
    WHEN c.cogs IS NOT NULL AND a.net_sales > 0
    THEN round((a.net_sales - c.cogs - a.refunds) / a.net_sales, 4)
  END AS margin_pct,
  a.orders
FROM order_agg a
LEFT JOIN cogs_agg c USING (store_id, day)
"""

_START_RUN_SQL = """
INSERT INTO serving.snapshot_runs (status, window_days) VALUES ('running', %s)
RETURNING snapshot_run_id
"""

_FINISH_RUN_SQL = """
UPDATE serving.snapshot_runs
SET status = 'succeeded', finished_at = now(), source = %s, as_of_day = %s,
    rows_written = %s, detail = %s::jsonb
WHERE snapshot_run_id = %s
"""

_FAIL_RUN_SQL = """
UPDATE serving.snapshot_runs
SET status = 'failed', finished_at = now(), error = %s
WHERE snapshot_run_id = %s
"""


def _int_or_none(value: Decimal | None) -> int | None:
    return None if value is None else int(value)


def _write_plan(conn: psycopg.Connection, run_id: int, plan: SnapshotPlan) -> int:
    with conn.cursor() as cur:
        cur.executemany(
            _DAILY_UPSERT,
            [
                (
                    r.scope_type,
                    r.scope_value,
                    r.metric_key,
                    r.day,
                    r.value,
                    r.numerator,
                    r.denominator,
                    run_id,
                )
                for r in plan.daily
            ],
        )
        cur.executemany(
            _HOURLY_UPSERT,
            [
                (r.scope_type, r.scope_value, r.metric_key, r.hour_start, r.value, run_id)
                for r in plan.hourly
            ],
        )
        cur.executemany(
            _SCORECARD_UPSERT,
            [
                (
                    r.store_id,
                    r.day,
                    r.values["sales"],
                    _int_or_none(r.values["orders"]),
                    r.values["average_basket"],
                    r.values["on_time_rate"],
                    r.values["late_rate"],
                    r.values["cancel_rate"],
                    r.values["avg_delivery_minutes"],
                    r.values["payment_failure_rate"],
                    _int_or_none(r.values["stockout_risk_count"]),
                    _int_or_none(r.values["active_customers"]),
                    r.health_status,
                    run_id,
                )
                for r in plan.scorecards
            ],
        )
        cur.executemany(
            _CATEGORY_UPSERT,
            [(r.category, r.day, r.sales, r.units, r.orders, run_id) for r in plan.categories],
        )
    return plan.row_count


def _write_margin_daily(conn: psycopg.Connection, days: int) -> int:
    """Refresh ``serving.margin_daily`` from operational tables (B6)."""
    try:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(_MARGIN_SQL, {"days": days})
            rows = list(cur.fetchall())
            if not rows:
                return 0
            cur.executemany(_MARGIN_UPSERT, rows)
            return len(rows)
    except psycopg.errors.UndefinedTable:
        log.warning("serving.margin_daily_missing_skipping")
        return 0
    except psycopg.errors.UndefinedColumn:
        log.warning("serving.margin_columns_missing_skipping")
        return 0


# --- entry points --------------------------------------------------------------------


def _collect_inputs(
    conn: psycopg.Connection, readers: GoldReaders | None, days: int
) -> SnapshotInputs:
    if readers is not None:
        try:
            as_of, facts = collect_gold_hour_facts(readers, days=days)
            return _collect_ops_inputs(
                conn,
                source="gold",
                as_of=as_of,
                days=window_days(as_of, days),
                hour_facts=facts,
                detail={"order_facts": "gold_store_hourly_metrics"},
            )
        except Exception as exc:  # Gold unreadable: serve from operational tables instead
            log.warning("serving.gold_unavailable_using_postgres", error=str(exc))
            inputs = collect_postgres_inputs(conn, days=days)
            inputs.detail["gold_error"] = str(exc)
            return inputs
    return collect_postgres_inputs(conn, days=days)


def run_serving_snapshot(
    conn: psycopg.Connection,
    readers: GoldReaders | None = None,
    *,
    days: int = DEFAULT_WINDOW_DAYS,
) -> int:
    """Refresh ``serving.*`` and return the ``snapshot_run_id``.

    ``conn`` must be idle (no open caller transaction). Gold supplies order and
    delivery facts when ``readers`` is given and readable; otherwise everything is
    computed from Postgres. Safe to re-run: every write is an upsert.
    """
    if days < BASELINE_OFFSET_DAYS + 1:
        raise ValueError(f"days must be at least {BASELINE_OFFSET_DAYS + 1} to compare weeks")
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(_START_RUN_SQL, (days,))
        run_id = int(cur.fetchone()[0])
    try:
        inputs = _collect_inputs(conn, readers, days)
        plan = build_plan(inputs)
        with conn.transaction():
            rows = _write_plan(conn, run_id, plan)
            margin_rows = _write_margin_daily(conn, days)
            rows += margin_rows
            with conn.cursor() as cur:
                cur.execute(
                    _FINISH_RUN_SQL,
                    (
                        inputs.source,
                        inputs.as_of,
                        rows,
                        json.dumps(
                            {
                                **inputs.detail,
                                "stores": len(inputs.store_ids),
                                "margin_rows": margin_rows,
                            }
                        ),
                        run_id,
                    ),
                )
    except Exception as exc:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(_FAIL_RUN_SQL, (str(exc)[:2000], run_id))
        log.exception("serving.snapshot_failed", snapshot_run_id=run_id)
        raise
    log.info(
        "serving.snapshot_complete",
        snapshot_run_id=run_id,
        source=inputs.source,
        as_of=inputs.as_of.isoformat(),
        rows=rows,
    )
    return run_id


def _build_gold_readers() -> tuple[GoldReaders, Any] | None:
    """GoldReaders on a local Spark session, or None when Spark is not installed."""
    try:
        from quickcart.lakehouse.common.spark import build_spark
        from quickcart.lakehouse.readers import GoldReaders
    except ImportError:
        log.warning("serving.spark_not_installed")
        return None
    spark = build_spark("quickcart-serving-snapshot")
    return GoldReaders(spark), spark


def main(argv: list[str] | None = None) -> int:
    from quickcart.config.settings import get_settings
    from quickcart.db.connection import connect
    from quickcart.logging import configure_logging

    parser = argparse.ArgumentParser(description="Refresh the business serving read model")
    parser.add_argument("--days", type=int, default=DEFAULT_WINDOW_DAYS)
    parser.add_argument(
        "--no-gold",
        action="store_true",
        help="skip Spark/Gold and compute everything from Postgres",
    )
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)

    built = None if args.no_gold else _build_gold_readers()
    try:
        with connect() as conn:
            run_id = run_serving_snapshot(conn, built[0] if built else None, days=args.days)
    finally:
        if built is not None:
            built[1].stop()
    print(f"serving snapshot {run_id} complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
