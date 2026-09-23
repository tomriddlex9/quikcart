"""Bulk-load helpers: COPY-based inserts for simulator output.

Domain code (simulator) produces plain row tuples; this adapter owns the
database I/O so generation stays pure and testable without a database.
"""

from collections.abc import Iterable, Sequence
from typing import Any

import psycopg

ALL_TABLES = [
    "support_tickets",
    "deliveries",
    "payments",
    "order_items",
    "orders",
    "inventory_movements",
    "inventory",
    "promotions",
    "riders",
    "product_prices",
    "products",
    "customer_addresses",
    "customers",
    "stores",
]


def copy_rows(
    cur: psycopg.Cursor,
    table: str,
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
) -> int:
    """COPY rows into `table` in one round trip. Returns rows written."""
    column_list = ", ".join(columns)
    count = 0
    with cur.copy(f"COPY {table} ({column_list}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)
            count += 1
    return count


def truncate_all(cur: psycopg.Cursor) -> None:
    """Reset every business table (RESTART IDENTITY + CASCADE). Destructive."""
    cur.execute(f"TRUNCATE TABLE {', '.join(ALL_TABLES)} RESTART IDENTITY CASCADE")
