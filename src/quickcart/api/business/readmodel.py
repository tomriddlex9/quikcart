"""Read side of the business API.

Reads come from ``serving.*`` when a successful snapshot exists. Before the first
snapshot (or if the ``serving`` schema is not migrated yet) the same figures are
computed live from the operational tables, using the snapshot module's own
queries and builder, so the two paths cannot disagree on a definition.

A :class:`ReadModel` wraps one open, read-only connection for one request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

from quickcart.business import snapshot as snap
from quickcart.business.snapshot import SnapshotPlan

LIVE_WINDOW_DAYS = snap.BASELINE_OFFSET_DAYS + 1
_MISSING_SERVING = (psycopg.errors.UndefinedTable, psycopg.errors.InvalidSchemaName)


@dataclass(frozen=True)
class AsOf:
    day: date
    source: str  # 'serving' | 'live_sql'
    snapshot_run_id: int | None = None
    finished_at: datetime | None = None


@dataclass(frozen=True)
class StoreInfo:
    store_id: int
    name: str
    city: str | None


@dataclass(frozen=True)
class StoreDay:
    values: dict[str, float | None]  # metric_key -> value
    health_status: str


Series = dict[str, dict[date, Decimal | None]]  # metric_key -> day -> value


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=UTC)
    return start, start + timedelta(days=1)


class ReadModel:
    """Everything the business service reads, behind one small surface."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn
        self._as_of: AsOf | None = None
        self._live_plan: SnapshotPlan | None = None

    # --- plumbing ------------------------------------------------------------------
    def _query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        with self._conn.transaction(), self._conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params or {})
            return list(cur.fetchall())

    def _query_serving(
        self, sql: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]] | None:
        """Run a ``serving.*`` query; ``None`` if the schema/table does not exist yet."""
        try:
            return self._query(sql, params)
        except _MISSING_SERVING:
            return None

    def as_of(self) -> AsOf:
        if self._as_of is not None:
            return self._as_of
        rows = self._query_serving(
            """
            SELECT snapshot_run_id, finished_at, as_of_day
            FROM serving.snapshot_runs
            WHERE status = 'succeeded' AND as_of_day IS NOT NULL
            ORDER BY finished_at DESC, snapshot_run_id DESC
            LIMIT 1
            """
        )
        if rows:
            row = rows[0]
            self._as_of = AsOf(
                row["as_of_day"], "serving", int(row["snapshot_run_id"]), row["finished_at"]
            )
        else:
            with self._conn.transaction():
                day = snap.resolve_as_of(self._conn)
            self._as_of = AsOf(day, "live_sql")
        return self._as_of

    def _live(self) -> SnapshotPlan:
        if self._live_plan is None:
            inputs = snap.collect_postgres_inputs(
                self._conn, days=LIVE_WINDOW_DAYS, as_of=self.as_of().day
            )
            self._live_plan = snap.build_plan(inputs)
        return self._live_plan

    # --- directory -------------------------------------------------------------------
    def stores(self) -> dict[int, StoreInfo]:
        rows = self._query(
            "SELECT store_id, name, city FROM stores WHERE is_active ORDER BY store_id"
        )
        return {
            int(r["store_id"]): StoreInfo(int(r["store_id"]), r["name"], r["city"]) for r in rows
        }

    # --- metrics ---------------------------------------------------------------------
    def metric_series(self, scope_type: str, scope_value: str, days: list[date]) -> Series:
        """All metrics for one scope on the given days (missing day -> absent)."""
        series: Series = {}
        if self.as_of().source == "serving":
            rows = self._query_serving(
                """
                SELECT metric_key, day, value FROM serving.metric_daily
                WHERE scope_type = %(scope_type)s AND scope_value = %(scope_value)s
                  AND day = ANY(%(days)s)
                """,
                {"scope_type": scope_type, "scope_value": scope_value, "days": days},
            )
            if rows is not None:
                for row in rows:
                    series.setdefault(row["metric_key"], {})[row["day"]] = row["value"]
                return series
        wanted = set(days)
        for row in self._live().daily:
            if (
                row.scope_type == scope_type
                and row.scope_value == scope_value
                and row.day in wanted
            ):
                series.setdefault(row.metric_key, {})[row.day] = row.value
        return series

    def store_days(self, days: list[date]) -> dict[date, dict[int, StoreDay]]:
        """Per-store scorecard values for the given days."""
        columns = snap.SCORECARD_COLUMNS
        if self.as_of().source == "serving":
            rows = self._query_serving(
                "SELECT * FROM serving.store_scorecard WHERE day = ANY(%(days)s)",
                {"days": days},
            )
            if rows is not None:
                out: dict[date, dict[int, StoreDay]] = {}
                for row in rows:
                    values = {key: _as_float(row[column]) for key, column in columns.items()}
                    out.setdefault(row["day"], {})[int(row["store_id"])] = StoreDay(
                        values, row["health_status"]
                    )
                return out
        wanted = set(days)
        live: dict[date, dict[int, StoreDay]] = {}
        for card in self._live().scorecards:
            if card.day in wanted:
                values = {key: _as_float(card.values[column]) for key, column in columns.items()}
                live.setdefault(card.day, {})[card.store_id] = StoreDay(values, card.health_status)
        return live

    def hourly_trend(self, scope_type: str, scope_value: str, day: date) -> list[dict[str, Any]]:
        """Hour-by-hour sales and orders on ``day`` (hours with no orders are absent)."""
        start, end = _day_bounds(day)
        rows: list[dict[str, Any]] | None = None
        if self.as_of().source == "serving":
            rows = self._query_serving(
                """
                SELECT metric_key, hour_start, value FROM serving.metric_hourly
                WHERE scope_type = %(scope_type)s AND scope_value = %(scope_value)s
                  AND hour_start >= %(start)s AND hour_start < %(end)s
                """,
                {"scope_type": scope_type, "scope_value": scope_value, "start": start, "end": end},
            )
        if rows is None:
            rows = [
                {"metric_key": r.metric_key, "hour_start": r.hour_start, "value": r.value}
                for r in self._live().hourly
                if r.scope_type == scope_type
                and r.scope_value == scope_value
                and start <= r.hour_start < end
            ]
        by_hour: dict[datetime, dict[str, Any]] = {}
        for row in rows:
            point = by_hour.setdefault(row["hour_start"], {"at": row["hour_start"]})
            point["sales" if row["metric_key"] == "sales_gmv" else "orders"] = row["value"]
        return [by_hour[hour] for hour in sorted(by_hour)]

    def category_sales(self, days: list[date]) -> list[dict[str, Any]]:
        """Sales and units per category, summed over ``days``."""
        rows: list[dict[str, Any]] | None = None
        if self.as_of().source == "serving":
            rows = self._query_serving(
                "SELECT category, day, sales, units, orders FROM serving.category_daily "
                "WHERE day = ANY(%(days)s)",
                {"days": days},
            )
        if rows is None:
            wanted = set(days)
            rows = [
                {"category": c.category, "sales": c.sales, "units": c.units, "orders": c.orders}
                for c in self._live().categories
                if c.day in wanted
            ]
        totals: dict[str, dict[str, Any]] = {}
        for row in rows:
            entry = totals.setdefault(
                row["category"], {"category": row["category"], "sales": Decimal(0), "units": 0}
            )
            entry["sales"] += Decimal(row["sales"])
            entry["units"] += int(row["units"])
        return sorted(totals.values(), key=lambda e: e["sales"], reverse=True)

    # --- operational reads (always live) ------------------------------------------------
    def running_low(self, limit: int, store_id: int | None = None) -> list[dict[str, Any]]:
        """Stock lines at or below their reorder point, emptiest first."""
        _, end = _day_bounds(self.as_of().day)
        return self._query(
            """
            SELECT i.store_id, s.name AS store_name, p.product_id, p.sku, p.name, p.category,
                   i.on_hand_qty, i.reorder_point, coalesce(sold.units, 0)::bigint AS units_7d
            FROM inventory i
            JOIN products p ON p.product_id = i.product_id
            JOIN stores s ON s.store_id = i.store_id
            LEFT JOIN (
                SELECT store_id, product_id, sum(-quantity_delta) AS units
                FROM inventory_movements
                WHERE movement_type = 'SALE' AND occurred_at >= %(since)s AND occurred_at < %(end)s
                GROUP BY store_id, product_id
            ) sold ON sold.store_id = i.store_id AND sold.product_id = i.product_id
            WHERE i.on_hand_qty <= i.reorder_point AND p.is_active AND s.is_active
              AND (%(store_id)s::bigint IS NULL OR i.store_id = %(store_id)s)
            ORDER BY i.on_hand_qty ASC, coalesce(sold.units, 0) DESC, i.store_id, p.product_id
            LIMIT %(limit)s
            """,
            {"since": end - timedelta(days=7), "end": end, "store_id": store_id, "limit": limit},
        )

    def bestsellers(self, limit: int) -> list[dict[str, Any]]:
        """Top products by revenue over the last 7 days."""
        _, end = _day_bounds(self.as_of().day)
        return self._query(
            """
            SELECT p.product_id, p.sku, p.name, p.category,
                   sum(oi.quantity)::bigint AS units, sum(oi.line_total) AS revenue
            FROM order_items oi
            JOIN orders o ON o.order_id = oi.order_id
            JOIN products p ON p.product_id = oi.product_id
            WHERE o.status <> 'CANCELLED' AND o.placed_at >= %(since)s AND o.placed_at < %(end)s
            GROUP BY p.product_id, p.sku, p.name, p.category
            ORDER BY revenue DESC, p.product_id
            LIMIT %(limit)s
            """,
            {"since": end - timedelta(days=7), "end": end, "limit": limit},
        )

    def slow_movers(self, limit: int) -> list[dict[str, Any]]:
        """Stocked products that sold the least over the last 14 days."""
        _, end = _day_bounds(self.as_of().day)
        return self._query(
            """
            SELECT p.product_id, p.sku, p.name, p.category,
                   coalesce(s.units, 0)::bigint AS units, coalesce(s.revenue, 0) AS revenue,
                   inv.on_hand::bigint AS on_hand
            FROM products p
            JOIN (
                SELECT product_id, sum(on_hand_qty) AS on_hand FROM inventory GROUP BY product_id
            ) inv ON inv.product_id = p.product_id AND inv.on_hand > 0
            LEFT JOIN (
                SELECT oi.product_id, sum(oi.quantity) AS units, sum(oi.line_total) AS revenue
                FROM order_items oi
                JOIN orders o ON o.order_id = oi.order_id
                WHERE o.status <> 'CANCELLED'
                  AND o.placed_at >= %(since)s AND o.placed_at < %(end)s
                GROUP BY oi.product_id
            ) s ON s.product_id = p.product_id
            WHERE p.is_active
            ORDER BY coalesce(s.units, 0) ASC, inv.on_hand DESC, p.product_id
            LIMIT %(limit)s
            """,
            {"since": end - timedelta(days=14), "end": end, "limit": limit},
        )

    def delivery_state(self) -> dict[str, dict[str, int]]:
        """Right-now delivery pipeline and rider availability."""
        deliveries = self._query(
            "SELECT status, count(*)::int AS n FROM deliveries "
            "WHERE status IN ('PENDING', 'ASSIGNED', 'PICKED_UP') GROUP BY status"
        )
        riders = self._query("SELECT status, count(*)::int AS n FROM riders GROUP BY status")
        return {
            "in_progress": {r["status"]: r["n"] for r in deliveries},
            "riders": {r["status"]: r["n"] for r in riders},
        }

    def customer_state(self, day: date) -> dict[str, Any]:
        """New / total customers and the biggest spenders (by non-cancelled spend)."""
        start, end = _day_bounds(day)
        counts = self._query(
            """
            SELECT
                (SELECT count(*) FROM customers WHERE is_active)::int AS total_customers,
                (SELECT count(*) FROM (
                    SELECT customer_id FROM orders WHERE status <> 'CANCELLED'
                    GROUP BY customer_id
                    HAVING min(placed_at) >= %(start)s AND min(placed_at) < %(end)s
                ) first_orders)::int AS new_customers
            """,
            {"start": start, "end": end},
        )[0]
        top = self._query(
            """
            SELECT c.customer_code, count(*)::int AS orders, sum(o.total_amount) AS spend,
                   max(o.placed_at) AS last_order_at
            FROM orders o JOIN customers c ON c.customer_id = o.customer_id
            WHERE o.status <> 'CANCELLED' AND o.placed_at < %(end)s
            GROUP BY c.customer_code
            ORDER BY spend DESC, c.customer_code
            LIMIT 5
            """,
            {"end": end},
        )
        return {**counts, "top_customers": top}

    def money_state(self, day: date) -> dict[str, Decimal]:
        """Discounts given and refunds on orders placed on ``day``."""
        start, end = _day_bounds(day)
        row = self._query(
            """
            SELECT
                coalesce(sum(item_discount + promo_discount)
                         FILTER (WHERE status <> 'CANCELLED'), 0) AS discounts,
                coalesce(sum(total_amount) FILTER (WHERE status = 'REFUNDED'), 0) AS refunds
            FROM orders WHERE placed_at >= %(start)s AND placed_at < %(end)s
            """,
            {"start": start, "end": end},
        )[0]
        refunds = Decimal(row["refunds"])
        # Prefer the refunds ledger when present (B6).
        try:
            ledger = self._query(
                """
                SELECT coalesce(sum(r.amount), 0) AS refunds
                FROM refunds r
                JOIN orders o ON o.order_id = r.order_id
                WHERE o.placed_at >= %(start)s AND o.placed_at < %(end)s
                  AND r.status IN ('APPROVED', 'PAID')
                """,
                {"start": start, "end": end},
            )[0]
            refunds = Decimal(ledger["refunds"])
        except _MISSING_SERVING:
            pass
        except psycopg.errors.UndefinedTable:
            pass
        return {"discounts": Decimal(row["discounts"]), "refunds": refunds}

    def margin_for_day(self, day: date) -> dict[str, Decimal | None]:
        """Company-level COGS / contribution margin for ``day`` if costs exist."""
        rows = self._query_serving(
            """
            SELECT coalesce(sum(cogs), 0) AS cogs,
                   coalesce(sum(contribution_margin), 0) AS contribution_margin,
                   coalesce(sum(net_sales), 0) AS net_sales
            FROM serving.margin_daily WHERE day = %(day)s
            """,
            {"day": day},
        )
        if rows:
            row = rows[0]
            cogs = Decimal(row["cogs"]) if row["cogs"] is not None else None
            cm = (
                Decimal(row["contribution_margin"])
                if row["contribution_margin"] is not None
                else None
            )
            return {"cogs": cogs, "contribution_margin": cm, "net_sales": Decimal(row["net_sales"])}
        start, end = _day_bounds(day)
        try:
            row = self._query(
                """
                SELECT
                  coalesce(sum(oi.quantity * oi.unit_cost)
                           FILTER (WHERE oi.unit_cost IS NOT NULL
                                   AND o.status <> 'CANCELLED'), 0) AS cogs,
                  count(*) FILTER (WHERE oi.unit_cost IS NOT NULL) AS with_cost,
                  count(*) AS lines
                FROM order_items oi
                JOIN orders o ON o.order_id = oi.order_id
                WHERE o.placed_at >= %(start)s AND o.placed_at < %(end)s
                """,
                {"start": start, "end": end},
            )[0]
        except psycopg.errors.UndefinedColumn:
            return {"cogs": None, "contribution_margin": None, "net_sales": None}
        if int(row["with_cost"] or 0) == 0:
            return {"cogs": None, "contribution_margin": None, "net_sales": None}
        return {
            "cogs": Decimal(row["cogs"]),
            "contribution_margin": None,
            "net_sales": None,
        }

    def list_targets(self, period_start: date) -> list[dict[str, Any]]:
        try:
            return self._query(
                """
                SELECT scope_type, scope_value, metric_key, period_type, period_start,
                       target_value, set_by
                FROM targets
                WHERE period_type = 'month' AND period_start = %(period_start)s
                ORDER BY scope_type, scope_value, metric_key
                """,
                {"period_start": period_start},
            )
        except psycopg.errors.UndefinedTable:
            return []

    def mtd_actual(
        self,
        metric_key: str,
        scope_type: str,
        scope_value: str,
        period_start: date,
        as_of: date,
    ) -> Decimal | None:
        """Sum (or average for rates) actuals from period_start..as_of."""
        days = [
            period_start + timedelta(days=i)
            for i in range((as_of - period_start).days + 1)
        ]
        if not days:
            return None
        series = self.metric_series(scope_type, scope_value, days)
        values = [v for v in series.get(metric_key, {}).values() if v is not None]
        if not values:
            # Fallback: live SQL for sales_gmv / orders at global/store.
            start = datetime.combine(period_start, time.min, tzinfo=UTC)
            end = datetime.combine(as_of + timedelta(days=1), time.min, tzinfo=UTC)
            store_filter = ""
            params: dict[str, Any] = {"start": start, "end": end}
            if scope_type == "store":
                store_filter = " AND store_id = %(store_id)s"
                params["store_id"] = int(scope_value)
            elif scope_type not in ("global", "company"):
                return None
            if metric_key == "sales_gmv":
                row = self._query(
                    f"SELECT coalesce(sum(total_amount), 0) AS v FROM orders"
                    f" WHERE status <> 'CANCELLED' AND placed_at >= %(start)s"
                    f" AND placed_at < %(end)s{store_filter}",
                    params,
                )[0]
                return Decimal(row["v"])
            if metric_key == "orders":
                row = self._query(
                    f"SELECT count(*)::int AS v FROM orders"
                    f" WHERE status <> 'CANCELLED' AND placed_at >= %(start)s"
                    f" AND placed_at < %(end)s{store_filter}",
                    params,
                )[0]
                return Decimal(row["v"])
            return None
        if metric_key.endswith("_rate"):
            return sum(values) / Decimal(len(values))
        return sum(values, Decimal(0))

    def open_alerts(self, limit: int = 20) -> list[dict[str, Any]]:
        try:
            return self._query(
                """
                SELECT alert_id, alert_key, kind, severity, title, detail,
                       metric_key, store_id, suggested_action, last_seen_at
                FROM alerts
                WHERE status IN ('OPEN', 'ACKNOWLEDGED')
                ORDER BY CASE severity WHEN 'bad' THEN 0 ELSE 1 END, last_seen_at DESC
                LIMIT %(limit)s
                """,
                {"limit": limit},
            )
        except psycopg.errors.UndefinedTable:
            return []

    def list_reports(self, limit: int = 20) -> list[dict[str, Any]]:
        try:
            return self._query(
                """
                SELECT report_id, name AS title, schedule_cron AS schedule, created_at
                FROM saved_reports
                ORDER BY created_at DESC
                LIMIT %(limit)s
                """,
                {"limit": limit},
            )
        except psycopg.errors.UndefinedTable:
            return []

    def create_report(
        self, title: str, spec: dict[str, Any], created_by: int | None
    ) -> dict[str, Any]:
        import json

        with self._conn.transaction(), self._conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                INSERT INTO saved_reports (name, definition, owner_user_id)
                VALUES (%(title)s, %(spec)s::jsonb, %(uid)s)
                RETURNING report_id, name AS title, schedule_cron AS schedule, created_at
                """,
                {"title": title, "spec": json.dumps(spec), "uid": created_by},
            )
            return dict(cur.fetchone())


def _as_float(value: Decimal | float | int | None) -> float | None:
    return None if value is None else float(value)
