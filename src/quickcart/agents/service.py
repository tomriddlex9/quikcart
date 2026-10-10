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
    """(compiled graph, llm) — separated so tests can rebuild with a FakeLLM.

    Spark/Gold/Qdrant stay lazy so Grok chat can answer via business tools
    without waiting on a JVM cold start.
    """
    from quickcart.agents.graph import build_graph
    from quickcart.agents.llm import select_agent_llm
    from quickcart.agents.tools import ToolDeps, build_registry

    deps = ToolDeps(
        readers=_Lazy(_readers),
        retriever=_Lazy(_retriever),
        proposal_service=_proposal_service(),
        business=_business_deps(),
        spark=_Lazy(_spark),
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


def warmup_agent_runtime(*, heavy: bool = False) -> None:
    """Best-effort LLM (+ optional Gold/RAG) warm so the first chat is not cold.

    ``heavy=False`` (default) only builds the LLM / native loop / registry —
    safe for Grok-only local demos. Spark/Qdrant warm is opt-in via ``heavy``.
    """
    from quickcart.agents.gemini_tools import select_tool_llm
    from quickcart.agents.llm import select_agent_llm

    try:
        select_agent_llm()
    except Exception as exc:
        logger.warning("agent.warmup_llm_skipped", error=str(exc))
    try:
        select_tool_llm()
        _native_loop()
    except Exception as exc:
        logger.warning("agent.warmup_native_skipped", error=str(exc))
    try:
        get_registry()
    except Exception as exc:
        logger.warning("agent.warmup_registry_skipped", error=str(exc))
    if os.environ.get("PYTEST_CURRENT_TEST") or not heavy:
        return
    try:
        _readers()
    except Exception as exc:
        logger.warning("agent.warmup_readers_skipped", error=str(exc))
    try:
        _retriever()
    except Exception as exc:
        logger.warning("agent.warmup_retriever_skipped", error=str(exc))


def agent_ready() -> dict[str, Any]:
    """Lightweight readiness for the floating dock warmup ping."""
    from quickcart.agents.llm import cloud_llm_configured, select_agent_llm

    settings = get_settings()
    native = _native_loop()
    cloud = cloud_llm_configured(settings)
    model: str | None = native.model if native is not None else None
    if model is None and cloud:
        try:
            model = getattr(select_agent_llm(), "model", None)
        except Exception:
            model = settings.xai_model if settings.xai_api_key else settings.gemini_model or None
    return {
        "ready": native is not None or cloud,
        "mode": "native" if native is not None else ("cloud" if cloud else "local"),
        "model": model,
        "voice_enabled": bool(
            settings.voice_enabled
            and (settings.gemini_api_key.strip() or settings.xai_api_key.strip())
        ),
        "voice_mode": (
            "gemini_live"
            if settings.voice_enabled and settings.gemini_api_key.strip()
            else (
                "grok_browser"
                if settings.voice_enabled and settings.xai_api_key.strip()
                else "off"
            )
        ),
        "require_cloud": bool(settings.assistant_require_cloud or cloud),
        "provider": str(getattr(settings, "assistant_provider", "grok")),
    }


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
    loop: NativeToolLoop,
    message: str,
    session_id: str | None,
    principal: Principal | None,
    history: list[Any] | None = None,
) -> dict[str, Any]:
    """Drive the native loop to completion and return its ``done`` payload."""
    done: dict[str, Any] | None = None
    try:
        for event, data in loop.run(
            message, session_id=session_id, principal=principal, history=history
        ):
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


def _normalize_history(history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in history or []:
        role = str(item.get("role", "")).strip()
        text = str(item.get("text", "")).strip()
        if role in {"user", "assistant"} and text:
            out.append({"role": role, "text": text[:4000]})
    return out[-20:]


def _normalize_memories(memories: dict[str, list[str]] | None) -> dict[str, list[str]]:
    mem = memories or {}
    local = [str(x).strip()[:280] for x in (mem.get("local") or []) if str(x).strip()][:20]
    global_m = [str(x).strip()[:280] for x in (mem.get("global") or []) if str(x).strip()][:20]
    return {"local": local, "global": global_m}


def chat(
    message: str,
    session_id: str | None = None,
    principal: Principal | None = None,
    bot_id: str | None = None,
    history: list[dict[str, str]] | None = None,
    memories: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Run one request through the agent (the FastAPI contract).

    With a Gemini key the native tool loop answers (cards + followups included);
    otherwise the planned LangGraph pipeline does. Returns {"answer", "evidence",
    "tool_trace"}; adds "request_id" and "trace_path" for observability. Only
    genuine infrastructure failure lands in the degraded shape — tool-level
    failures stay inside the trace.
    """
    from quickcart.agents.gemini_tools import Turn
    from quickcart.agents.graph import initial_state

    hist = _normalize_history(history)
    mem = _normalize_memories(memories)
    native = _native_loop()
    if native is not None:
        # Native loop uses model/user/tool roles; map assistant → model.
        native_history = [
            Turn("model" if t["role"] == "assistant" else "user", t["text"]) for t in hist
        ]
        from quickcart.agents.bot_personality import memory_context_block

        ctx = memory_context_block(hist, mem)
        msg = f"{ctx}\n\nCurrent user request:\n{message}" if ctx else message
        return _run_native(native, msg, session_id, principal, history=native_history)
    graph, llm = _runtime()
    model = _llm_model_name(llm)
    state = initial_state(
        message, session_id, bot_id=bot_id, history=hist, memories=mem
    )
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


def _is_cloud_fallback_error(detail: str) -> bool:
    lowered = detail.lower()
    markers = ("quota", "429", "401", "403", "resource_exhausted", "permission", "api key")
    return any(m in lowered for m in markers)


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


def _status_frame(
    stage: str,
    *,
    model: str | None,
    bot_id: str | None = None,
    reasoning: str | None = None,
) -> bytes:
    from quickcart.agents.bot_personality import stage_detail

    payload: dict[str, Any] = {
        "stage": stage,
        "model": model,
        "detail": stage_detail(stage, bot_id=bot_id, extra=reasoning),
    }
    if reasoning:
        payload["reasoning"] = reasoning
    if bot_id:
        payload["bot_id"] = bot_id
    return _sse_bytes("status", payload)


def _planned_sse(
    message: str,
    session_id: str | None,
    principal: Principal | None,
    bot_id: str | None = None,
    history: list[dict[str, str]] | None = None,
    memories: dict[str, list[str]] | None = None,
) -> Iterator[bytes]:
    """LangGraph path (Grok / Ollama) — progressive status + chunked answer."""
    from quickcart.agents.graph import initial_state
    from quickcart.agents.llm import LLMError, cloud_llm_configured

    hist = _normalize_history(history)
    mem = _normalize_memories(memories)
    settings = get_settings()
    if settings.assistant_require_cloud and not cloud_llm_configured(settings):
        detail = "Configure XAI_API_KEY (or GEMINI_API_KEY) to use the assistant."
        yield _status_frame("listening", model=None, bot_id=bot_id)
        yield _sse_bytes("error", {"detail": detail, "answer": detail, "degraded": True})
        yield _sse_bytes(
            "done",
            {
                "answer": detail,
                "evidence": [],
                "tool_trace": [],
                "request_id": None,
                "degraded": True,
                "model": None,
            },
        )
        return

    try:
        graph, llm = _runtime()
    except LLMError as exc:
        detail = str(exc)
        yield _status_frame("listening", model=None, bot_id=bot_id)
        yield _sse_bytes("error", {"detail": detail, "answer": detail, "degraded": True})
        yield _sse_bytes(
            "done",
            {
                "answer": detail,
                "evidence": [],
                "tool_trace": [],
                "request_id": None,
                "degraded": True,
                "model": None,
            },
        )
        return

    model = _llm_model_name(llm)
    state = initial_state(
        message, session_id, bot_id=bot_id, history=hist, memories=mem
    )
    state["principal"] = principal
    logger.info(
        "agent.chat.stream_start", mode="planned", session_id=session_id, bot_id=bot_id
    )
    yield _status_frame("listening", model=model, bot_id=bot_id)
    yield _status_frame("classifying", model=model, bot_id=bot_id)
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
                reasoning: str | None = None
                if node == "classify":
                    reasoning = str(accumulated.get("intent_reasoning") or "") or None
                    intent = accumulated.get("intent")
                    if intent:
                        reasoning = (
                            f"intent={intent}"
                            + (f" — {reasoning}" if reasoning else "")
                        )
                elif node == "plan":
                    plan = accumulated.get("plan") or []
                    if plan:
                        names = ", ".join(
                            str(s.get("tool")) for s in plan if isinstance(s, dict)
                        )
                        reasoning = f"will call {names}" if names else "no tools needed"
                if stage:
                    yield _status_frame(
                        stage, model=model, bot_id=bot_id, reasoning=reasoning
                    )
                if node == "tools":
                    trace = accumulated.get("tool_trace") or []
                    for entry in trace[seen_tools:]:
                        yield _sse_bytes(
                            "tool",
                            {
                                "name": entry.get("tool"),
                                "ok": not str(entry.get("result_summary", "")).startswith(
                                    "ERROR"
                                ),
                                "cache_hit": bool(entry.get("cache_hit")),
                                "summary": entry.get("result_summary", ""),
                            },
                        )
                        yield _status_frame(
                            "tools",
                            model=model,
                            bot_id=bot_id,
                            reasoning=f"{entry.get('tool')}: {entry.get('result_summary', '')}",
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


def chat_sse(
    message: str,
    session_id: str | None = None,
    principal: Principal | None = None,
    bot_id: str | None = None,
    history: list[dict[str, str]] | None = None,
    memories: dict[str, list[str]] | None = None,
) -> Iterator[bytes]:
    """Yield SSE frames for a live agent turn.

    Events: ``status | tool | token | card | followups | error | done`` (``card`` and
    ``followups`` are new; clients that ignore unknown events keep working). The
    native loop streams for real; the planned pipeline replays its finished answer.
    Immediate ``listening`` status lets the UI animate before any tool work.
    """
    hist = _normalize_history(history)
    mem = _normalize_memories(memories)
    native = _native_loop()
    if native is not None:
        from quickcart.agents.bot_personality import memory_context_block
        from quickcart.agents.gemini_tools import Turn

        native_history = [
            Turn("model" if t["role"] == "assistant" else "user", t["text"]) for t in hist
        ]
        ctx = memory_context_block(hist, mem)
        msg = f"{ctx}\n\nCurrent user request:\n{message}" if ctx else message
        yield _status_frame("listening", model=native.model, bot_id=bot_id)
        fallback = False
        try:
            for event, data in native.run(
                msg, session_id=session_id, principal=principal, history=native_history
            ):
                if (
                    event == "error"
                    and get_settings().xai_api_key
                    and _is_cloud_fallback_error(str(data.get("detail", "")))
                ):
                    logger.warning(
                        "agent.chat.gemini_fallback_grok",
                        detail=str(data.get("detail", ""))[:200],
                    )
                    fallback = True
                    break
                if event == "status" and isinstance(data, dict):
                    yield _status_frame(
                        str(data.get("stage", "planning")),
                        model=data.get("model") or native.model,
                        bot_id=bot_id,
                        reasoning=str(data.get("detail") or "") or None,
                    )
                else:
                    yield _sse_bytes(event, data)
                if event == "done":
                    return
        except Exception as exc:
            logger.exception("agent.chat.native_stream_failure", error=str(exc))
            if get_settings().xai_api_key and _is_cloud_fallback_error(str(exc)):
                fallback = True
            else:
                yield _sse_bytes(
                    "error",
                    {
                        "detail": str(exc),
                        "answer": DEGRADED_ANSWER,
                        "degraded": True,
                        "model": native.model,
                    },
                )
                yield _sse_bytes(
                    "done",
                    {
                        "answer": DEGRADED_ANSWER,
                        "evidence": [],
                        "tool_trace": [],
                        "request_id": None,
                        "degraded": True,
                        "model": native.model,
                    },
                )
                return
        if fallback:
            yield from _grok_fallback_sse(message, session_id, principal)
            return
        return
    yield from _planned_sse(
        message,
        session_id,
        principal,
        bot_id=bot_id,
        history=hist,
        memories=mem,
    )


def _grok_fallback_sse(
    message: str, session_id: str | None, principal: Principal | None
) -> Iterator[bytes]:
    """Short progressive Grok completion when Gemini quota/auth fails mid-stream."""
    from quickcart.agents.llm import GrokLLM, LLMError

    settings = get_settings()
    try:
        llm = GrokLLM(
            model=settings.xai_model,
            base_url=settings.xai_base_url,
            api_key=settings.xai_api_key,
        )
    except LLMError as exc:
        yield _sse_bytes("error", {"detail": str(exc), "degraded": True})
        yield _sse_bytes(
            "done",
            {
                "answer": DEGRADED_ANSWER,
                "evidence": [],
                "tool_trace": [],
                "request_id": None,
                "degraded": True,
                "model": None,
            },
        )
        return
    model = llm.model
    yield _sse_bytes("status", {"stage": "planning", "model": model})
    yield _sse_bytes("status", {"stage": "answer", "model": model})
    try:
        answer = llm.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You are QuickCart Assistant. Answer briefly in plain English. "
                        "You have no live tools in this fallback turn — say what you would "
                        "check when data is unavailable rather than inventing figures."
                    ),
                },
                {"role": "user", "content": message},
            ],
            max_tokens=400,
        )
    except LLMError as exc:
        yield _sse_bytes("error", {"detail": str(exc), "degraded": True, "model": model})
        yield _sse_bytes(
            "done",
            {
                "answer": DEGRADED_ANSWER,
                "evidence": [],
                "tool_trace": [],
                "request_id": None,
                "degraded": True,
                "model": model,
            },
        )
        return
    for chunk in _chunk_answer(answer):
        yield _sse_bytes("token", {"text": chunk})
    yield _sse_bytes(
        "done",
        {
            "answer": answer,
            "evidence": [],
            "tool_trace": [],
            "request_id": None,
            "degraded": False,
            "model": model,
            "mode": "grok_fallback",
        },
    )
