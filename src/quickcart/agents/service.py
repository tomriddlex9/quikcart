"""API-facing agent service (kit/03 Phase 13, consumed by `quickcart.api.app`).

`chat(message, session_id=None)` is the exact contract the FastAPI layer
calls. Graph, registry, retriever, and LLM are built lazily and cached; tests
reset the caches with `reset_runtime`. Genuine infrastructure failures
(Spark/Qdrant/Ollama/PostgreSQL down) are logged loudly and surfaced as a
degraded-but-honest answer — never a silent empty success (kit/05 §4.2).
"""

from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import structlog

from quickcart.config.settings import get_settings

logger = structlog.get_logger(__name__)

DEGRADED_ANSWER = (
    "The operations assistant is temporarily unavailable (infrastructure "
    "error); no evidence was retrieved, so nothing is reported. Please retry "
    "shortly or check the service logs."
)


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


def _artifacts_dir() -> Path:
    return get_settings().data_root / "artifacts" / "agent_traces"


def _build_runtime() -> tuple[Any, Any]:
    """(compiled graph, llm) — separated so tests can rebuild with a FakeLLM."""
    from quickcart.agents.graph import build_graph
    from quickcart.agents.llm import OllamaLLM
    from quickcart.agents.tools import ToolDeps, build_registry

    deps = ToolDeps(
        readers=_readers(),
        retriever=_retriever(),
        proposal_service=_proposal_service(),
        spark=_spark(),
        data_root=get_settings().data_root,
    )
    llm = OllamaLLM()
    graph = build_graph(llm, build_registry(deps), artifacts_dir=_artifacts_dir())
    return graph, llm


@lru_cache(maxsize=1)
def _runtime() -> tuple[Any, Any]:
    return _build_runtime()


def reset_runtime() -> None:
    """Drop every cached backend (tests inject fakes via monkeypatching deps)."""
    for cached in (_spark, _readers, _retriever, _proposal_service, _runtime):
        cached.cache_clear()


def chat(message: str, session_id: str | None = None) -> dict[str, Any]:
    """Run one request through the agent graph (the FastAPI contract).

    Returns {"answer", "evidence", "tool_trace"}; adds "request_id" and
    "trace_path" for observability. Only genuine infrastructure failure lands
    in the degraded shape — tool-level failures stay inside the trace.
    """
    from quickcart.agents.graph import initial_state

    graph, _ = _runtime()
    state = initial_state(message, session_id)
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
        }
    errors = final.get("errors", [])
    if errors:
        logger.warning("agent.chat.completed_with_errors", errors=errors)
    logger.info(
        "agent.chat.done",
        intent=final.get("intent"),
        steps=final.get("step_count"),
        trace_path=final.get("trace_path"),
    )
    return {
        "answer": final.get("answer", ""),
        "evidence": final.get("evidence", []),
        "tool_trace": final.get("tool_trace", []),
        "request_id": final.get("request_id"),
        "trace_path": final.get("trace_path"),
        "degraded": False,
        "handled_at": datetime.now(UTC).isoformat(),
    }
