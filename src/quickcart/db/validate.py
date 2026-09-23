"""`uv run python -m quickcart.db.validate` — post-seed validation report.

Checks (kit/07 Phase 1 acceptance):
- row counts present and within expected magnitude bands
- referential integrity (no orphan foreign keys)
- logical timestamp ordering on the delivery lifecycle
- money reconciliation rules (kit/02 §9)
- causal sanity in aggregate: demand seasonality, weekend effect,
  basket-size -> pick-minutes relationship
- determinism fingerprint (orders per store) for seed-comparison
"""

from dataclasses import dataclass, field

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect, fetch_all
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

EXPECTED_COUNTS = {
    "stores": (1, 50),
    "customers": (100, 1_000_000),
    "products": (10, 100_000),
    "orders": (100, 10_000_000),
    "order_items": (100, 50_000_000),
    "payments": (100, 20_000_000),
    "deliveries": (100, 10_000_000),
}

ORPHAN_CHECKS = {
    "orders.customer_id": """SELECT count(*) AS n FROM orders o
        LEFT JOIN customers c ON c.customer_id = o.customer_id
        WHERE c.customer_id IS NULL""",
    "orders.store_id": """SELECT count(*) AS n FROM orders o
        LEFT JOIN stores s ON s.store_id = o.store_id
        WHERE s.store_id IS NULL""",
    "orders.address_id": """SELECT count(*) AS n FROM orders o
        LEFT JOIN customer_addresses a ON a.address_id = o.address_id
        WHERE o.address_id IS NOT NULL AND a.address_id IS NULL""",
    "order_items.order_id": """SELECT count(*) AS n FROM order_items i
        LEFT JOIN orders o ON o.order_id = i.order_id
        WHERE o.order_id IS NULL""",
    "order_items.product_id": """SELECT count(*) AS n FROM order_items i
        LEFT JOIN products p ON p.product_id = i.product_id
        WHERE p.product_id IS NULL""",
    "payments.order_id": """SELECT count(*) AS n FROM payments p
        LEFT JOIN orders o ON o.order_id = p.order_id
        WHERE o.order_id IS NULL""",
    "deliveries.order_id": """SELECT count(*) AS n FROM deliveries d
        LEFT JOIN orders o ON o.order_id = d.order_id
        WHERE o.order_id IS NULL""",
    "deliveries.rider_id": """SELECT count(*) AS n FROM deliveries d
        LEFT JOIN riders r ON r.rider_id = d.rider_id
        WHERE d.rider_id IS NOT NULL AND r.rider_id IS NULL""",
    "inventory_movements.store_id": """SELECT count(*) AS n FROM inventory_movements m
        LEFT JOIN stores s ON s.store_id = m.store_id
        WHERE s.store_id IS NULL""",
    "inventory_movements.product_id": """SELECT count(*) AS n FROM inventory_movements m
        LEFT JOIN products p ON p.product_id = m.product_id
        WHERE p.product_id IS NULL""",
}

ORDERING_CHECKS = {
    "delivered_at >= orders.placed_at": """SELECT count(*) AS n FROM deliveries d
        JOIN orders o ON o.order_id = d.order_id
        WHERE d.delivered_at IS NOT NULL AND d.delivered_at < o.placed_at""",
    "picked_up_at >= assigned_at": """SELECT count(*) AS n FROM deliveries
        WHERE picked_up_at IS NOT NULL AND assigned_at IS NOT NULL
          AND picked_up_at < assigned_at""",
    "assigned_at >= orders.placed_at": """SELECT count(*) AS n FROM deliveries d
        JOIN orders o ON o.order_id = d.order_id
        WHERE d.assigned_at IS NOT NULL AND d.assigned_at < o.placed_at""",
    "cancelled rows have cancelled_at": """SELECT count(*) AS n FROM deliveries
        WHERE status = 'CANCELLED' AND cancelled_at IS NULL""",
}

MONEY_CHECKS = {
    "orders.total_amount reconciles": """SELECT count(*) AS n FROM orders
        WHERE abs(total_amount - (subtotal - item_discount - promo_discount
              + delivery_fee + tax_amount)) > 0.01""",
    "order_items.line_total reconciles": """SELECT count(*) AS n FROM order_items
        WHERE abs(line_total - (quantity * unit_price - line_discount)) > 0.01""",
    "captured first-attempt payment == order total": """SELECT count(*) AS n
        FROM payments p JOIN orders o ON o.order_id = p.order_id
        WHERE p.status = 'CAPTURED' AND p.attempt_number = 1
          AND abs(p.amount - o.total_amount) > 0.01""",
}

CAUSAL_CHECKS = {
    # Peak hours (12-14, 18-22) must beat off-peak (02-06) by a clear margin.
    "peak vs off-peak order volume": """SELECT
        count(*) FILTER (WHERE extract(hour FROM placed_at) BETWEEN 12 AND 14
                          OR extract(hour FROM placed_at) BETWEEN 18 AND 22) AS peak,
        count(*) FILTER (WHERE extract(hour FROM placed_at) BETWEEN 2 AND 6) AS offpeak
        FROM orders""",
    # Weekend days must out-order weekday days on average.
    "weekend vs weekday daily orders": """WITH per_day AS (
        SELECT date_trunc('day', placed_at) AS day,
               count(*) AS orders,
               extract(isodow FROM placed_at) >= 6 AS is_weekend
        FROM orders GROUP BY 1, 3)
        SELECT avg(orders) FILTER (WHERE is_weekend) AS weekend_avg,
               avg(orders) FILTER (WHERE NOT is_weekend) AS weekday_avg
        FROM per_day""",
    # Larger baskets must take longer to pick.
    "basket size vs pick minutes": """WITH oi AS (
        SELECT order_id, sum(quantity) AS units FROM order_items GROUP BY 1)
        SELECT avg(extract(epoch FROM (d.picked_up_at - d.assigned_at)) / 60.0)
                   FILTER (WHERE oi.units >= 6) AS big_basket_pick,
               avg(extract(epoch FROM (d.picked_up_at - d.assigned_at)) / 60.0)
                   FILTER (WHERE oi.units <= 2) AS small_basket_pick
        FROM deliveries d JOIN oi ON oi.order_id = d.order_id
        WHERE d.picked_up_at IS NOT NULL AND d.assigned_at IS NOT NULL""",
}


@dataclass
class CheckResult:
    ok: bool
    detail: str


@dataclass
class ValidationReport:
    checks: dict[str, CheckResult] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    fingerprint: str = ""

    @property
    def passed(self) -> bool:
        return all(result.ok for result in self.checks.values())


def run_validation() -> ValidationReport:
    report = ValidationReport()
    with connect(autocommit=True) as conn:
        for table, (lo, hi) in EXPECTED_COUNTS.items():
            (row,) = fetch_all(conn, f"SELECT count(*) AS n FROM {table}")
            count = int(row["n"])
            report.counts[table] = count
            report.checks[f"count:{table}"] = CheckResult(
                lo <= count <= hi, f"{count} rows (expected {lo}..{hi})"
            )

        for name, sql in ORPHAN_CHECKS.items():
            (row,) = fetch_all(conn, sql)
            report.checks[f"fk:{name}"] = CheckResult(int(row["n"]) == 0, f"{row['n']} orphans")

        for name, sql in ORDERING_CHECKS.items():
            (row,) = fetch_all(conn, sql)
            report.checks[f"order:{name}"] = CheckResult(
                int(row["n"]) == 0, f"{row['n']} violations"
            )

        for name, sql in MONEY_CHECKS.items():
            (row,) = fetch_all(conn, sql)
            report.checks[f"money:{name}"] = CheckResult(
                int(row["n"]) == 0, f"{row['n']} violations"
            )

        for name, sql in CAUSAL_CHECKS.items():
            (row,) = fetch_all(conn, sql)
            report.checks[f"causal:{name}"] = _evaluate_causal(name, row)

        fingerprint_rows = list(
            fetch_all(
                conn,
                """SELECT store_id, count(*) AS orders, sum(total_amount) AS gmv
                   FROM orders GROUP BY store_id ORDER BY store_id""",
            )
        )
        import hashlib
        import json

        payload = json.dumps(fingerprint_rows, default=str)
        report.fingerprint = hashlib.sha256(payload.encode()).hexdigest()
    return report


def _evaluate_causal(name: str, row: dict) -> CheckResult:
    if name == "peak vs off-peak order volume":
        peak, offpeak = float(row["peak"]), float(row["offpeak"])
        ratio = peak / max(offpeak, 1.0)
        detail = f"peak={peak:.0f} offpeak={offpeak:.0f} ratio={ratio:.2f}"
        return CheckResult(offpeak == 0 or ratio >= 1.5, detail)
    if name == "weekend vs weekday daily orders":
        weekend = float(row["weekend_avg"] or 0)
        weekday = float(row["weekday_avg"] or 0)
        ratio = weekend / max(weekday, 1e-9)
        detail = f"weekend_avg={weekend:.1f} weekday_avg={weekday:.1f}"
        return CheckResult(weekday == 0 or ratio >= 1.05, detail)
    if name == "basket size vs pick minutes":
        big = float(row["big_basket_pick"] or 0)
        small = float(row["small_basket_pick"] or 0)
        ratio = big / max(small, 1e-9)
        return CheckResult(small == 0 or ratio >= 1.2, f"big={big:.1f}min small={small:.1f}min")
    return CheckResult(False, f"unknown check {name}")


def main() -> int:
    configure_logging(get_settings().log_level)
    report = run_validation()
    for name, result in report.checks.items():
        log.info(
            "check",
            name=name,
            status="PASS" if result.ok else "FAIL",
            detail=result.detail,
        )
    log.info("fingerprint", sha256=report.fingerprint)
    if not report.passed:
        log.error("validation.failed", failed=[n for n, r in report.checks.items() if not r.ok])
        return 1
    log.info("validation.passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
