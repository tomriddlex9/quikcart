"""Tool-level tests: argument validation, proposal delegation, SQL execution.

No LLM and no LangGraph here — the registry is invoked directly. The Spark
execution test uses the shared session fixture and a tiny Delta table written
under a tmp data root.
"""

import pytest

from quickcart.agents.tools import (
    SQL_ROW_CAP,
    ToolDeps,
    ToolError,
    ToolRegistry,
    build_registry,
)
from tests.unit.agents.fakes import FakeProposalService, FakeRetriever, make_fake_sql_runner


def _registry(**kwargs) -> ToolRegistry:
    return build_registry(ToolDeps(**kwargs))


# --- argument validation ----------------------------------------------------- #


def test_invalid_arguments_raise_tool_error() -> None:
    registry = _registry()
    with pytest.raises(ToolError, match="invalid arguments"):
        registry.execute("get_store_metrics", {"store_id": -3})
    with pytest.raises(ToolError, match="invalid arguments"):
        registry.execute("get_delivery_prediction", {"order_id": "abc"})
    with pytest.raises(ToolError, match="invalid arguments"):
        registry.execute("search_company_docs", {"query": ""})
    with pytest.raises(ToolError, match="invalid arguments"):
        registry.execute("create_restock_proposal",
                         {"store_id": 1, "product_id": 2, "quantity": -5, "reason": "x"})
    with pytest.raises(ToolError, match="unknown tool"):
        registry.execute("drop_everything", {})


def test_missing_backend_is_a_visible_tool_error() -> None:
    registry = _registry()  # no backends at all
    with pytest.raises(ToolError, match="not configured"):
        registry.execute("get_store_metrics", {"store_id": 8})
    with pytest.raises(ToolError, match="not configured"):
        registry.execute("search_company_docs", {"query": "refund"})


# --- proposal tool ------------------------------------------------------------ #


def test_proposal_tool_delegates_to_proposal_service_and_never_executes() -> None:
    service = FakeProposalService()
    registry = _registry(proposal_service=service)
    result = registry.execute(
        "create_restock_proposal",
        {"store_id": 8, "product_id": 101, "quantity": 50,
         "reason": "below reorder point", "evidence": ["fake"]},
    )
    assert result["ok"] is True
    assert result["evidence"]["status"] == "PENDING"
    assert len(service.created) == 1
    body = service.created[0]
    assert body.proposal_type == "RESTOCK"
    assert body.entity_scope == {"store_id": 8, "product_id": 101, "quantity": 50}
    # The tool path only ever calls create(); the fake has no approve/execute
    # methods at all, which is exactly the bounded-action guarantee (AR-006).


def test_proposal_service_rejection_becomes_tool_error() -> None:
    from quickcart.api.models import ProposalCreate
    from quickcart.api.proposals import ProposalError

    class RejectingService:
        def create(self, body: ProposalCreate) -> dict:
            raise ProposalError(400, "store does not exist")

    registry = _registry(proposal_service=RejectingService())
    with pytest.raises(ToolError, match="store does not exist"):
        registry.execute(
            "create_restock_proposal",
            {"store_id": 999, "product_id": 1, "quantity": 10, "reason": "x"},
        )


# --- RAG tool ------------------------------------------------------------------ #


def test_docs_tool_returns_grounded_chunks() -> None:
    registry = _registry(retriever=FakeRetriever(supported=True))
    result = registry.execute("search_company_docs", {"query": "refund policy"})
    assert result["evidence"]["supported"] is True
    chunk = result["evidence"]["chunks"][0]
    assert chunk["doc_id"] == "refund_policy"
    assert chunk["version"] == "2.1"


def test_docs_tool_surfaces_explicit_uncertainty() -> None:
    from quickcart.rag.retrieve import UNSUPPORTED_MESSAGE

    registry = _registry(retriever=FakeRetriever(supported=False))
    result = registry.execute("search_company_docs", {"query": "ceo favourite colour"})
    assert result["evidence"]["supported"] is False
    assert result["evidence"]["message"] == UNSUPPORTED_MESSAGE


# --- SQL tool with injected runner --------------------------------------------- #


def test_sql_tool_enforces_limit_with_injected_runner() -> None:
    box, runner = make_fake_sql_runner()
    registry = _registry(sql_runner=runner)
    result = registry.execute("run_readonly_sql", {"sql": "SELECT * FROM silver_orders"})
    assert result["row_count"] == SQL_ROW_CAP  # runner returned 600; tool capped
    assert result["row_count"] == len(result["evidence"]["rows"])
    assert "LIMIT 500" in box["calls"][0]


def test_sql_tool_rejects_mutating_before_runner() -> None:
    box, runner = make_fake_sql_runner()
    registry = _registry(sql_runner=runner)
    with pytest.raises(ToolError, match=r"forbidden keyword|only a single SELECT"):
        registry.execute("run_readonly_sql", {"sql": "DELETE FROM silver_orders"})
    assert box["calls"] == []


# --- SQL tool against real Spark + Delta --------------------------------------- #


@pytest.mark.unit
def test_sql_tool_executes_against_real_spark_delta(spark_session, tmp_path) -> None:
    from pyspark.sql import Row

    silver = tmp_path / "silver" / "silver_orders"
    rows = [Row(order_id=i, status="PLACED", amount=float(i)) for i in range(600)]
    spark_session.createDataFrame(rows).write.format("delta").mode("overwrite").save(
        str(silver)
    )
    registry = _registry(spark=spark_session, data_root=tmp_path)
    result = registry.execute("run_readonly_sql", {"sql": "SELECT * FROM silver_orders"})
    assert result["row_count"] == SQL_ROW_CAP
    assert result["sql"].endswith(f"LIMIT {SQL_ROW_CAP}")
    box_row = result["evidence"]["rows"][0]
    assert set(box_row) == {"order_id", "status", "amount"}
