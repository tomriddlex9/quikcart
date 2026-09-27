"""POST /api/v1/sql/generate: candidate SQL only, and honest degradation.

The local model is a `FakeLLM`, so these tests never touch Ollama. The contract
being pinned: generation never executes anything, a rejected candidate is
reported rather than hidden, and an unreachable model degrades loudly instead of
raising.
"""

import pytest

from quickcart.agents.llm import LLMError
from quickcart.api.sql_intent import classify_sql_intent
from quickcart.api.sql_service import (
    GENERATE_SYSTEM_PROMPT,
    extract_sql,
    generate_sql,
    heuristic_sql,
)
from tests.unit.api.fakes import FakeLLM

pytestmark = pytest.mark.unit

PG_SCHEMA = (
    "QuickCart operational (public): orders/order_items for baskets and GMV; "
    "payments for settlement; stores and customers as dimensions; deliveries "
    "for SLA/late metrics.\n"
    "- orders(order_id bigint, store_id bigint, total_amount numeric, status text)\n"
    "- order_items(order_id bigint, line_total numeric)\n"
    "- stores(store_id bigint, name text)\n"
    "- customers(customer_id bigint)\n"
    "- payments(order_id bigint, amount numeric, status text)\n"
    "- deliveries(order_id bigint, is_late boolean, delivered_at timestamptz)"
)
PG_TABLES = (
    "orders",
    "order_items",
    "payments",
    "stores",
    "customers",
    "deliveries",
)
LH_SCHEMA = (
    "QuickCart lakehouse: silver_* cleansed facts; gold_* marts "
    "(gold_store_hourly_metrics, gold_delivery_performance, …).\n"
    "- silver_orders(order_id bigint, store_id bigint)\n"
    "- gold_store_hourly_metrics(store_id bigint, gmv numeric, late_rate numeric)\n"
    "- gold_delivery_performance(store_id bigint, is_late boolean)"
)
LH_TABLES = (
    "silver_orders",
    "gold_store_hourly_metrics",
    "gold_delivery_performance",
)


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
        assert generated.intent == "read"
        assert generated.allowed is True
        assert generated.joke is None

    def test_json_shaped_reply_is_accepted(self) -> None:
        llm = FakeLLM('{"sql": "SELECT order_id FROM orders LIMIT 20"}')
        generated = generate_sql("list order ids", "postgres", schema=PG_SCHEMA, llm=llm)
        assert generated.sql == "SELECT order_id FROM orders LIMIT 20"
        assert generated.valid is True

    def test_the_prompt_carries_the_schema_and_question(self) -> None:
        llm = FakeLLM("SELECT order_id FROM orders")
        generate_sql("how many orders?", "postgres", schema=PG_SCHEMA, llm=llm)
        user_message = llm.calls[0][-1]["content"]
        assert PG_SCHEMA in user_message
        assert "how many orders?" in user_message

    def test_mutate_intent_is_blocked_before_the_model_runs(self) -> None:
        llm = FakeLLM("DELETE FROM orders")
        generated = generate_sql(
            "remove all orders", "postgres", schema=PG_SCHEMA, tables=PG_TABLES, llm=llm
        )
        assert generated.allowed is False
        assert generated.intent == "mutate"
        assert generated.sql == ""
        assert generated.valid is False
        assert generated.degraded is False
        assert generated.joke is not None
        assert llm.calls == []
        assert any("write or delete" in note.lower() for note in generated.notes)

    def test_rejected_candidate_is_reported_not_executed(self) -> None:
        # Read-looking question, but the model still emits a write — guard catches it.
        llm = FakeLLM("DELETE FROM orders")
        generated = generate_sql(
            "list order ids", "postgres", schema=PG_SCHEMA, tables=PG_TABLES, llm=llm
        )
        assert generated.allowed is True
        assert generated.intent == "read"
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
        assert generated.sql == "SELECT COUNT(*) AS n FROM orders LIMIT 50"
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

    def test_system_prompt_documents_postgres_and_lakehouse_tables(self) -> None:
        lowered = GENERATE_SYSTEM_PROMPT.lower()
        for snippet in (
            "orders",
            "payments",
            "stores",
            "customers",
            "deliveries",
            "silver_",
            "gold_",
            "gold_store_hourly_metrics",
        ):
            assert snippet in lowered


class TestGoldenQuestions:
    """Pin NL→SQL generation inputs for common QuickCart analytics asks."""

    @pytest.mark.parametrize(
        ("question", "source", "schema", "tables", "schema_tables", "model_sql"),
        [
            (
                "how many orders were placed today?",
                "postgres",
                PG_SCHEMA,
                PG_TABLES,
                ("orders",),
                "SELECT count(*) FROM orders",
            ),
            (
                "what is the late delivery rate by store?",
                "postgres",
                PG_SCHEMA,
                PG_TABLES,
                ("deliveries", "stores", "orders"),
                "SELECT store_id, avg(CASE WHEN is_late THEN 1 ELSE 0 END) FROM deliveries",
            ),
            (
                "what is the GMV by store?",
                "postgres",
                PG_SCHEMA,
                PG_TABLES,
                ("stores", "orders"),
                (
                    "SELECT s.store_id, sum(o.total_amount) FROM stores s "
                    "JOIN orders o USING (store_id)"
                ),
            ),
            (
                "hourly GMV and late rate from the gold mart",
                "lakehouse",
                LH_SCHEMA,
                LH_TABLES,
                ("gold_store_hourly_metrics",),
                "SELECT store_id, gmv, late_rate FROM gold_store_hourly_metrics",
            ),
        ],
    )
    def test_read_questions_reach_the_model_with_expected_schema(
        self,
        question: str,
        source: str,
        schema: str,
        tables: tuple[str, ...],
        schema_tables: tuple[str, ...],
        model_sql: str,
    ) -> None:
        decision = classify_sql_intent(question)
        assert decision.intent == "read"
        assert decision.allowed is True

        llm = FakeLLM(f'{{"sql": "{model_sql} LIMIT 10"}}')
        generated = generate_sql(question, source, schema=schema, tables=tables, llm=llm)
        assert generated.allowed is True
        assert generated.intent == "read"
        assert llm.calls

        system_message = llm.calls[0][0]["content"]
        user_message = llm.calls[0][-1]["content"]
        assert system_message == GENERATE_SYSTEM_PROMPT
        for table in schema_tables:
            assert table in user_message
        assert schema.splitlines()[0] in user_message
        assert question in user_message
        assert generated.valid is True

    @pytest.mark.parametrize(
        "question",
        [
            "delete every order from last week",
            "update all payments set status = captured",
            "drop table orders",
        ],
    )
    def test_mutate_golden_questions_never_call_the_model(self, question: str) -> None:
        llm = FakeLLM("SELECT 1")
        generated = generate_sql(
            question, "postgres", schema=PG_SCHEMA, tables=PG_TABLES, llm=llm
        )
        assert generated.allowed is False
        assert generated.intent in {"mutate", "schema_change"}
        assert llm.calls == []


class TestExtractSql:
    def test_json_contract_reply_is_parsed(self) -> None:
        reply = '{"sql": "SELECT count(*) FROM orders LIMIT 10"}'
        assert extract_sql(reply) == "SELECT count(*) FROM orders LIMIT 10"

    def test_json_reply_with_reasoning_and_fences(self) -> None:
        reply = (
            "<think>counting orders</think>\n"
            '{"sql": "```sql\\nSELECT count(*) FROM orders\\n```"}'
        )
        assert extract_sql(reply) == "SELECT count(*) FROM orders"

    def test_json_without_a_sql_field_falls_back_to_text_scanning(self) -> None:
        assert extract_sql('{"answer": "no idea"}') == ""

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

    def test_how_many_uses_count(self) -> None:
        assert (
            heuristic_sql("how many orders today?", PG_TABLES)
            == "SELECT COUNT(*) AS n FROM orders LIMIT 50"
        )

    def test_gmv_phrasing_targets_orders(self) -> None:
        assert heuristic_sql("GMV by store last week", PG_TABLES) == "SELECT * FROM orders LIMIT 50"

    def test_late_delivery_phrasing_targets_deliveries(self) -> None:
        assert (
            heuristic_sql("late delivery rate by zone", PG_TABLES)
            == "SELECT * FROM deliveries LIMIT 50"
        )

    def test_lakehouse_gold_mart_hint(self) -> None:
        assert (
            heuristic_sql("compare hourly gmv across stores", LH_TABLES)
            == "SELECT * FROM gold_store_hourly_metrics LIMIT 50"
        )

    def test_no_match_returns_nothing(self) -> None:
        assert heuristic_sql("what is the weather", PG_TABLES) == ""
