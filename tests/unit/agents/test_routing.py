"""Intent routing tests (kit/07 Phase 13: analytics/policy/prediction/mixed + traps).

All runs use the deterministic FakeLLM and fake backends — no Ollama, no
Spark, no Qdrant, no network.
"""

from tests.unit.agents.fakes import FakeLLM, build_fake_registry, called_tools, run_graph


def test_analytics_question_chooses_analytics_tool() -> None:
    state = run_graph("How is Store 8 performing today?", registry=build_fake_registry())
    assert state["intent"] == "analytics"
    assert "get_store_metrics" in called_tools(state)
    assert "search_company_docs" not in called_tools(state)
    assert "run_readonly_sql" not in called_tools(state)


def test_policy_question_chooses_rag_tool() -> None:
    state = run_graph(
        "What is our refund policy for expired items?", registry=build_fake_registry()
    )
    assert state["intent"] == "policy"
    assert called_tools(state) == ["search_company_docs"]


def test_policy_question_never_uses_sql_wrong_tool_trap() -> None:
    """kit/07 wrong-tool trap: a policy question must not hit the SQL tool."""
    state = run_graph(
        "What is our refund policy for expired items?", registry=build_fake_registry()
    )
    assert "run_readonly_sql" not in called_tools(state)
    assert "get_store_metrics" not in called_tools(state)
    doc_evidence = [e for e in state["evidence"] if e.get("type") == "document"]
    assert doc_evidence and doc_evidence[0]["supported"] is True
    assert doc_evidence[0]["chunks"][0]["doc_id"] == "refund_policy"


def test_prediction_question_chooses_ml_tool() -> None:
    state = run_graph("Will order 421 be delivered late?", registry=build_fake_registry())
    assert state["intent"] == "prediction"
    assert "get_delivery_prediction" in called_tools(state)


def test_store_prediction_question_chooses_forecast_tool() -> None:
    state = run_graph(
        "What is the demand forecast for store 8?", registry=build_fake_registry()
    )
    assert state["intent"] == "prediction"
    assert "get_demand_forecast" in called_tools(state)


def test_mixed_question_uses_multiple_tools() -> None:
    state = run_graph(
        "How is Store 8 performing and what does the refund policy say?",
        registry=build_fake_registry(),
    )
    assert state["intent"] == "mixed"
    called = set(called_tools(state))
    assert "search_company_docs" in called
    assert called & {"get_store_metrics", "get_kpi_summary"}


def test_unsupported_question_runs_no_tools() -> None:
    state = run_graph("What is the CEO's favourite colour?", registry=build_fake_registry())
    assert state["intent"] == "unsupported"
    assert called_tools(state) == []
    assert "don't have sufficient evidence" in state["answer"]


def test_empty_request_is_handled_gracefully() -> None:
    state = run_graph("", registry=build_fake_registry())
    assert state["intent"] == "unsupported"
    assert called_tools(state) == []
    assert state["answer"]


def test_word_number_store_resolution() -> None:
    state = run_graph("How is store eight performing?", registry=build_fake_registry())
    step = next(s for s in state["tool_trace"] if s["tool"] == "get_store_metrics")
    assert '"store_id": 8' in step["arguments_summary"]


def test_unresolvable_store_asks_clarification() -> None:
    state = run_graph("How is that store performing?", registry=build_fake_registry())
    assert state["needs_clarification"] is True
    assert called_tools(state) == []
    assert "could not determine which store" in state["answer"]


def test_llm_failure_falls_back_to_heuristic_routing() -> None:
    """A dead LLM at classification degrades to keyword routing, visibly."""
    llm = FakeLLM(fail_tags=("[INTENT]",))
    state = run_graph("How is Store 8 performing?", registry=build_fake_registry(), llm=llm)
    assert "get_store_metrics" in called_tools(state)
    assert any("intent classification fallback" in e for e in state["errors"])
