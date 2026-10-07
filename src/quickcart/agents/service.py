"""API-facing agent service (kit/03 Phase 13, consumed by `quickcart.api.app`).

`chat(message, session_id=None)` is the exact contract the FastAPI layer
calls. Graph, registry, retriever, and LLM are built lazily and cached; tests
reset the caches with `reset_runtime`. Genuine infrastructure failures
(Spark/Qdrant/Ollama/PostgreSQL down) are logged loudly and surfaced as a
degraded-but-honest answer — never a silent empty success (kit/05 §4.2).
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import structlog

from quickcart.agents.loop import DEGRADED_ANSWER, NativeToolLoop
from quickcart.config.settings import get_settings
from quickcart.identity.models import Principal

logger = structlog.get_logger(__name__)


@lru_cache(maxsize=1)
def _spark() -> Any:
    from quickcart.lakehouse.common.spark import build_spark

    return build_spark("quickcart-agent")


@lru_cache(maxsize=1)
def _readers() -> Any:
    from quickcart.lakehouse.readers import GoldReaders

    return GoldReaders(_spark(), get_settings().data_root)


@lru_cache(maxsize=1)
def _retriever() -> Any:
    from quickcart.rag.retrieve import Retriever

    return Retriever()


@lru_cache(maxsize=1)
def _proposal_service() -> Any:
    from quickcart.api.proposals import ProposalService

    return ProposalService(actor="agent")


@lru_cache(maxsize=1)
def _business_deps() -> Any:
    from quickcart.agents.business_tools import BusinessDeps, connect_business_service

    return BusinessDeps(
        open_service=connect_business_service(), proposal_service=_proposal_service()
    )


class _Lazy:
    """Resolve a heavy backend (Spark, Qdrant embeddings) only when a tool uses it.

    Business tools and the assistant endpoint must work without a JVM; the Gold/RAG
    tools pay the start-up cost on first real use instead of at registry build.
    """

    def __init__(self, factory: Any) -> None:
        object.__setattr__(self, "_factory", factory)

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_factory")(), name)


def _artifacts_dir() -> Path:
    return get_settings().data_root / "artifacts" / "agent_traces"


@lru_cache(maxsize=1)
def get_registry() -> Any:
    """Tool registry for the native loop and `/api/v1/assistant/tools` (lazy heavy deps)."""
    from quickcart.agents.tools import ToolDeps, build_registry

    deps = ToolDeps(
        readers=_Lazy(_readers),
        retriever=_Lazy(_retriever),
        proposal_service=_proposal_service(),
        business=_business_deps(),
        spark=_Lazy(_spark),
        data_root=get_settings().data_root,
    )
    return build_registry(deps)


@lru_cache(maxsize=1)
def _native_loop() -> NativeToolLoop | None:
    """The native tool loop when a Gemini key is configured, else ``None`` (planned)."""
    from quickcart.agents.gemini_tools import select_tool_llm

    llm = select_tool_llm()
    if llm is None:
        return None
    return NativeToolLoop(llm, get_registry(), artifacts_dir=_artifacts_dir())


def _build_runtime() -> tuple[Any, Any]:
    """(compiled graph, llm) — separated so tests can rebuild with a FakeLLM."""
    from quickcart.agents.graph import build_graph
    from quickcart.agents.llm import select_agent_llm
    from quickcart.agents.tools import ToolDeps, build_registry

    deps = ToolDeps(
        readers=_readers(),
        retriever=_retriever(),
        proposal_service=_proposal_service(),
        business=_business_deps(),
        spark=_spark(),
        data_root=get_settings().data_root,
    )
    llm = select_agent_llm()
    graph = build_graph(llm, build_registry(deps), artifacts_dir=_artifacts_dir())
    return graph, llm


@lru_cache(maxsize=1)
def _runtime() -> tuple[Any, Any]:
    return _build_runtime()


def reset_runtime() -> None:
    """Drop every cached backend (tests inject fakes via monkeypatching deps)."""
    from quickcart.agents.tools import reset_tool_cache

    for cached in (
        _spark,
        _readers,
        _retriever,
        _proposal_service,
        _runtime,
        _business_deps,
        get_registry,
        _native_loop,
    ):
        cached.cache_clear()
    reset_tool_cache()


def warmup_agent_runtime() -> None:
    """Best-effort LLM construct + Gold/RAG warm so the first chat is not cold."""
    from quickcart.agents.llm import select_agent_llm

    try:
        select_agent_llm()
    except Exception as exc:
        logger.warning("agent.warmup_llm_skipped", error=str(exc))
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    try:
        _readers()
    except Exception as exc:
        logger.warning("agent.warmup_readers_skipped", error=str(exc))
    try:
        _retriever()
    except Exception as exc:
        logger.warning("agent.warmup_retriever_skipped", error=str(exc))


def _llm_model_name(llm: Any) -> str | None:
    return getattr(llm, "model", None)


def _result_payload(final: dict[str, Any], *, degraded: bool, model: str | None) -> dict[str, Any]:
    return {
        "answer": final.get("answer", ""),
        "evidence": final.get("evidence", []),
        "tool_trace": final.get("tool_trace", []),
        "request_id": final.get("request_id"),
        "trace_path": final.get("trace_path"),
        "degraded": degraded,
        "model": model,
        "handled_at": datetime.now(UTC).isoformat(),
        "intent": final.get("intent"),
    }


def _run_native(
    loop: NativeToolLoop, message: str, session_id: str | None, principal: Principal | None
) -> dict[str, Any]:
    """Drive the native loop to completion and return its ``done`` payload."""
    done: dict[str, Any] | None = None
    try:
        for event, data in loop.run(message, session_id=session_id, principal=principal):
            if event == "done":
                done = data
    except Exception as exc:
        logger.exception("agent.chat.native_failure", error=str(exc))
    if done is None:
        return {
            "answer": DEGRADED_ANSWER,
            "evidence": [],
            "tool_trace": [],
            "request_id": None,
            "trace_path": None,
            "degraded": True,
            "model": loop.model,
        }
    return done


def chat(
    message: str, session_id: str | None = None, principal: Principal | None = None
) -> dict[str, Any]:
    """Run one request through the agent (the FastAPI contract).

    With a Gemini key the native tool loop answers (cards + followups included);
    otherwise the planned LangGraph pipeline does. Returns {"answer", "evidence",
    "tool_trace"}; adds "request_id" and "trace_path" for observability. Only
    genuine infrastructure failure lands in the degraded shape — tool-level
    failures stay inside the trace.
    """
    from quickcart.agents.graph import initial_state

    native = _native_loop()
    if native is not None:
        return _run_native(native, message, session_id, principal)
    graph, llm = _runtime()
    model = _llm_model_name(llm)
    state = initial_state(message, session_id)
    state["principal"] = principal
    logger.info("agent.chat.start", session_id=session_id, message=message[:200])
    try:
        final = graph.invoke(state, config={"recursion_limit": 60})
    except Exception as exc:
        # Infrastructure failure (LLM transport, Spark, …): loud + degraded.
        logger.exception("agent.chat.infrastructure_failure", error=str(exc))
        return {
            "answer": DEGRADED_ANSWER,
            "evidence": [],
            "tool_trace": [],
            "request_id": state.get("request_id"),
            "trace_path": None,
            "degraded": True,
            "model": model,
        }
    errors = final.get("errors", [])
    if errors:
        logger.warning("agent.chat.completed_with_errors", errors=errors)
    logger.info(
        "agent.chat.done",
        intent=final.get("intent"),
        steps=final.get("step_count"),
        trace_path=final.get("trace_path"),
        model=model,
    )
    return _result_payload(final, degraded=False, model=model)


_NODE_STAGE = {
    "classify": "classifying",
    "plan": "planning",
    "tools": "tools",
    "action": "action",
    "answer": "answer",
}


def _sse_bytes(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n".encode()


def _chunk_answer(text: str, size: int = 48) -> list[str]:
    if not text:
        return []
    return [text[i : i + size] for i in range(0, len(text), size)]


def _native_sse(
    loop: NativeToolLoop, message: str, session_id: str | None, principal: Principal | None
) -> Iterator[bytes]:
    logger.info("agent.chat.stream_start", mode="native", session_id=session_id)
    done_sent = False
    try:
        for event, data in loop.run(message, session_id=session_id, principal=principal):
            done_sent = done_sent or event == "done"
            yield _sse_bytes(event, data)
    except Exception as exc:
        logger.exception("agent.chat.native_stream_failure", error=str(exc))
        yield _sse_bytes(
            "error",
            {"detail": str(exc), "answer": DEGRADED_ANSWER, "degraded": True, "model": loop.model},
        )
        if not done_sent:
            yield _sse_bytes(
                "done",
                {
                    "answer": DEGRADED_ANSWER,
                    "evidence": [],
                    "tool_trace": [],
                    "request_id": None,
                    "degraded": True,
                    "model": loop.model,
                },
            )


def _proposal_card_frames(proposal: dict[str, Any]) -> Iterator[bytes]:
    from quickcart.agents.cards import ProposalCard, proposal_fact_from_row

    fact = proposal_fact_from_row(proposal)
    card = ProposalCard(
        ref=fact.ref,
        title=fact.label,
        status=str(fact.data.get("status", "PENDING")),
        detail=fact.display,
        proposal_id=fact.data.get("proposal_id"),
        proposal_type=fact.data.get("proposal_type"),
    )
    yield _sse_bytes("card", card.model_dump(mode="json"))


def chat_sse(
    message: str, session_id: str | None = None, principal: Principal | None = None
) -> Iterator[bytes]:
    """Yield SSE frames for a live agent turn.

    Events: ``status | tool | token | card | followups | error | done`` (``card`` and
    ``followups`` are new; clients that ignore unknown events keep working). The
    native loop streams for real; the planned pipeline replays its finished answer.
    """
    from quickcart.agents.graph import initial_state

    native = _native_loop()
    if native is not None:
        yield from _native_sse(native, message, session_id, principal)
        return
    graph, llm = _runtime()
    model = _llm_model_name(llm)
    state = initial_state(message, session_id)
    state["principal"] = principal
    logger.info("agent.chat.stream_start", session_id=session_id, message=message[:200])
    yield _sse_bytes("status", {"stage": "classifying", "model": model})
    accumulated: dict[str, Any] = dict(state)
    seen_tools = 0
    try:
        for update in graph.stream(state, config={"recursion_limit": 60}, stream_mode="updates"):
            if not isinstance(update, dict):
                continue
            for node, delta in update.items():
                if isinstance(delta, dict):
                    accumulated.update(delta)
                stage = _NODE_STAGE.get(str(node))
                if stage:
                    yield _sse_bytes("status", {"stage": stage, "model": model})
                if node == "tools":
                    trace = accumulated.get("tool_trace") or []
                    for entry in trace[seen_tools:]:
                        yield _sse_bytes(
                            "tool",
                            {
                                "name": entry.get("tool"),
                                "ok": not str(entry.get("result_summary", "")).startswith("ERROR"),
                                "cache_hit": bool(entry.get("cache_hit")),
                                "summary": entry.get("result_summary", ""),
                            },
                        )
                    seen_tools = len(trace)
                if node == "answer":
                    answer = str(accumulated.get("answer") or "")
                    for chunk in _chunk_answer(answer):
                        yield _sse_bytes("token", {"text": chunk})
                    proposal = accumulated.get("proposal")
                    if isinstance(proposal, dict) and proposal.get("proposal_id") is not None:
                        yield from _proposal_card_frames(proposal)
    except Exception as exc:
        logger.exception("agent.chat.stream_infrastructure_failure", error=str(exc))
        yield _sse_bytes(
            "error",
            {"detail": str(exc), "answer": DEGRADED_ANSWER, "degraded": True, "model": model},
        )
        yield _sse_bytes(
            "done",
            {
                "answer": DEGRADED_ANSWER,
                "evidence": [],
                "tool_trace": [],
                "request_id": accumulated.get("request_id") or state.get("request_id"),
                "degraded": True,
                "model": model,
            },
        )
        return
    payload = _result_payload(accumulated, degraded=False, model=model)
    yield _sse_bytes("done", payload)
