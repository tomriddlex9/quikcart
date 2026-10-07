"""Deterministic business-entity helpers (Phase B6).

Used to backfill costs, targets, refunds, ratings, promo redemptions and wastage
into an already-seeded operational DB. Pure helpers take an ``rng``; the
``backfill`` entry point is the only I/O.
"""

from __future__ import annotations

import argparse
import random
from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import structlog
from psycopg.rows import dict_row

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

# Category → typical cost as a share of selling price (rough Indian grocery bands).
_CATEGORY_COST_SHARE: dict[str, float] = {
    "Fruits & Vegetables": 0.55,
    "Dairy": 0.62,
    "Snacks": 0.58,
    "Beverages": 0.60,
    "Staples": 0.70,
    "Personal Care": 0.55,
    "Household": 0.58,
    "Baby Care": 0.52,
    "Bakery": 0.50,
    "Frozen": 0.60,
}
_DEFAULT_COST_SHARE = 0.60
TARGET_FACTOR = Decimal("1.10")


def cost_for_product(
    category: str,
    selling_price: Decimal | float,
    *,
    rng: random.Random | None = None,
) -> Decimal:
    """Return a plausible unit cost for ``selling_price`` in ``category``."""
    share = _CATEGORY_COST_SHARE.get(category, _DEFAULT_COST_SHARE)
    if rng is not None:
        share *= rng.uniform(0.92, 1.08)
    price = Decimal(str(selling_price))
    cost = (price * Decimal(str(share))).quantize(Decimal("0.01"))
    return max(Decimal("0.01"), min(cost, price))


def maybe_refund(
    order_was_late: bool,
    order_total: Decimal | float,
    *,
    rng: random.Random,
) -> dict[str, Any] | None:
    """Occasionally refund a late (or rarely an on-time) order."""
    p = 0.18 if order_was_late else 0.01
    if rng.random() >= p:
        return None
    total = Decimal(str(order_total))
    amount = (total * Decimal(str(rng.choice([0.25, 0.5, 1.0])))).quantize(Decimal("0.01"))
    if amount <= 0:
        return None
    reason = (
        "LATE_DELIVERY"
        if order_was_late
        else rng.choice(["DAMAGED_ITEM", "MISSING_ITEM", "QUALITY", "OTHER"])
    )
    return {"amount": amount, "reason": reason, "status": "PAID"}


def rating_for_delivery(is_late: bool, *, rng: random.Random) -> int:
    """1-5 star rating; late deliveries skew lower."""
    weights = (5, 15, 25, 35, 20) if is_late else (2, 5, 15, 35, 43)
    return rng.choices([1, 2, 3, 4, 5], weights=weights, k=1)[0]


def target_from_trailing(avg: Decimal | float, factor: Decimal = TARGET_FACTOR) -> Decimal:
    """Full-period target = trailing average x factor."""
    return (Decimal(str(avg)) * factor).quantize(Decimal("0.01"))


def redemption_for_order(
    promotion_id: int | None, discount_amount: Decimal | float
) -> dict[str, Any] | None:
    if promotion_id is None:
        return None
    amount = Decimal(str(discount_amount))
    if amount <= 0:
        return None
    return {"promotion_id": promotion_id, "discount_amount": amount}


def wastage_qty(on_hand: int, *, rng: random.Random, perishable: bool) -> int:
    """Units to write off; perishables waste more often."""
    if on_hand <= 0:
        return 0
    p = 0.12 if perishable else 0.03
    if rng.random() >= p:
        return 0
    return max(1, int(on_hand * rng.uniform(0.02, 0.08)))


def month_start(day: date) -> date:
    return day.replace(day=1)


def _table_exists(cur: Any, name: str, schema: str = "public") -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
        (schema, name),
    )
    return cur.fetchone() is not None


def backfill(conn: Any, *, seed: int = 42) -> dict[str, int]:
    """Idempotent backfill of B6 business entities into an existing DB."""
    rng = random.Random(seed)
    counts = {
        "product_costs": 0,
        "unit_costs": 0,
        "refunds": 0,
        "ratings": 0,
        "redemptions": 0,
        "wastage": 0,
        "targets": 0,
    }
    with conn.cursor(row_factory=dict_row) as cur:
        if not _table_exists(cur, "product_costs"):
            log.warning("business.backfill.skip", reason="product_costs table missing")
            return counts

        # --- product costs -------------------------------------------------------
        cur.execute(
            "SELECT p.product_id, p.category,"
            " COALESCE("
            "   (SELECT pp.selling_price FROM product_prices pp"
            "    WHERE pp.product_id = p.product_id AND pp.store_id IS NULL"
            "    ORDER BY pp.valid_from DESC LIMIT 1), 100"
            " ) AS selling_price"
            " FROM products p WHERE p.is_active"
        )
        products = list(cur.fetchall())
        for row in products:
            cost = cost_for_product(row["category"], row["selling_price"], rng=rng)
            cur.execute(
                "INSERT INTO product_costs (product_id, store_id, cost_price)"
                " SELECT %s, NULL, %s"
                " WHERE NOT EXISTS ("
                "   SELECT 1 FROM product_costs"
                "   WHERE product_id = %s AND store_id IS NULL AND valid_to IS NULL"
                " )",
                (row["product_id"], cost, row["product_id"]),
            )
            counts["product_costs"] += cur.rowcount

        # Freeze unit_cost on order_items that still lack one.
        cur.execute(
            "UPDATE order_items oi SET unit_cost = pc.cost_price"
            " FROM product_costs pc"
            " WHERE oi.unit_cost IS NULL AND pc.product_id = oi.product_id"
            "   AND pc.store_id IS NULL AND pc.valid_to IS NULL"
        )
        counts["unit_costs"] = cur.rowcount

        # --- refunds + ratings + redemptions ------------------------------------
        if _table_exists(cur, "refunds"):
            cur.execute(
                "SELECT o.order_id, o.customer_id, o.total_amount, o.promotion_id,"
                " coalesce(o.item_discount, 0) + coalesce(o.promo_discount, 0)"
                "   AS discount_amount,"
                " o.placed_at,"
                " (d.delivered_at IS NOT NULL AND d.delivered_at > d.promised_by) AS is_late,"
                " COALESCE(d.delivered_at, o.placed_at) AS event_at"
                " FROM orders o"
                " LEFT JOIN deliveries d ON d.order_id = o.order_id"
                " WHERE o.status IN ('DELIVERED', 'REFUNDED')"
                "   AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.order_id)"
                " ORDER BY o.order_id"
                " LIMIT 5000"
            )
            for order in cur.fetchall():
                is_late = bool(order["is_late"])
                refund = maybe_refund(is_late, order["total_amount"], rng=rng)
                if refund:
                    cur.execute(
                        "INSERT INTO refunds"
                        " (order_id, amount, reason, status, refunded_at)"
                        " VALUES (%s, %s, %s, %s, %s)",
                        (
                            order["order_id"],
                            refund["amount"],
                            refund["reason"],
                            refund["status"],
                            order["event_at"],
                        ),
                    )
                    counts["refunds"] += 1
                if _table_exists(cur, "order_ratings"):
                    cur.execute(
                        "INSERT INTO order_ratings"
                        " (order_id, customer_id, rating, rated_at)"
                        " VALUES (%s, %s, %s, %s)"
                        " ON CONFLICT (order_id) DO NOTHING",
                        (
                            order["order_id"],
                            order["customer_id"],
                            rating_for_delivery(is_late, rng=rng),
                            order["event_at"],
                        ),
                    )
                    counts["ratings"] += cur.rowcount
                if _table_exists(cur, "promotion_redemptions"):
                    red = redemption_for_order(order["promotion_id"], order["discount_amount"] or 0)
                    if red:
                        cur.execute(
                            "INSERT INTO promotion_redemptions"
                            " (promotion_id, order_id, customer_id, discount_amount, redeemed_at)"
                            " VALUES (%s, %s, %s, %s, %s)"
                            " ON CONFLICT (promotion_id, order_id) DO NOTHING",
                            (
                                red["promotion_id"],
                                order["order_id"],
                                order["customer_id"],
                                red["discount_amount"],
                                order["event_at"],
                            ),
                        )
                        counts["redemptions"] += cur.rowcount

        # --- wastage -------------------------------------------------------------
        if _table_exists(cur, "wastage_events"):
            cur.execute(
                "SELECT i.store_id, i.product_id, i.on_hand_qty, p.category"
                " FROM inventory i JOIN products p ON p.product_id = i.product_id"
                " WHERE i.on_hand_qty > 0"
            )
            perishable_cats = {"Fruits & Vegetables", "Dairy", "Bakery", "Frozen"}
            now = datetime.now(UTC)
            for row in cur.fetchall():
                qty = wastage_qty(
                    int(row["on_hand_qty"]),
                    rng=rng,
                    perishable=row["category"] in perishable_cats,
                )
                if qty <= 0:
                    continue
                cur.execute(
                    "INSERT INTO wastage_events"
                    " (store_id, product_id, quantity, reason, occurred_at)"
                    " VALUES (%s, %s, %s, %s, %s)",
                    (
                        row["store_id"],
                        row["product_id"],
                        qty,
                        "EXPIRED" if row["category"] in perishable_cats else "DAMAGED",
                        now,
                    ),
                )
                counts["wastage"] += 1

        # --- monthly targets from trailing sales --------------------------------
        if _table_exists(cur, "targets"):
            cur.execute("SELECT COALESCE(MAX(placed_at::date), CURRENT_DATE) AS d FROM orders")
            as_of = cur.fetchone()["d"]
            if isinstance(as_of, datetime):
                as_of = as_of.date()
            period = month_start(as_of)
            days_in_month = monthrange(period.year, period.month)[1]
            window_start = as_of - timedelta(days=28)
            cur.execute(
                "SELECT COALESCE(SUM(total_amount), 0) AS gmv,"
                " COUNT(*)::int AS orders"
                " FROM orders"
                " WHERE status NOT IN ('CANCELLED')"
                "   AND placed_at::date BETWEEN %s AND %s",
                (window_start, as_of),
            )
            agg = cur.fetchone()
            daily_gmv = Decimal(str(agg["gmv"])) / Decimal(28)
            daily_orders = Decimal(str(agg["orders"])) / Decimal(28)
            gmv_target = target_from_trailing(daily_gmv * days_in_month)
            orders_target = target_from_trailing(daily_orders * days_in_month)
            for metric_key, value in (("sales_gmv", gmv_target), ("orders", orders_target)):
                cur.execute(
                    "INSERT INTO targets"
                    " (scope_type, scope_value, metric_key, period_type,"
                    "  period_start, target_value, set_by)"
                    " VALUES ('global', 'all', %s, 'month', %s, %s, 'simulator')"
                    " ON CONFLICT (scope_type, scope_value, metric_key, period_type, period_start)"
                    " DO UPDATE SET target_value = EXCLUDED.target_value, updated_at = now()",
                    (metric_key, period, value),
                )
                counts["targets"] += 1

            cur.execute("SELECT store_id, city FROM stores WHERE is_active")
            for store in cur.fetchall():
                cur.execute(
                    "SELECT COALESCE(SUM(total_amount), 0) AS gmv"
                    " FROM orders"
                    " WHERE store_id = %s AND status NOT IN ('CANCELLED')"
                    "   AND placed_at::date BETWEEN %s AND %s",
                    (store["store_id"], window_start, as_of),
                )
                store_gmv = Decimal(str(cur.fetchone()["gmv"])) / Decimal(28)
                store_target = target_from_trailing(store_gmv * days_in_month)
                cur.execute(
                    "INSERT INTO targets"
                    " (scope_type, scope_value, metric_key, period_type,"
                    "  period_start, target_value, set_by)"
                    " VALUES ('store', %s, 'sales_gmv', 'month', %s, %s, 'simulator')"
                    " ON CONFLICT (scope_type, scope_value, metric_key, period_type, period_start)"
                    " DO UPDATE SET target_value = EXCLUDED.target_value, updated_at = now()",
                    (str(store["store_id"]), period, store_target),
                )
                counts["targets"] += 1

    conn.commit()
    log.info("business.backfill.done", **counts)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill B6 business entities")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)
    with connect() as conn:
        backfill(conn, seed=args.seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
