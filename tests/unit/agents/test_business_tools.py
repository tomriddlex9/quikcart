"""Business tools, registry RBAC/scope/audit, the native loop, SSE and the eval set.

Everything runs over the stub read model + scripted/keyword models: no network,
no PostgreSQL, no Spark.
"""

from __future__ import annotations

import json

import pytest

from quickcart.agents import service
from quickcart.agents.cards import hydrate_answer
from quickcart.agents.eval import KeywordToolLLM, load_cases, run_suite
from quickcart.agents.gemini_tools import ModelStep, ToolCall
from quickcart.agents.loop import NativeToolLoop, SentenceGate, SummaryStreamer
from quickcart.agents.tools import (
    ToolArgumentError,
    ToolError,
    ToolPermissionError,
    ToolRegistry,
    ToolSpec,
    UnknownToolError,
    build_registry,
    current_tool_context,
    reset_tool_cache,
)
from tests.unit.agents.business_fixtures import (
    FakeProposals,
    ScriptedToolLLM,
    call,
    make_business_deps,
    make_principal,
    make_registry,
)
from tests.unit.agents.test_agent_stream import _parse_sse

pytestmark = pytest.mark.unit


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #


def test_get_metric_global_returns_facts_view_and_default_card() -> None:
    result = make_registry().execute("get_metric", {"metric": "sales"})
    fact = result["facts"]["metric:sales_gmv:all"]
    assert fact["display"] == "₹2.50 L" and fact["status"] in {"good", "watch", "bad"}
    assert fact["delta_pct"] == 25.0
    assert result["card_drafts"] == [{"type": "kpi", "ref": "metric:sales_gmv:all"}]
    view = result["model_view"]
    assert view["found"] is True and view["facts"][0]["value"] == "₹2.50 L"
    assert view["facts"][0]["change"] == "+25.0%"
    assert result["summary"] and result["evidence"]["type"] == "business"
    assert result["cache_hit"] is False


def test_get_metric_resolves_label_and_synonym_and_reports_unknown() -> None:
    registry = make_registry()
    assert (
        "metric:on_time_rate:all"
        in registry.execute("get_metric", {"metric": "On-time rate"})["facts"]
    )
    unknown = registry.execute("get_metric", {"metric": "happiness"})
    assert unknown["model_view"]["found"] is False and unknown["facts"] == {}
    assert "sales_gmv" in unknown["model_view"]["available_metrics"]


def test_get_metric_store_with_trend_and_unknown_store() -> None:
    registry = make_registry()
    result = registry.execute(
        "get_metric", {"metric": "sales_gmv", "store_id": 1, "include_trend": True}
    )
    assert "metric:sales_gmv:store:1" in result["facts"]
    series = result["facts"]["series:sales_gmv:store:1"]
    assert series["kind"] == "series" and len(series["points"]) == 14
    assert [c["type"] for c in result["card_drafts"]] == ["kpi", "trend"]
    missing = registry.execute("get_metric", {"metric": "sales_gmv", "store_id": 99})
    assert missing["model_view"]["found"] is False
    not_per_store = registry.execute("get_metric", {"metric": "repeat_rate", "store_id": 1})
    assert not_per_store["model_view"]["found"] is False


def test_compare_stores_orders_worst_first_and_builds_table() -> None:
    result = make_registry().execute("compare_stores", {"metric": "on_time_rate"})
    table = result["facts"]["stores:on_time_rate"]
    assert table["rows"][0]["Store"] == "Koramangala"  # 70% is worse than 93%
    assert {"table", "compare"} == {c["type"] for c in result["card_drafts"]}
    best = make_registry().execute(
        "compare_stores", {"metric": "on_time_rate", "order": "best_first", "limit": 1}
    )
    assert best["facts"]["stores:on_time_rate"]["rows"][0]["Store"] == "Indiranagar"
    assert make_registry().execute("compare_stores", {"metric": "repeat_rate"})["facts"] == {}


def test_compare_stores_is_filtered_to_the_callers_scope() -> None:
    store_two = make_principal("store_manager", stores=(2,))
    result = make_registry().execute("compare_stores", {"metric": "on_time_rate"}, store_two)
    rows = result["facts"]["stores:on_time_rate"]["rows"]
    assert [r["Store"] for r in rows] == ["Indiranagar"]


def test_explain_metric_change_has_drivers_and_movers() -> None:
    result = make_registry().execute("explain_metric_change", {"metric": "sales_gmv"})
    refs = set(result["facts"])
    assert {"metric:sales_gmv:all", "metric:orders:all", "metric:average_basket:all"} <= refs
    assert "movers:sales_gmv" in refs
    view = result["model_view"]
    assert {d["label"] for d in view["drivers"]} == {"Orders", "Average basket (AOV)"}
    store = make_registry().execute("explain_metric_change", {"metric": "sales_gmv", "store_id": 1})
    assert "metric:sales_gmv:store:1" in store["facts"] and "movers:sales_gmv" not in store["facts"]


def test_briefing_and_alerts() -> None:
    registry = make_registry()
    briefing = registry.execute("get_briefing", {})
    assert "risk:attention" in briefing["facts"]
    assert briefing["facts"]["risk:attention"]["items"]
    assert any(c["type"] == "risk_list" for c in briefing["card_drafts"])
    alerts = registry.execute("get_alerts", {})
    assert alerts["facts"]["risk:alerts"]["label"] == "Needs attention"  # no rules configured
    assert "No alert rules" in alerts["model_view"]["note"]
    one_store = registry.execute("get_alerts", {"store_id": 1})
    assert all(i["store_id"] == 1 for i in one_store["facts"]["risk:alerts"]["items"])


def test_draft_action_creates_pending_proposal_only() -> None:
    proposals = FakeProposals()
    registry = make_registry(proposals)
    result = registry.execute(
        "draft_action",
        {
            "action_type": "RESTOCK",
            "store_id": 1,
            "product_id": 10,
            "quantity": 50,
            "reason": "low",
        },
    )
    body = proposals.created[0]
    assert body.proposal_type == "RESTOCK" and body.entity_scope == {
        "store_id": 1,
        "product_id": 10,
        "quantity": 50,
    }
    fact = result["facts"]["proposal:42"]
    assert fact["data"]["status"] == "PENDING" and result["model_view"]["executes"] is False
    assert result["card_drafts"] == [{"type": "proposal", "ref": "proposal:42"}]
    with pytest.raises(ToolError, match="product_id and quantity"):
        registry.execute("draft_action", {"action_type": "RESTOCK", "store_id": 1, "reason": "x"})
    incident = registry.execute(
        "draft_action", {"action_type": "INCIDENT", "store_id": 2, "reason": "rider shortage"}
    )
    assert proposals.created[1].entity_scope == {"store_id": 2}
    assert incident["facts"]["proposal:43"]["data"]["proposal_type"] == "INCIDENT"


def test_draft_action_validation_failure_is_a_tool_error() -> None:
    from quickcart.api.proposals import ProposalError

    class Rejecting:
        def create(self, body):
            raise ProposalError(400, "quantity too large")

    registry = make_registry(Rejecting())  # type: ignore[arg-type]
    with pytest.raises(ToolError, match="quantity too large"):
        registry.execute(
            "draft_action",
            {
                "action_type": "RESTOCK",
                "store_id": 1,
                "product_id": 1,
                "quantity": 5,
                "reason": "r",
            },
        )


# --------------------------------------------------------------------------- #
# Registry: RBAC, surfaces, scope, cache, audit
# --------------------------------------------------------------------------- #


def test_principal_none_skips_rbac_and_legacy_signature_still_works() -> None:
    registry = make_registry()
    assert registry.execute("get_briefing", {})["ok"]
    assert registry.execute("get_briefing", {}, None, "voice")["ok"]


def test_permission_checked_for_principals() -> None:
    registry = make_registry()
    leadership = make_principal("leadership")  # no proposal:create
    with pytest.raises(ToolPermissionError, match="proposal:create"):
        registry.execute(
            "draft_action",
            {"action_type": "INCIDENT", "store_id": 1, "reason": "x"},
            leadership,
        )
    assert registry.execute("get_briefing", {}, leadership)["ok"]


def test_surface_is_enforced_even_without_a_principal() -> None:
    registry = make_registry()
    with pytest.raises(ToolPermissionError, match="voice surface"):
        registry.execute("run_readonly_sql", {"sql": "SELECT 1 FROM gold_x"}, None, "voice")


def test_store_scope_and_city_scope() -> None:
    registry = make_registry()
    own = make_principal("store_manager", stores=(1,))
    assert registry.execute("get_metric", {"metric": "orders", "store_id": 1}, own)["ok"]
    with pytest.raises(ToolPermissionError, match="store 2"):
        registry.execute("get_metric", {"metric": "orders", "store_id": 2}, own)
    city = make_principal("city_manager", cities=("Bengaluru",))
    assert registry.execute("get_metric", {"metric": "orders", "store_id": 2}, city)["ok"]
    elsewhere = make_principal("city_manager", cities=("Mumbai",))
    with pytest.raises(ToolPermissionError):
        registry.execute("get_metric", {"metric": "orders", "store_id": 2}, elsewhere)
    no_scope = make_principal("business_exec")
    object.__setattr__(no_scope, "scopes", [])
    with pytest.raises(ToolPermissionError, match="no data scope"):
        registry.execute("get_metric", {"metric": "orders"}, no_scope)


def test_store_drilling_needs_drill_store_permission() -> None:
    registry = make_registry()
    limited = make_principal("business_exec").model_copy(
        update={"permissions": frozenset({"kpi:read"})}
    )
    assert registry.execute("get_metric", {"metric": "orders"}, limited)["ok"]
    with pytest.raises(ToolPermissionError, match="drill:store"):
        registry.execute("get_metric", {"metric": "orders", "store_id": 1}, limited)


def test_error_types_distinguish_unknown_and_bad_arguments() -> None:
    registry = make_registry()
    with pytest.raises(UnknownToolError):
        registry.execute("nope", {})
    with pytest.raises(ToolArgumentError):
        registry.execute("get_metric", {"metric": ""})
    with pytest.raises(ToolError):  # both are still ToolError for the old graph
        registry.execute("get_metric", {"store_id": 0})


def test_cache_key_includes_principal_scope() -> None:
    reset_tool_cache()
    registry = make_registry()
    company = make_principal("business_exec")
    store_two = make_principal("store_manager", stores=(2,))
    first = registry.execute("compare_stores", {"metric": "on_time_rate"}, company)
    again = registry.execute("compare_stores", {"metric": "on_time_rate"}, company)
    assert first["cache_hit"] is False and again["cache_hit"] is True
    scoped = registry.execute("compare_stores", {"metric": "on_time_rate"}, store_two)
    assert scoped["cache_hit"] is False
    assert len(scoped["facts"]["stores:on_time_rate"]["rows"]) == 1
    assert len(again["facts"]["stores:on_time_rate"]["rows"]) == 2


def test_audit_sink_sees_allowed_denied_and_proposals() -> None:
    events: list[dict] = []
    base = make_registry()
    registry = ToolRegistry(
        {n: base.get(n) for n in base.names},  # type: ignore[misc]
        audit=events.append,
        store_city_lookup=base.store_city_lookup,
    )
    registry.execute("get_briefing", {}, make_principal("business_exec"))
    with pytest.raises(ToolPermissionError):
        registry.execute(
            "draft_action",
            {"action_type": "INCIDENT", "store_id": 1, "reason": "x"},
            make_principal("leadership"),
        )
    registry.execute(
        "draft_action",
        {"action_type": "INCIDENT", "store_id": 1, "reason": "x"},
        make_principal("ops_manager"),
    )
    assert [(e["tool"], e["outcome"]) for e in events] == [
        ("get_briefing", "ok"),
        ("draft_action", "denied"),
        ("draft_action", "ok"),
    ]
    assert events[2]["risk"] == "propose" and events[2]["user_id"] == 7


def test_tool_context_is_visible_inside_a_call_only() -> None:
    seen = {}

    def func(args):
        seen["ctx"] = current_tool_context()
        return {"ok": True, "summary": "s"}

    from pydantic import BaseModel

    class NoArgs(BaseModel):
        pass

    registry = ToolRegistry({"probe": ToolSpec("probe", "d", NoArgs, func)})
    principal = make_principal("business_exec")
    registry.execute("probe", {}, principal, "voice")
    assert seen["ctx"].principal == principal and seen["ctx"].channel == "voice"
    assert current_tool_context().principal is None


def test_existing_tools_carry_permissions_and_sql_is_text_only() -> None:
    registry = build_registry(
        __import__("quickcart.agents.tools", fromlist=["ToolDeps"]).ToolDeps()
    )
    sql = registry.get("run_readonly_sql")
    assert sql.permission == "copilot:sql_tool" and sql.surfaces == frozenset({"text"})
    proposal = registry.get("create_restock_proposal")
    assert proposal.risk == "propose" and proposal.permission == "proposal:create"


# --------------------------------------------------------------------------- #
# Streaming helpers
# --------------------------------------------------------------------------- #


def test_summary_streamer_decodes_escapes_across_chunk_boundaries() -> None:
    payload = json.dumps({"summary": 'Say "hi"\nnow é', "cards": []})
    streamer = SummaryStreamer()
    out = "".join(streamer.feed(payload[i : i + 3]) for i in range(0, len(payload), 3))
    assert out == 'Say "hi"\nnow é' and streamer.done


def test_sentence_gate_releases_only_verified_rendered_sentences() -> None:
    from quickcart.agents.cards import EvidenceStore, Fact

    store = EvidenceStore()
    store.add(Fact(ref="m", display="₹2.50 L", value=250000))
    gate = SentenceGate(store)
    out = gate.push("Sales are {{m}}. Revenue is 999 now. Ok")
    out += gate.push(" fine.")
    out += gate.flush()
    assert "".join(out) == "Sales are ₹2.50 L. Ok fine."


# --------------------------------------------------------------------------- #
# NativeToolLoop
# --------------------------------------------------------------------------- #

ANSWER = {
    "summary": "Sales are {{metric:sales_gmv:all}}, {{metric:sales_gmv:all|delta}} on last week.",
    "cards": [{"type": "kpi", "ref": "metric:sales_gmv:all"}],
    "followups": ["Why did it change?"],
}


def _loop(steps: list[ModelStep], **kw) -> tuple[NativeToolLoop, ScriptedToolLLM]:
    llm = ScriptedToolLLM(steps, **kw)
    return NativeToolLoop(llm, make_registry()), llm


def test_loop_tool_then_answer_streams_cards_and_followups_in_order() -> None:
    loop, llm = _loop([call("get_metric", metric="sales_gmv"), ModelStep(text=json.dumps(ANSWER))])
    events = list(loop.run("How are sales?", principal=make_principal("business_exec")))
    names = [e for e, _ in events]
    assert names[0] == "status" and names.index("tool") < names.index("token")
    assert names.index("token") < names.index("card") < names.index("followups")
    assert names[-1] == "done" and names.index("followups") < len(names) - 1
    tokens = "".join(d["text"] for e, d in events if e == "token")
    done = events[-1][1]
    assert tokens == done["answer"] == "Sales are ₹2.50 L, +25.0% on last week."
    assert done["cards"][0]["type"] == "kpi" and done["followups"] == ["Why did it change?"]
    assert done["provenance"]["stray_numbers"] == [] and done["degraded"] is False
    assert done["tool_trace"][0]["tool"] == "get_metric"
    # the model saw only declarations for tools its principal may call
    declared = {d["name"] for d in llm.calls[0]["tools"]}
    assert "get_metric" in declared and "run_readonly_sql" not in declared
    # the second model call carried the tool response (display strings only, with refs)
    tool_turn = llm.calls[1]["turns"][-1]
    assert tool_turn.role == "tool"
    assert tool_turn.tool_responses[0].response["facts"][0]["ref"] == "metric:sales_gmv:all"


def test_loop_without_streaming_text_still_emits_tokens_before_card() -> None:
    loop, _ = _loop([ModelStep(text=json.dumps({"summary": "Nothing to report.", "cards": []}))])
    events = list(loop.run("hello"))
    names = [e for e, _ in events]
    assert "token" in names and names[-1] == "done"


def test_loop_repairs_stray_numbers_with_one_extra_model_call() -> None:
    bad = {
        "summary": "Sales hit 777 today.",
        "cards": [{"type": "kpi", "ref": "metric:sales_gmv:all"}],
    }
    loop, llm = _loop(
        [
            call("get_metric", metric="sales_gmv"),
            ModelStep(text=json.dumps(bad)),
            ModelStep(text=json.dumps(ANSWER)),
        ]
    )
    done = list(loop.run("How are sales?"))[-1][1]
    assert len(llm.calls) == 3
    assert done["answer"] == "Sales are ₹2.50 L, +25.0% on last week."
    assert "777" in llm.calls[2]["turns"][-1].text


def test_loop_unrepairable_answer_degrades_to_cards_only() -> None:
    bad = {
        "summary": "Sales hit 777 today.",
        "cards": [{"type": "kpi", "ref": "metric:sales_gmv:all"}],
    }
    loop, _ = _loop(
        [
            call("get_metric", metric="sales_gmv"),
            ModelStep(text=json.dumps(bad)),
            ModelStep(text=json.dumps(bad)),
        ]
    )
    done = list(loop.run("How are sales?"))[-1][1]
    assert done["provenance"]["cards_only"] is True and len(done["cards"]) == 1
    assert "777" not in done["answer"]


def test_loop_caps_steps_then_forces_a_final_answer_without_tools() -> None:
    steps = [call("get_briefing") for _ in range(5)] + [
        ModelStep(text=json.dumps({"summary": "Done."}))
    ]
    llm = ScriptedToolLLM(steps)
    loop = NativeToolLoop(llm, make_registry(), max_steps=5)
    events = list(loop.run("loop forever"))
    assert len(llm.calls) == 6 and llm.calls[-1]["tools"] is None
    assert [e for e, _ in events].count("tool") == 5
    assert events[-1][1]["answer"] == "Done."


def test_loop_tool_errors_and_denials_are_reported_not_swallowed() -> None:
    loop, llm = _loop(
        [
            ModelStep(
                tool_calls=[
                    ToolCall("compare_stores", {"metric": "on_time_rate"}),
                    ToolCall("ghost", {}),
                ]
            ),
            ModelStep(text=json.dumps({"summary": "One lookup failed."})),
        ]
    )
    events = list(loop.run("compare", principal=make_principal("business_exec")))
    tools = [d for e, d in events if e == "tool"]
    assert [t["ok"] for t in tools] == [True, False] and "unknown tool" in tools[1]["summary"]
    response = llm.calls[1]["turns"][-1].tool_responses[1].response
    assert "error" in response
    denied_loop, _ = _loop(
        [
            call("draft_action", action_type="INCIDENT", store_id=1, reason="x"),
            ModelStep(text=json.dumps({"summary": "You cannot create proposals."})),
        ]
    )
    denied = [
        d
        for e, d in denied_loop.run("do it", principal=make_principal("leadership"))
        if e == "tool"
    ]
    assert denied[0]["ok"] is False and denied[0]["summary"].startswith("not allowed")


def test_loop_tool_crash_is_loud_but_does_not_kill_the_turn() -> None:
    from pydantic import BaseModel

    def boom(args):
        raise RuntimeError("kaput")

    class NoArgs(BaseModel):
        pass

    registry = ToolRegistry({"boom": ToolSpec("boom", "d", NoArgs, boom)})
    llm = ScriptedToolLLM([call("boom"), ModelStep(text=json.dumps({"summary": "It failed."}))])
    events = list(NativeToolLoop(llm, registry).run("x"))
    tool = next(d for e, d in events if e == "tool")
    assert tool["ok"] is False and "unexpectedly" in tool["summary"]
    assert events[-1][1]["answer"] == "It failed."


def test_loop_legacy_tools_make_their_evidence_citable() -> None:
    from pydantic import BaseModel

    def legacy(args):
        return {"ok": True, "summary": "kpis", "evidence": {"type": "metric", "gmv": 1234.5}}

    class NoArgs(BaseModel):
        pass

    registry = ToolRegistry({"get_kpi_summary": ToolSpec("get_kpi_summary", "d", NoArgs, legacy)})
    good = {"summary": "GMV is 1234.5 today."}
    loop = NativeToolLoop(
        ScriptedToolLLM([call("get_kpi_summary"), ModelStep(text=json.dumps(good))]), registry
    )
    done = list(loop.run("kpis"))[-1][1]
    assert (
        done["answer"] == "GMV is 1234.5 today."
        and done["evidence"][0]["tool"] == "get_kpi_summary"
    )


def test_loop_plain_text_reply_is_verified_as_a_summary() -> None:
    reply = ModelStep(text="Sales are 31337. Fine overall.")
    loop, _ = _loop([call("get_metric", metric="sales_gmv"), reply, reply])
    done = list(loop.run("sales?"))[-1][1]
    assert done["answer"] == "Fine overall." and done["provenance"]["repaired"]


def test_loop_default_cards_fill_in_when_model_sends_none() -> None:
    loop, _ = _loop(
        [
            call("get_metric", metric="sales_gmv"),
            ModelStep(text=json.dumps({"summary": "{{metric:sales_gmv:all}}"})),
        ]
    )
    done = list(loop.run("sales?"))[-1][1]
    assert [c["type"] for c in done["cards"]] == ["kpi"] and done["followups"]


def test_loop_llm_failure_yields_error_then_degraded_done() -> None:
    from quickcart.agents.llm import LLMError

    class Broken:
        model = "broken"

        def stream_step(self, *a, **k):
            raise LLMError("quota")
            yield  # pragma: no cover

    events = list(NativeToolLoop(Broken(), make_registry()).run("x"))  # type: ignore[arg-type]
    assert [e for e, _ in events][-2:] == ["error", "done"]
    assert events[-1][1]["degraded"] is True


def test_loop_persists_a_trace(tmp_path) -> None:
    llm = ScriptedToolLLM(
        [call("get_metric", metric="sales_gmv"), ModelStep(text=json.dumps(ANSWER))]
    )
    loop = NativeToolLoop(llm, make_registry(), artifacts_dir=tmp_path)
    done = list(loop.run("sales?"))[-1][1]
    trace = json.loads((tmp_path / f"{done['request_id']}.json").read_text())
    assert trace["mode"] == "native" and "metric:sales_gmv:all" in trace["facts"]


# --------------------------------------------------------------------------- #
# Service: SSE strategy selection
# --------------------------------------------------------------------------- #


def test_chat_sse_uses_native_loop_when_available(monkeypatch) -> None:
    llm = ScriptedToolLLM(
        [call("get_metric", metric="sales_gmv"), ModelStep(text=json.dumps(ANSWER))]
    )
    monkeypatch.setattr(service, "_native_loop", lambda: NativeToolLoop(llm, make_registry()))
    events = _parse_sse(list(service.chat_sse("How are sales?", principal=make_principal())))
    names = [n for n, _ in events]
    assert {"status", "tool", "token", "card", "followups", "done"} <= set(names)
    assert names.index("card") < names.index("done") and names[-1] == "done"
    assert events[-1][1]["mode"] == "native"
    sync = service.chat("How are sales?", principal=make_principal())
    llm2 = ScriptedToolLLM(
        [call("get_metric", metric="sales_gmv"), ModelStep(text=json.dumps(ANSWER))]
    )
    monkeypatch.setattr(service, "_native_loop", lambda: NativeToolLoop(llm2, make_registry()))
    assert service.chat("How are sales?")["cards"][0]["type"] == "kpi"
    assert sync["degraded"] is True  # the first loop's script was exhausted: loud, not silent


def test_chat_sse_native_failure_ends_with_degraded_done(monkeypatch) -> None:
    class Exploding:
        model = "m"

        def run(self, *a, **k):
            raise RuntimeError("boom")
            yield  # pragma: no cover

    monkeypatch.setattr(service, "_native_loop", lambda: Exploding())
    names = [n for n, _ in _parse_sse(list(service.chat_sse("x")))]
    assert names == ["error", "done"]


def test_planned_pipeline_is_used_without_a_native_loop(monkeypatch, tmp_path) -> None:
    from quickcart.agents.graph import build_graph
    from tests.unit.agents.fakes import FakeLLM, build_fake_registry

    graph = build_graph(FakeLLM(), build_fake_registry(), artifacts_dir=tmp_path)
    monkeypatch.setattr(service, "_runtime", lambda: (graph, FakeLLM()))
    names = [n for n, _ in _parse_sse(list(service.chat_sse("How is Store 8 performing?")))]
    assert names[0] == "status" and names[-1] == "done" and "card" not in names


# --------------------------------------------------------------------------- #
# Eval set
# --------------------------------------------------------------------------- #


def test_eval_set_is_well_formed() -> None:
    cases = load_cases()
    assert len(cases) >= 15
    registry = make_registry()
    known = set(registry.names)
    assert any(c.expect.refusal for c in cases) and any(c.expect.tools for c in cases)
    for case in cases:
        assert case.question and case.persona
        assert set(case.expect.tools) <= known, case.id
        assert set(case.expect.forbidden_tools) <= known, case.id


def test_eval_set_passes_offline_with_the_keyword_model() -> None:
    proposals = FakeProposals()
    loop = NativeToolLoop(KeywordToolLLM(), make_registry(proposals))
    report = run_suite(loop)
    failures = [c for c in report["cases"] if not c["pass"]]
    assert not failures, failures
    assert report["passed"] == len(load_cases())
    assert len(proposals.created) == 1  # only the restock draft created anything


def test_hydrate_is_what_the_loop_uses_for_numbers() -> None:
    result = make_registry().execute("get_metric", {"metric": "orders"})
    env = hydrate_answer({"summary": "{{metric:orders:all}} orders."}, result["facts"])
    assert env.summary == "600 orders."


def test_business_deps_store_city_lookup() -> None:
    deps = make_business_deps()
    assert deps.store_city(1) == "Bengaluru" and deps.store_city(99) is None
