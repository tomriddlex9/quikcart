"""Shared test doubles for the agent unit tests.

The doubles themselves live in `quickcart.agents.eval_suite` (the evaluation
harness must run offline too, so the fakes are production code, not test-only
fixtures); this module re-exports them and adds graph-running helpers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quickcart.agents.eval_suite import (  # noqa: F401
    FakeLLM,
    FakeProposalService,
    FakeRetriever,
    build_fake_registry,
    make_fake_sql_runner,
)
from quickcart.agents.graph import build_graph, initial_state


def run_graph(
    question: str,
    *,
    registry,
    llm: FakeLLM | None = None,
    artifacts_dir: Path | None = None,
) -> dict[str, Any]:
    """Compile a graph over `registry` and run one question through it."""
    import tempfile

    artifacts = artifacts_dir or Path(tempfile.mkdtemp(prefix="agent-traces-"))
    graph = build_graph(llm or FakeLLM(), registry, artifacts_dir=artifacts)
    return graph.invoke(initial_state(question), config={"recursion_limit": 60})


def called_tools(state: dict[str, Any]) -> list[str]:
    return [step["tool"] for step in state.get("tool_trace", [])]
