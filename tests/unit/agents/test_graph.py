"""Graph-level tests: bounded loop, grounding, trace persistence, service contract."""

import json

from quickcart.agents import service
from quickcart.agents.graph import DEFAULT_MAX_STEPS, build_graph, initial_state
from quickcart.rag.retrieve import UNSUPPORTED_MESSAGE
from tests.unit.agents.fakes import (
    FakeLLM,
    build_fake_registry,
    run_graph,
)


def _graph(registry, llm, tmp_path):
    return build_graph(llm, registry, artifacts_dir=tmp_path)


# --- bounded loop (kit/02 AR-003, kit/07 Phase 13) ---------------------------- #


def test_plan_wanting_many_steps_is_cut_at_max_steps(tmp_path) -> None:
    steps = [{"tool": "get_kpi_summary", "arguments": {}, "purpose": f"s{i}"}
             for i in range(DEFAULT_MAX_STEPS + 3)]
    llm = FakeLLM(plan_steps=steps)
    registry = build_fake_registry()
    graph = _graph(registry, llm, tmp_path)
    final = graph.invoke(initial_state("overview please"), config={"recursion_limit": 60})
    assert final["step_count"] == DEFAULT_MAX_STEPS
    assert len(final["tool_trace"]) == DEFAULT_MAX_STEPS
    assert final["errors"] == []


def test_loop_terminates_when_plan_is_exhausted(tmp_path) -> None:
    state = run_graph("How is Store 8 performing?",
                      registry=build_fake_registry(), artifacts_dir=tmp_path)
    assert state["step_count"] == len(state["tool_trace"]) == 1


# --- grounding (kit/07 §8) ----------------------------------------------------- #


def test_answer_prompt_contains_evidence_and_answer_is_grounded(tmp_path) -> None:
    llm = FakeLLM()
    state = run_graph("How is Store 8 performing?",
                      registry=build_fake_registry(), llm=llm, artifacts_dir=tmp_path)
    answer_prompts = [s for (tag, s, _u) in llm.calls if tag == "[ANSWER]"]
    assert answer_prompts, "the answer node must consult the LLM with evidence"
    assert '"late_rate": 0.12' in answer_prompts[0]  # retrieved fact reached the prompt
    assert state["answer"].startswith("[FAKE-ANSWER]")
    assert "get_store_metrics" in state["answer"]


def test_rag_uncertainty_message_reaches_answer_prompt(tmp_path) -> None:
    llm = FakeLLM()
    registry = build_fake_registry(docs_supported=False)
    state = run_graph("What is the moon policy?", registry=registry, llm=llm,
                      artifacts_dir=tmp_path)
    assert state["intent"] == "policy"
    doc_evidence = [e for e in state["evidence"] if e.get("type") == "document"]
    assert doc_evidence[0]["supported"] is False
    answer_prompts = [s for (tag, s, _u) in llm.calls if tag == "[ANSWER]"]
    assert UNSUPPORTED_MESSAGE in answer_prompts[0]
    # No fabricated policy: the only document fact is the explicit uncertainty.
    assert all(e.get("supported") is not False or "message" in e for e in state["evidence"])


def test_answer_falls_back_to_evidence_dump_when_llm_dies(tmp_path) -> None:
    llm = FakeLLM(fail_tags=("[ANSWER]",))
    state = run_graph("How is Store 8 performing?",
                      registry=build_fake_registry(), llm=llm, artifacts_dir=tmp_path)
    assert any("answer fallback" in e for e in state["errors"])
    assert "uninterpreted" in state["answer"]  # raw facts, clearly labelled


def test_extract_json_tolerates_model_padding_and_truncation() -> None:
    from quickcart.agents.graph import _extract_json

    assert _extract_json('{"a": 1}') == {"a": 1}
    assert _extract_json('preamble {"a": 1} trailing prose') == {"a": 1}
    assert _extract_json('{"steps": [1]}\n  \n    \n  ') == {"steps": [1]}
    assert _extract_json('{"a": 1') == {"a": 1}  # final brace never generated
    assert _extract_json('{"a": {"b": 2') == {"a": {"b": 2}}
    assert _extract_json("no json at all") is None
    assert _extract_json('{"broken": ') is None


# --- trace persistence ---------------------------------------------------------- #


def test_trace_file_is_written(tmp_path) -> None:
    state = run_graph("How is Store 8 performing?",
                      registry=build_fake_registry(), artifacts_dir=tmp_path)
    trace_path = state["trace_path"]
    assert trace_path is not None
    trace = json.loads((tmp_path / f"{state['request_id']}.json").read_text())
    assert trace["request_id"] == state["request_id"]
    assert trace["intent"] == "analytics"
    assert trace["tool_trace"][0]["tool"] == "get_store_metrics"
    assert trace["answer"] == state["answer"]


# --- service.chat contract (the exact shape src/quickcart/api/app.py consumes) -- #


def test_chat_returns_api_contract_dict(monkeypatch, tmp_path) -> None:
    registry = build_fake_registry()
    graph = _graph(registry, FakeLLM(), tmp_path)
    monkeypatch.setattr(service, "_runtime", lambda: (graph, None))

    result = service.chat("How is Store 8 performing?", session_id="s-1")
    assert set(result) >= {"answer", "evidence", "tool_trace"}
    assert isinstance(result["answer"], str) and result["answer"]
    assert isinstance(result["evidence"], list)
    assert all(isinstance(item, dict) for item in result["evidence"])
    assert isinstance(result["tool_trace"], list)
    step = result["tool_trace"][0]
    assert {"step", "tool", "arguments_summary", "result_summary"} <= set(step)
    assert result["degraded"] is False


def test_chat_degrades_loudly_on_infrastructure_failure(monkeypatch) -> None:
    class _ExplodingGraph:
        @staticmethod
        def invoke(state, config=None):
            raise RuntimeError("spark vanished")

    monkeypatch.setattr(service, "_runtime", lambda: (_ExplodingGraph(), None))
    result = service.chat("How is Store 8 performing?")
    assert result["degraded"] is True
    assert result["evidence"] == []
    assert result["tool_trace"] == []
    assert "unavailable" in result["answer"]
