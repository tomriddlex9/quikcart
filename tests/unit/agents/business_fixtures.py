"""Shared offline fixtures for the Assistant v2 tests: stub read model, fake proposals,
a scripted tool-calling LLM. No network, no PostgreSQL, no Spark."""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

from quickcart.agents.business_tools import BusinessDeps
from quickcart.agents.gemini_tools import ModelStep, StepChunk, ToolCall, Turn
from quickcart.agents.tools import ToolDeps, ToolRegistry, build_registry
from quickcart.api.business.service import BusinessService
from quickcart.identity.catalog import permissions_for_roles
from quickcart.identity.models import COMPANY_SCOPE_VALUE, Principal, Scope
from tests.unit.api.test_business_routes import StubReadModel

NOW = datetime(2026, 9, 22, 13, 0, tzinfo=UTC)


class FakeProposals:
    def __init__(self) -> None:
        self.created: list[Any] = []

    def create(self, body: Any) -> dict[str, Any]:
        self.created.append(body)
        return {
            "proposal_id": 41 + len(self.created),
            "proposal_type": body.proposal_type,
            "status": "PENDING",
            "entity_scope": body.entity_scope,
            "reason": body.reason,
            "recommended_action": body.recommended_action,
        }


def make_business_deps(proposals: FakeProposals | None = None) -> BusinessDeps:
    @contextlib.contextmanager
    def opener() -> Iterator[BusinessService]:
        yield BusinessService(StubReadModel(), now=NOW)

    return BusinessDeps(open_service=opener, proposal_service=proposals or FakeProposals())


def make_registry(proposals: FakeProposals | None = None) -> ToolRegistry:
    return build_registry(ToolDeps(business=make_business_deps(proposals)))


def make_principal(
    role: str = "business_exec",
    *,
    stores: tuple[int, ...] = (),
    cities: tuple[str, ...] = (),
    user_id: int = 7,
) -> Principal:
    scopes = [Scope(scope_type="store", scope_value=str(s)) for s in stores]
    scopes += [Scope(scope_type="city", scope_value=c) for c in cities]
    if not scopes:
        scopes = [Scope(scope_type="company", scope_value=COMPANY_SCOPE_VALUE)]
    return Principal(
        user_id=user_id,
        email=f"{role}@test.local",
        display_name=role,
        roles=[role],
        permissions=permissions_for_roles([role]),
        scopes=scopes,
    )


class ScriptedToolLLM:
    """Replays prepared `ModelStep`s; records what the loop sent."""

    model = "scripted-model"

    def __init__(self, steps: list[ModelStep], *, stream_text: bool = True) -> None:
        self._steps = list(steps)
        self._stream_text = stream_text
        self.calls: list[dict[str, Any]] = []

    def _next(self, turns: list[Turn], tools: Any, schema: Any) -> ModelStep:
        self.calls.append({"turns": list(turns), "tools": tools, "schema": schema})
        if not self._steps:
            raise AssertionError("ScriptedToolLLM ran out of steps")
        return self._steps.pop(0)

    def generate(self, turns, *, system, tools=None, response_schema=None, max_tokens=None):
        return self._next(turns, tools, response_schema)

    def stream_step(
        self, turns, *, system, tools=None, response_schema=None, max_tokens=None
    ) -> Iterator[StepChunk]:
        step = self._next(turns, tools, response_schema)
        if step.text and self._stream_text:
            for i in range(0, len(step.text), 7):
                yield StepChunk(text_delta=step.text[i : i + 7])
        yield StepChunk(step=step)


def call(name: str, **args: Any) -> ModelStep:
    return ModelStep(tool_calls=[ToolCall(name, args)])
