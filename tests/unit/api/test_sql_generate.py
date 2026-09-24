"""POST /api/v1/sql/generate: candidate SQL only, and honest degradation.

The local model is a `FakeLLM`, so these tests never touch Ollama. The contract
being pinned: generation never executes anything, a rejected candidate is
reported rather than hidden, and an unreachable model degrades loudly instead of
raising.
"""

import pytest

from quickcart.agents.llm import LLMError
from quickcart.api.sql_service import extract_sql, generate_sql, heuristic_sql
from tests.unit.api.fakes import FakeLLM

pytestmark = pytest.mark.unit

PG_SCHEMA = "- orders(order_id bigint, total_amount numeric)\n- payments(order_id bigint)"
PG_TABLES = ("orders", "payments", "customers")


class TestGenerate:
    def test_valid_candidate_is_returned_with_the_row_cap(self) -> None:
        llm = FakeLLM("```sql\nSELECT order_id FROM orders\n```")
        generated = generate_sql(
            "list order ids", "postgres", schema=PG_SCHEMA, tables=PG_TABLES, llm=llm
        )
        assert generated.sql == "SELECT order_id FROM orders LIMIT 500"
        assert generated.valid is True
        assert generated.degraded is False
        assert generated.model == "fake-model"
        assert generated.notes == []

    def test_the_prompt_carries_the_schema_and_question(self) -> None:
        llm = FakeLLM("SELECT order_id FROM orders")
        generate_sql("how many orders?", "postgres", schema=PG_SCHEMA, llm=llm)
        user_message = llm.calls[0][-1]["content"]
        assert PG_SCHEMA in user_message
        assert "how many orders?" in user_message

    def test_rejected_candidate_is_reported_not_executed(self) -> None:
        llm = FakeLLM("DELETE FROM orders")
        generated = generate_sql(
            "remove all orders", "postgres", schema=PG_SCHEMA, tables=PG_TABLES, llm=llm
        )
        assert generated.valid is False
        assert generated.degraded is False
        assert generated.sql == "DELETE FROM orders"
        assert any("rejected by the read-only guard" in note for note in generated.notes)

    def test_candidate_for_the_wrong_source_is_rejected(self) -> None:
        llm = FakeLLM("SELECT * FROM orders")
        generated = generate_sql(
            "orders", "lakehouse", schema="- silver_orders(order_id)", llm=llm
        )
        assert generated.valid is False
        assert any("allow-list" in note for note in generated.notes)

    def test_unreachable_model_degrades_with_a_heuristic(self) -> None:
        llm = FakeLLM(error=LLMError("ollama chat failed: connection refused"))
        generated = generate_sql(
            "how many orders today?",
            "postgres",
            schema=PG_SCHEMA,
            tables=PG_TABLES,
            llm=llm,
        )
        assert generated.degraded is True
        assert generated.valid is False
        assert generated.sql == "SELECT * FROM orders LIMIT 50"
        assert any("local model call failed" in note for note in generated.notes)

    def test_empty_reply_is_reported_without_claiming_degradation(self) -> None:
        llm = FakeLLM("I cannot help with that.")
        generated = generate_sql(
            "nonsense", "postgres", schema=PG_SCHEMA, tables=PG_TABLES, llm=llm
        )
        assert generated.sql == ""
        assert generated.valid is False
        assert generated.degraded is False
        assert any("no SQL statement" in note for note in generated.notes)

    def test_catalog_notes_are_carried_through(self) -> None:
        llm = FakeLLM("SELECT order_id FROM orders")
        generated = generate_sql(
            "orders",
            "postgres",
            schema=PG_SCHEMA,
            llm=llm,
            notes=["column names unavailable"],
        )
        assert generated.notes == ["column names unavailable"]


class TestExtractSql:
    def test_reasoning_blocks_and_prose_are_dropped(self) -> None:
        reply = (
            "<think>The user wants a count.</think>\n"
            "Here you go:\n```sql\nSELECT count(*) FROM orders LIMIT 10;\n```\nHope that helps."
        )
        assert extract_sql(reply) == "SELECT count(*) FROM orders LIMIT 10"

    def test_bare_statement_is_normalised(self) -> None:
        assert extract_sql("  SELECT  *\n  FROM orders\n") == "SELECT * FROM orders"

    def test_trailing_statement_after_a_semicolon_is_dropped(self) -> None:
        assert extract_sql("SELECT 1 FROM orders; DROP TABLE orders") == "SELECT 1 FROM orders"

    def test_reply_without_sql_is_empty(self) -> None:
        assert extract_sql("I am not able to answer that.") == ""


class TestHeuristicSql:
    def test_table_named_in_the_question_is_previewed(self) -> None:
        assert heuristic_sql("show me payments", PG_TABLES) == "SELECT * FROM payments LIMIT 50"

    def test_singular_mention_matches(self) -> None:
        assert heuristic_sql("one order please", PG_TABLES) == "SELECT * FROM orders LIMIT 50"

    def test_no_match_returns_nothing(self) -> None:
        assert heuristic_sql("what is the weather", PG_TABLES) == ""
