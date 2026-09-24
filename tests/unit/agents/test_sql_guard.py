"""SQL guard tests for run_readonly_sql (kit/02 AR-002, kit/07 Phase 13).

Pure validator tests — no Spark, no database. Execution-path tests live in
test_tools.py (fake runner) and test_graph.py (real Spark session).
"""

import pytest

from quickcart.agents.tools import SQL_ROW_CAP, ToolError, validate_readonly_sql


def test_simple_select_gets_limit_appended() -> None:
    sql, tables = validate_readonly_sql("SELECT * FROM silver_orders")
    assert sql == f"SELECT * FROM silver_orders LIMIT {SQL_ROW_CAP}"
    assert tables == ["silver_orders"]


def test_gold_tables_allowed() -> None:
    sql, tables = validate_readonly_sql(
        "SELECT a.store_id, b.gmv FROM gold_store_hourly_metrics a "
        "JOIN gold_inventory_health b ON a.store_id = b.store_id LIMIT 10"
    )
    assert "LIMIT 10" in sql  # explicit small LIMIT preserved
    assert tables == ["gold_store_hourly_metrics", "gold_inventory_health"]


def test_cte_select_allowed() -> None:
    sql, _ = validate_readonly_sql(
        "WITH x AS (SELECT store_id FROM silver_orders) SELECT * FROM x"
    )
    assert sql.startswith("WITH x AS")


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM silver_orders",
        "UPDATE silver_orders SET status = 'X'",
        "INSERT INTO silver_orders VALUES (1)",
        "DROP TABLE silver_orders",
        "ALTER TABLE silver_orders ADD COLUMN x INT",
        "CREATE TABLE silver_evil AS SELECT * FROM silver_orders",
        "GRANT SELECT ON silver_orders TO someone",
        "TRUNCATE TABLE silver_orders",
        "SELECT * INTO silver_backup FROM silver_orders",
        "MERGE INTO silver_orders USING silver_orders",
    ],
)
def test_mutating_and_ddl_statements_rejected(statement: str) -> None:
    with pytest.raises(ToolError, match=r"forbidden keyword|only a single SELECT"):
        validate_readonly_sql(statement)


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM silver_orders; DROP TABLE silver_orders",
        "SELECT * FROM silver_orders; SELECT * FROM silver_products",
        "SELECT * FROM silver_orders; DELETE FROM silver_orders; --",
    ],
)
def test_stacked_statements_rejected(statement: str) -> None:
    with pytest.raises(ToolError, match="multiple statements"):
        validate_readonly_sql(statement)


def test_stacked_statement_via_trailing_comment_is_inert() -> None:
    """Text after `--` is a comment: the executable statement is a pure SELECT."""
    sql, _ = validate_readonly_sql(
        "SELECT * FROM silver_orders --; DROP TABLE silver_orders"
    )
    assert sql == f"SELECT * FROM silver_orders LIMIT {SQL_ROW_CAP}"


def test_block_comment_hiding_statement_rejected() -> None:
    with pytest.raises(ToolError, match=r"multiple statements|unterminated"):
        validate_readonly_sql("SELECT * FROM silver_orders /*;*/ ; DROP TABLE x")


def test_split_keyword_via_comment_rejected() -> None:
    """`SEL/**/ECT` defeats naive word scans; after stripping it is not a SELECT."""
    with pytest.raises(ToolError, match="only a single SELECT"):
        validate_readonly_sql("SEL/**/ECT * FROM silver_orders")


def test_keywords_inside_string_literals_are_data() -> None:
    sql, _ = validate_readonly_sql(
        "SELECT * FROM silver_orders WHERE note = 'DELETE' AND other = 'a;b' LIMIT 10"
    )
    assert "LIMIT 10" in sql


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM bronze_orders",
        "SELECT * FROM orders",
        "SELECT * FROM pg_catalog.pg_tables",
        "SELECT * FROM main.silver_orders",
        "SELECT * FROM information_schema.tables",
    ],
)
def test_table_allow_list_enforced(statement: str) -> None:
    with pytest.raises(ToolError, match="allow-list"):
        validate_readonly_sql(statement)


def test_no_table_reference_rejected() -> None:
    with pytest.raises(ToolError, match="at least one"):
        validate_readonly_sql("SELECT 1 + 1")


def test_explicit_limit_above_cap_rejected() -> None:
    with pytest.raises(ToolError, match="exceeds the hard cap"):
        validate_readonly_sql(f"SELECT * FROM silver_orders LIMIT {SQL_ROW_CAP + 1}")


def test_explicit_limit_at_cap_kept() -> None:
    sql, _ = validate_readonly_sql(f"SELECT * FROM silver_orders LIMIT {SQL_ROW_CAP}")
    assert sql.endswith(f"LIMIT {SQL_ROW_CAP}")


def test_multiple_limit_clauses_rejected() -> None:
    with pytest.raises(ToolError, match="multiple LIMIT"):
        validate_readonly_sql("SELECT * FROM silver_orders LIMIT 10 LIMIT 20")


def test_unterminated_comment_rejected() -> None:
    with pytest.raises(ToolError, match="unterminated block comment"):
        validate_readonly_sql("SELECT * FROM silver_orders /* oops")


def test_unterminated_string_rejected() -> None:
    with pytest.raises(ToolError, match="unterminated string literal"):
        validate_readonly_sql("SELECT * FROM silver_orders WHERE note = 'oops")


def test_case_insensitive_keywords_rejected() -> None:
    with pytest.raises(ToolError, match=r"forbidden keyword|only a single SELECT"):
        validate_readonly_sql("DeLeTe FROM silver_orders")


def test_trailing_semicolon_tolerated() -> None:
    sql, _ = validate_readonly_sql("SELECT * FROM silver_orders;")
    assert sql == f"SELECT * FROM silver_orders LIMIT {SQL_ROW_CAP}"
