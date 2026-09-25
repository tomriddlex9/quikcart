"""Guard tests for the console SQL endpoints (kit/02 AR-002).

Pure validator tests — no database, no Spark. The Postgres guard is tested in
full here; the lakehouse guard is `quickcart.agents.tools.validate_readonly_sql`
(covered by tests/unit/agents/test_sql_guard.py), so the cases below only pin
the console wrapper: allow-list separation between the two sources, the
request-level row cap, and error translation.
"""

import pytest

from quickcart.agents.tools import SQL_ROW_CAP
from quickcart.api.sql_guard import (
    POSTGRES_TABLES,
    GuardedSql,
    SqlGuardError,
    apply_row_cap,
    guard_lakehouse_sql,
    guard_postgres_sql,
    guard_sql,
    resolve_row_cap,
)

pytestmark = pytest.mark.unit


class TestPostgresHappyPath:
    def test_simple_select_gets_the_row_cap_appended(self) -> None:
        guarded = guard_postgres_sql("SELECT * FROM orders")
        assert guarded.sql == f"SELECT * FROM orders LIMIT {SQL_ROW_CAP}"
        assert guarded.tables == ["orders"]
        assert guarded.source == "postgres"
        assert guarded.limit_is_explicit is False

    def test_join_across_allow_listed_tables(self) -> None:
        guarded = guard_postgres_sql(
            "SELECT o.order_id, p.amount FROM orders o "
            "JOIN payments p ON p.order_id = o.order_id LIMIT 10"
        )
        assert guarded.sql.endswith("LIMIT 10")
        assert guarded.tables == ["orders", "payments"]
        assert guarded.limit_is_explicit is True

    def test_cte_names_are_not_tables(self) -> None:
        guarded = guard_postgres_sql(
            "WITH recent AS (SELECT order_id FROM orders) SELECT * FROM recent"
        )
        assert guarded.tables == ["orders"]

    def test_public_schema_qualification_allowed(self) -> None:
        assert guard_postgres_sql("SELECT * FROM public.orders").tables == ["orders"]

    def test_keywords_inside_string_literals_are_data(self) -> None:
        guarded = guard_postgres_sql(
            "SELECT * FROM orders WHERE status = 'DELETE' AND currency = 'a;b' LIMIT 5"
        )
        assert guarded.sql.endswith("LIMIT 5")

    def test_case_expression_survives_the_blocklist(self) -> None:
        guarded = guard_postgres_sql(
            "SELECT CASE WHEN total_amount > 100 THEN 'big' ELSE 'small' END AS bucket"
            " FROM orders"
        )
        assert guarded.tables == ["orders"]

    def test_nested_block_comments_are_stripped(self) -> None:
        guarded = guard_postgres_sql("SELECT /* outer /* inner */ still */ 1, order_id FROM orders")
        assert "/*" not in guarded.sql
        assert guarded.tables == ["orders"]

    def test_extract_from_is_not_a_table_reference(self) -> None:
        guarded = guard_postgres_sql(
            "SELECT extract(hour FROM placed_at) AS hour, count(*) "
            "FROM orders GROUP BY 1"
        )
        assert guarded.tables == ["orders"]
        assert "placed_at" not in guarded.tables

    def test_every_allow_listed_table_is_readable(self) -> None:
        for table in sorted(POSTGRES_TABLES):
            assert guard_postgres_sql(f"SELECT * FROM {table}").tables == [table]


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO orders (order_id) VALUES (1)",
        "UPDATE orders SET status = 'X'",
        "DELETE FROM orders",
        "DROP TABLE orders",
        "ALTER TABLE orders ADD COLUMN x INT",
        "CREATE TABLE evil AS SELECT * FROM orders",
        "TRUNCATE TABLE orders",
        "GRANT SELECT ON orders TO someone",
        "MERGE INTO orders USING orders",
        "COPY orders TO '/tmp/out.csv'",
        "SELECT * INTO backup FROM orders",
        "WITH moved AS (DELETE FROM orders RETURNING *) SELECT * FROM moved",
    ],
)
def test_postgres_writes_are_rejected(statement: str) -> None:
    with pytest.raises(SqlGuardError, match=r"forbidden keyword|only a single SELECT"):
        guard_postgres_sql(statement)


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO silver_orders VALUES (1)",
        "UPDATE silver_orders SET status = 'X'",
        "DELETE FROM silver_orders",
        "DROP TABLE gold_customer_360",
    ],
)
def test_lakehouse_writes_are_rejected(statement: str) -> None:
    with pytest.raises(SqlGuardError, match=r"forbidden keyword|only a single SELECT"):
        guard_lakehouse_sql(statement)


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM orders; DROP TABLE orders",
        "SELECT * FROM orders; SELECT * FROM payments",
        "SELECT * FROM orders; DELETE FROM orders; --",
    ],
)
def test_stacked_statements_rejected_for_both_sources(statement: str) -> None:
    with pytest.raises(SqlGuardError, match="multiple statements"):
        guard_postgres_sql(statement)
    with pytest.raises(SqlGuardError, match="multiple statements"):
        guard_lakehouse_sql(statement.replace("orders", "silver_orders"))


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM order_events",
        "SELECT * FROM pg_catalog.pg_tables",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM pg_stat_activity",
        "SELECT * FROM silver_orders",  # analytical tables belong to the other source
        "SELECT * FROM orders JOIN secrets ON true",
    ],
)
def test_postgres_table_allow_list_enforced(statement: str) -> None:
    with pytest.raises(SqlGuardError, match=r"allow-list|not readable"):
        guard_postgres_sql(statement)


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM orders",  # operational tables belong to the other source
        "SELECT * FROM bronze_orders",
        "SELECT * FROM information_schema.tables",
    ],
)
def test_lakehouse_table_allow_list_enforced(statement: str) -> None:
    with pytest.raises(SqlGuardError, match="allow-list"):
        guard_lakehouse_sql(statement)


@pytest.mark.parametrize(
    ("statement", "message"),
    [
        ('SELECT * FROM "orders"', "double-quoted identifiers"),
        ("SELECT $$x$$ FROM orders", "dollar-quoted"),
        ("SELECT * FROM orders WHERE status = E'\\x41'", "escape string"),
        ("SELECT * FROM orders FOR UPDATE", "locking clauses"),
        ("SELECT pg_sleep(30) FROM orders", "pg_sleep"),
        ("SELECT pg_read_file('/etc/passwd') FROM orders", "pg_read_file"),
        ("SELECT nextval('orders_seq') FROM orders", "nextval"),
    ],
)
def test_postgres_specific_syntax_rejected(statement: str, message: str) -> None:
    with pytest.raises(SqlGuardError, match=message):
        guard_postgres_sql(statement)


def test_no_table_reference_rejected() -> None:
    with pytest.raises(SqlGuardError, match="at least one operational table"):
        guard_postgres_sql("SELECT 1 + 1")


def test_unterminated_comment_rejected() -> None:
    with pytest.raises(SqlGuardError, match="unterminated block comment"):
        guard_postgres_sql("SELECT * FROM orders /* oops")


def test_unterminated_string_rejected() -> None:
    with pytest.raises(SqlGuardError, match="unterminated string literal"):
        guard_postgres_sql("SELECT * FROM orders WHERE status = 'oops")


def test_keyword_split_by_comment_is_not_a_select() -> None:
    with pytest.raises(SqlGuardError, match="only a single SELECT"):
        guard_postgres_sql("SEL/**/ECT * FROM orders")


class TestRowCap:
    def test_request_limit_replaces_the_appended_cap(self) -> None:
        guarded = guard_postgres_sql("SELECT * FROM orders", 25)
        assert guarded.sql.endswith("LIMIT 25")
        assert guarded.row_cap == 25

    def test_request_limit_above_the_hard_cap_is_clamped(self) -> None:
        assert resolve_row_cap(10_000) == SQL_ROW_CAP
        assert guard_postgres_sql("SELECT * FROM orders", 10_000).row_cap == SQL_ROW_CAP

    def test_zero_limit_rejected(self) -> None:
        with pytest.raises(SqlGuardError, match="limit must be positive"):
            resolve_row_cap(0)

    def test_explicit_limit_above_the_hard_cap_rejected(self) -> None:
        with pytest.raises(SqlGuardError, match="exceeds the hard cap"):
            guard_postgres_sql(f"SELECT * FROM orders LIMIT {SQL_ROW_CAP + 1}")

    def test_multiple_limit_clauses_rejected(self) -> None:
        with pytest.raises(SqlGuardError, match="multiple LIMIT"):
            guard_postgres_sql("SELECT * FROM orders LIMIT 10 LIMIT 20")

    def test_lakehouse_cap_is_lowered_to_the_request_limit(self) -> None:
        guarded = guard_lakehouse_sql("SELECT * FROM silver_orders", 5)
        assert guarded.sql == "SELECT * FROM silver_orders LIMIT 5"
        assert guarded.row_cap == 5

    def test_lakehouse_keeps_an_explicit_limit(self) -> None:
        guarded = guard_lakehouse_sql("SELECT * FROM silver_orders LIMIT 7", 5)
        assert guarded.sql.endswith("LIMIT 7")
        assert guarded.row_cap == 5
        assert guarded.limit_is_explicit is True


class TestApplyRowCap:
    def guarded(self, row_cap: int, *, explicit: bool) -> GuardedSql:
        return GuardedSql(
            sql="SELECT 1",
            tables=["orders"],
            row_cap=row_cap,
            limit_is_explicit=explicit,
            source="postgres",
        )

    def test_extra_rows_are_dropped_and_reported(self) -> None:
        rows = [{"n": i} for i in range(5)]
        capped, truncated = apply_row_cap(rows, self.guarded(3, explicit=True))
        assert len(capped) == 3
        assert truncated is True

    def test_filling_a_guard_imposed_cap_reports_truncation(self) -> None:
        rows = [{"n": i} for i in range(3)]
        _, truncated = apply_row_cap(rows, self.guarded(3, explicit=False))
        assert truncated is True

    def test_a_user_limit_that_is_filled_is_not_truncation(self) -> None:
        rows = [{"n": i} for i in range(3)]
        _, truncated = apply_row_cap(rows, self.guarded(3, explicit=True))
        assert truncated is False

    def test_short_result_is_never_truncated(self) -> None:
        _, truncated = apply_row_cap([{"n": 1}], self.guarded(3, explicit=False))
        assert truncated is False


class TestDispatch:
    def test_guard_sql_routes_by_source(self) -> None:
        assert guard_sql("postgres", "SELECT * FROM orders").source == "postgres"
        assert guard_sql("lakehouse", "SELECT * FROM gold_customer_360").source == "lakehouse"

    def test_unknown_source_rejected(self) -> None:
        with pytest.raises(SqlGuardError, match="unknown source"):
            guard_sql("duckdb", "SELECT * FROM orders")
