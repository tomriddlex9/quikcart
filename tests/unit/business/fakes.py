"""Canned psycopg-shaped connection that answers the snapshot's operational queries."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import psycopg

AS_OF = date(2026, 9, 22)


def hour(day: date, h: int) -> datetime:
    return datetime(day.year, day.month, day.day, h, tzinfo=UTC)


class Cursor:
    def __init__(self, conn: FakeOpsConn) -> None:
        self.conn = conn
        self._rows: list[Any] = []

    def __enter__(self) -> Cursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> None:
        self.conn.statements.append(sql)
        self._rows = self.conn.respond(sql)

    def executemany(self, sql: str, rows: list[Any]) -> None:
        self.conn.bulk.append((sql, list(rows)))

    def fetchall(self) -> list[Any]:
        return self._rows

    def fetchone(self) -> Any:
        return self._rows[0]


class Tx:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *exc: object) -> None:
        return None


class FakeOpsConn:
    """Answers each snapshot / live query by recognising a fragment of its SQL.

    ``serving_missing`` makes every ``SELECT ... serving.*`` raise ``UndefinedTable``,
    as a database that has not run V008 would.
    """

    read_only = False

    def __init__(self, *, fail_on: str | None = None, serving_missing: bool = False) -> None:
        self.statements: list[str] = []
        self.bulk: list[tuple[str, list[Any]]] = []
        self.fail_on = fail_on
        self.serving_missing = serving_missing

    def transaction(self) -> Tx:
        return Tx()

    def cursor(self, row_factory: Any = None) -> Cursor:
        return Cursor(self)

    def respond(self, sql: str) -> list[Any]:
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("boom")
        if self.serving_missing and sql.lstrip().startswith("SELECT") and "serving." in sql:
            raise psycopg.errors.UndefinedTable("relation serving.snapshot_runs does not exist")
        if "INSERT INTO serving.snapshot_runs" in sql:
            return [(7,)]
        if "max((placed_at" in sql:
            return [{"as_of": AS_OF}]
        if "FROM stores" in sql:
            return [{"store_id": 1, "name": "Koramangala", "city": "Bengaluru"}]
        if "LEFT JOIN deliveries" in sql:
            return [
                {
                    "hour_start": hour(AS_OF, 9),
                    "store_id": 1,
                    "orders": 4,
                    "cancelled": 1,
                    "gmv": Decimal("300.00"),
                    "delivered": 3,
                    "late": 1,
                    "timed": 3,
                    "minutes_sum": 60.0,
                }
            ]
        if "FROM payments" in sql:
            return [{"hour_start": hour(AS_OF, 9), "store_id": 1, "attempts": 4, "failed": 1}]
        if "GROUPING SETS" in sql:
            return [
                {"day": AS_OF, "store_id": None, "customers": 3},
                {"day": AS_OF, "store_id": 1, "customers": 3},
            ]
        if "per_customer" in sql:
            return [{"repeaters": 1, "buyers": 4}]
        if "top_products" in sql:
            return [
                {"store_id": None, "below_reorder": 1, "top_lines": 4, "top_below": 1},
                {"store_id": 1, "below_reorder": 1, "top_lines": 4, "top_below": 1},
            ]
        if "p.category" in sql:
            return [
                {
                    "day": AS_OF,
                    "category": "Dairy",
                    "sales": Decimal("300.00"),
                    "units": 9,
                    "orders": 3,
                }
            ]
        return []
