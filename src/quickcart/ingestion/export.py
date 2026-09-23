"""Batch export of PostgreSQL tables to local raw files (kit/03 §3.1).

Three deliberately different source shapes are produced so Phase 3 can learn
against realistic variety:

- relational tables as CSV (``data/raw/<entity>/load_date=YYYY-MM-DD/*.csv``)
  with timestamps normalised to UTC-naive strings and booleans as true/false;
- a supplier-like CSV catalog (synthesised deterministically from products);
- nested order-event envelopes as JSON Lines (kit/04 §4 contract).

Exports are plain reads; rerunning overwrites the day's partition.
"""

import csv
import json
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import numpy as np
import psycopg

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect

EXPORT_TABLES = [
    "stores",
    "customers",
    "customer_addresses",
    "products",
    "product_prices",
    "riders",
    "promotions",
    "orders",
    "order_items",
    "payments",
    "deliveries",
    "inventory",
    "inventory_movements",
    "support_tickets",
]

SUPPLIERS = [
    "AgroFresh Distributors",
    "DairyBridge Foods",
    "SnackSmiths Wholesale",
    "BeverageBay Trading",
    "StapleStreet Supply",
    "CareLine Goods",
    "HomeSpark Trading",
    "QuickBowl Manufacturing",
    "FrostChain Logistics",
    "TinyTots Distribution",
    "MetroGrocers Collective",
    "GreenRoute Organics",
]

EVENT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "quickcart.dev")


def q(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def utc_stamp(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _export_select(conn: psycopg.Connection, table: str) -> str:
    """SELECT with tz timestamps rendered as UTC-naive and booleans as text."""
    from quickcart.db.connection import fetch_all

    columns = fetch_all(
        conn,
        """SELECT column_name, data_type
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = %s
           ORDER BY ordinal_position""",
        (table,),
    )
    selects = []
    for col in columns:
        name, data_type = col["column_name"], col["data_type"]
        if data_type == "timestamp with time zone":
            selects.append(
                f"to_char({q(name)} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS {q(name)}"
            )
        elif data_type == "boolean":
            selects.append(f"{q(name)}::text AS {q(name)}")
        else:
            selects.append(q(name))
    return f"SELECT {', '.join(selects)} FROM {q(table)}"


def export_table_csv(
    conn: psycopg.Connection, table: str, data_root: Path, load_date: date
) -> Path:
    target_dir = data_root / "raw" / table / f"load_date={load_date.isoformat()}"
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{table}.csv"
    sql = _export_select(conn, table)
    with (
        conn.cursor() as cur,
        path.open("wb") as fh,
        cur.copy(f"COPY ({sql}) TO STDOUT WITH CSV HEADER") as copy,
    ):
        for chunk in copy:
            fh.write(chunk)
    return path


def export_supplier_catalog(
    conn: psycopg.Connection, data_root: Path, load_date: date, seed: int = 42
) -> Path:
    """Supplier-like CSV derived from the product catalog (deterministic)."""
    from quickcart.db.connection import fetch_all

    products = fetch_all(
        conn,
        """SELECT p.product_id, p.sku, pp.selling_price
           FROM products p
           JOIN product_prices pp
             ON pp.product_id = p.product_id
            AND pp.store_id IS NULL
           ORDER BY p.product_id""",
    )
    rng = np.random.default_rng(seed)
    target_dir = data_root / "raw" / "supplier_catalog" / f"load_date={load_date.isoformat()}"
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / "supplier_catalog.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["sku", "supplier_name", "cost_price", "lead_time_days", "min_order_qty"])
        for product in products:
            supplier = SUPPLIERS[int(rng.integers(0, len(SUPPLIERS)))]
            cost = Decimal(str(product["selling_price"])) * Decimal(
                str(round(float(rng.uniform(0.55, 0.82)), 4))
            )
            writer.writerow(
                [
                    product["sku"],
                    supplier,
                    f"{cost.quantize(Decimal('0.01'))}",
                    int(rng.integers(1, 8)),
                    int(rng.choice([1, 6, 12, 24])),
                ]
            )
    return path


def export_order_events(
    conn: psycopg.Connection, data_root: Path, load_date: date, order_limit: int = 5000
) -> Path:
    """Nested order-event envelopes (kit/04 §4/§5) as JSON Lines."""
    from quickcart.db.connection import fetch_all

    orders = fetch_all(
        conn,
        """SELECT order_id, customer_id, store_id, status, subtotal, promo_discount,
                  total_amount, placed_at
           FROM orders ORDER BY placed_at LIMIT %s""",
        (order_limit,),
    )
    payments = fetch_all(
        conn,
        """SELECT payment_id, order_id, payment_method, status, amount, attempt_number,
                  failure_code, created_at
           FROM payments
           WHERE order_id = ANY(%s)
           ORDER BY order_id, attempt_number""",
        ([o["order_id"] for o in orders],),
    )
    deliveries = fetch_all(
        conn,
        "SELECT * FROM deliveries WHERE order_id = ANY(%s)",
        ([o["order_id"] for o in orders],),
    )
    payments_by_order: dict[int, list[dict]] = {}
    for payment in payments:
        payments_by_order.setdefault(payment["order_id"], []).append(payment)
    delivery_by_order = {d["order_id"]: d for d in deliveries}

    target_dir = data_root / "raw" / "order_events" / f"load_date={load_date.isoformat()}"
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / "order_events.jsonl"

    def envelope(
        event_type: str, entity_id: int, store_id: int, event_time: datetime, payload: dict
    ) -> dict:
        return {
            "event_id": str(uuid.uuid5(EVENT_NAMESPACE, f"{entity_id}:{event_type}")),
            "event_type": event_type,
            "schema_version": 1,
            "event_time": utc_stamp(event_time),
            "producer": "quickcart-simulator",
            "entity_type": "order",
            "entity_id": str(entity_id),
            "store_id": store_id,
            "payload": payload,
        }

    with path.open("w", encoding="utf-8") as fh:
        for order in orders:
            oid = order["order_id"]
            placed = order["placed_at"]
            fh.write(
                json.dumps(
                    envelope(
                        "ORDER_PLACED",
                        oid,
                        order["store_id"],
                        placed,
                        {
                            "order_id": oid,
                            "customer_id": order["customer_id"],
                            "store_id": order["store_id"],
                            "subtotal": str(order["subtotal"]),
                            "discount": str(order["promo_discount"]),
                            "total_amount": str(order["total_amount"]),
                            "currency": "INR",
                        },
                    )
                )
                + "\n"
            )
            for payment in payments_by_order.get(oid, []):
                event_type = (
                    "PAYMENT_COMPLETED" if payment["status"] == "CAPTURED" else "PAYMENT_FAILED"
                )
                payload: dict = {
                    "payment_id": payment["payment_id"],
                    "order_id": oid,
                    "amount": str(payment["amount"]),
                    "method": payment["payment_method"],
                    "attempt_number": payment["attempt_number"],
                }
                if payment["failure_code"]:
                    payload["failure_code"] = payment["failure_code"]
                fh.write(
                    json.dumps(
                        envelope(event_type, oid, order["store_id"], payment["created_at"], payload)
                    )
                    + "\n"
                )
            delivery = delivery_by_order.get(oid)
            if delivery is not None:
                if delivery["status"] == "DELIVERED":
                    payload = {
                        "order_id": oid,
                        "delivery_id": delivery["delivery_id"],
                        "rider_id": delivery["rider_id"],
                        "promised_by": utc_stamp(delivery["promised_by"]),
                        "delivered_at": utc_stamp(delivery["delivered_at"]),
                    }
                    fh.write(
                        json.dumps(
                            envelope(
                                "ORDER_DELIVERED",
                                oid,
                                order["store_id"],
                                delivery["delivered_at"],
                                payload,
                            )
                        )
                        + "\n"
                    )
                elif delivery["status"] == "CANCELLED":
                    fh.write(
                        json.dumps(
                            envelope(
                                "ORDER_CANCELLED",
                                oid,
                                order["store_id"],
                                delivery["cancelled_at"],
                                {"order_id": oid, "reason": "customer_or_ops_cancel"},
                            )
                        )
                        + "\n"
                    )
    return path


def export_all(data_root: Path | None = None, load_date: date | None = None) -> list[Path]:
    settings = get_settings()
    root = data_root or settings.data_root
    day = load_date or date.today()
    written: list[Path] = []
    with connect(autocommit=True) as conn:
        for table in EXPORT_TABLES:
            written.append(export_table_csv(conn, table, root, day))
        written.append(export_supplier_catalog(conn, root, day))
        written.append(export_order_events(conn, root, day))
    return written


def main() -> int:
    paths = export_all()
    for path in paths:
        size_kb = path.stat().st_size / 1024
        print(f"{path}  ({size_kb:.0f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
