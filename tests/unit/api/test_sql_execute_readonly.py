"""Read-only execution tests for POST /api/v1/sql/execute (Postgres path).

Two independent defences are asserted here, both without a live database:

1. The guard refuses writes before a connection is even opened
   (`ExplodingConnectFactory` fails the test if one is).
2. The execution wrapper always runs inside a READ ONLY transaction with a
   ``statement_timeout``, so a write that somehow bypassed the guard is refused
   by the server. The bypass is simulated by handing `execute_postgres` a
   pre-guarded write statement; `FakeConnection` then raises
   ``ReadOnlySqlTransaction`` exactly as PostgreSQL does.

The live-database behaviour of the same code path (real ``BEGIN READ ONLY``,
real 25006 sqlstate) is covered by tests/integration/test_api.py against the
compose ``core`` profile; these tests pin the contract offline.
"""

from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest

from quickcart.api import sql_service
from quickcart.api.sql_guard import GuardedSql, SqlGuardError
from quickcart.api.sql_service import SqlExecutionError, execute_postgres, json_safe
from tests.unit.api.fakes import ExplodingConnectFactory, FakeConnectFactory

pytestmark = pytest.mark.unit

ORDER_ROWS = [{"order_id": 1, "total_amount": Decimal("125.50")}]
ORDER_COLUMNS = ["order_id", "total_amount"]


def factory(**kwargs) -> FakeConnectFactory:
    kwargs.setdefault("columns", ORDER_COLUMNS)
    kwargs.setdefault("rows", ORDER_ROWS)
    return FakeConnectFactory(**kwargs)


class TestReadOnlyEnvelope:
    def test_statement_runs_read_only_with_a_timeout(self) -> None:
        connect_factory = factory()
        result = execute_postgres(
            "SELECT order_id, total_amount FROM orders", connect_factory=connect_factory
        )
        conn = connect_factory.last
        assert conn.read_only is True
        kinds = [event[0] for event in conn.events]
        assert kinds.index("read_only") < kinds.index("begin") < kinds.index("execute")
        assert conn.statements[0] == "SET LOCAL statement_timeout = 30000"
        assert conn.statements[1].endswith("LIMIT 500")
        assert conn.closed is True
        assert result.source == "postgres"
        assert result.columns == ORDER_COLUMNS
        assert result.rows == [{"order_id": 1, "total_amount": 125.5}]
        assert result.row_count == 1
        assert result.truncated is False
        assert result.elapsed_ms >= 0

    def test_timeout_is_configurable_in_milliseconds(self) -> None:
        connect_factory = factory()
        execute_postgres(
            "SELECT * FROM orders", connect_factory=connect_factory, timeout_seconds=5
        )
        assert connect_factory.last.statements[0] == "SET LOCAL statement_timeout = 5000"


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO orders (order_id) VALUES (1)",
        "UPDATE inventory SET on_hand_qty = 0",
        "DELETE FROM orders WHERE order_id = 1",
        "DROP TABLE orders",
        "SELECT * FROM orders; DELETE FROM orders",
        "SELECT * FROM pg_catalog.pg_tables",
    ],
)
def test_writes_never_reach_the_database(statement: str) -> None:
    with pytest.raises(SqlGuardError):
        execute_postgres(statement, connect_factory=ExplodingConnectFactory())


def test_server_refuses_a_write_that_bypasses_the_guard(monkeypatch) -> None:
    """Second defence: with the guard neutralised, the READ ONLY transaction
    still refuses the write, and the failure is reported (never swallowed)."""
    bypassed = GuardedSql(
        sql="DELETE FROM orders",
        tables=["orders"],
        row_cap=500,
        limit_is_explicit=False,
        source="postgres",
    )
    monkeypatch.setattr(sql_service, "guard_postgres_sql", lambda sql, limit=None: bypassed)
    connect_factory = factory()
    with pytest.raises(SqlExecutionError) as exc:
        execute_postgres("DELETE FROM orders", connect_factory=connect_factory)
    assert exc.value.status_code == 400
    assert "read-only transaction" in exc.value.detail
    assert connect_factory.last.read_only is True


class TestFailureTranslation:
    def test_statement_timeout_is_504(self) -> None:
        connect_factory = factory(
            error=psycopg.errors.QueryCanceled("canceling statement due to statement timeout")
        )
        with pytest.raises(SqlExecutionError) as exc:
            execute_postgres("SELECT * FROM orders", connect_factory=connect_factory)
        assert exc.value.status_code == 504
        assert "timed out" in exc.value.detail

    def test_unreachable_database_is_503(self) -> None:
        connect_factory = FakeConnectFactory(
            connect_error=psycopg.OperationalError("connection refused")
        )
        with pytest.raises(SqlExecutionError) as exc:
            execute_postgres("SELECT * FROM orders", connect_factory=connect_factory)
        assert exc.value.status_code == 503

    def test_bad_sql_is_400(self) -> None:
        connect_factory = factory(
            error=psycopg.errors.UndefinedColumn('column "nope" does not exist')
        )
        with pytest.raises(SqlExecutionError) as exc:
            execute_postgres("SELECT nope FROM orders", connect_factory=connect_factory)
        assert exc.value.status_code == 400
        assert "nope" in exc.value.detail


class TestRowShaping:
    def test_request_limit_caps_and_flags_truncation(self) -> None:
        rows = [{"order_id": i} for i in range(10)]
        connect_factory = factory(columns=["order_id"], rows=rows)
        result = execute_postgres(
            "SELECT order_id FROM orders", limit=3, connect_factory=connect_factory
        )
        assert result.row_count == 3
        assert result.truncated is True
        assert connect_factory.last.statements[1].endswith("LIMIT 3")

    def test_columns_are_reported_for_an_empty_result(self) -> None:
        connect_factory = factory(columns=ORDER_COLUMNS, rows=[])
        result = execute_postgres("SELECT * FROM orders", connect_factory=connect_factory)
        assert result.columns == ORDER_COLUMNS
        assert result.rows == []
        assert result.truncated is False


class TestJsonSafe:
    def test_rich_driver_types_become_json_encodable(self) -> None:
        assert json_safe(Decimal("10.25")) == 10.25
        assert json_safe(datetime(2026, 9, 23, 12, 0, tzinfo=UTC)) == "2026-09-23T12:00:00+00:00"
        assert json_safe(b"\x01\x02") == "0102"
        assert json_safe({"a": [Decimal("1.5")]}) == {"a": [1.5]}
        assert json_safe(None) is None
