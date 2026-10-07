"""Assistant v2 HTTP surface (Phase B4): ``/api/v1/assistant/*``.

``POST /api/v1/assistant/tools/{name}`` runs one bounded agent tool for a caller
that owns the model loop itself — the browser's Gemini Live session (B5) posts
function calls here with the user cookie, so RBAC, data scope, surface limits
and audit apply exactly as they do for the text assistant.

Auth: a valid session is required when ``auth_enforce`` is on; otherwise an
anonymous caller is the synthetic admin (same as the rest of the API).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import structlog
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field

from quickcart.agents.cards import AnswerDraft, hydrate_answer
from quickcart.agents.tools import (
    ToolArgumentError,
    ToolError,
    ToolPermissionError,
    ToolRegistry,
    UnknownToolError,
)
from quickcart.api.deps import require_permission
from quickcart.identity.models import Principal

log = structlog.get_logger(__name__)

# Gemini Live function-response scheduling: tell the user about a created proposal
# right away; let read results wait for a natural pause.
SCHEDULING_BY_RISK: dict[str, str] = {"read": "WHEN_IDLE", "propose": "INTERRUPT"}

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class ToolCallRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
    channel: Literal["text", "voice"] = "text"


class ToolCallResponse(BaseModel):
    ok: bool = True
    tool: str
    model_view: dict[str, Any]
    card: dict[str, Any] | None = None
    scheduling: str = "WHEN_IDLE"
    cache_hit: bool = False


def get_assistant_registry(request: Request) -> ToolRegistry:
    """Injected on ``app.state.assistant_registry`` in tests; the service registry otherwise."""
    injected = getattr(request.app.state, "assistant_registry", None)
    if injected is not None:
        return injected
    from quickcart.agents import service

    return service.get_registry()


RegistryDep = Annotated[ToolRegistry, Depends(get_assistant_registry)]
principal_dependency = require_permission()  # tests override this exact callable
PrincipalDep = Annotated[Principal, Depends(principal_dependency)]


def _first_card(result: dict[str, Any]) -> dict[str, Any] | None:
    """Hydrate the tool's default card from its own facts (never from model text)."""
    facts, drafts = result.get("facts"), result.get("card_drafts")
    if not facts or not drafts:
        return None
    envelope = hydrate_answer(AnswerDraft(summary="", cards=drafts[:1]), facts)
    return envelope.cards[0].model_dump(mode="json") if envelope.cards else None


def _model_view(result: dict[str, Any]) -> dict[str, Any]:
    view = result.get("model_view")
    if isinstance(view, dict):
        return view
    return {"summary": result.get("summary", ""), "evidence": result.get("evidence")}


@router.get("/tools")
def list_tools(
    registry: RegistryDep,
    principal: PrincipalDep,
    channel: Annotated[Literal["text", "voice"], Query()] = "text",
) -> dict[str, Any]:
    """Function declarations the caller may use on ``channel`` (permission-filtered)."""
    return {"channel": channel, "tools": registry.declarations(channel, principal)}


@router.post("/tools/{name}")
def call_tool(
    name: str, body: ToolCallRequest, registry: RegistryDep, principal: PrincipalDep
) -> ToolCallResponse:
    try:
        result = registry.execute(name, body.args, principal, body.channel)
    except UnknownToolError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ToolArgumentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ToolPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ToolError as exc:
        log.warning("assistant.tool_failed", tool=name, error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    spec = registry.get(name)
    risk = spec.risk if spec is not None else "read"
    return ToolCallResponse(
        tool=name,
        model_view=_model_view(result),
        card=_first_card(result),
        scheduling=SCHEDULING_BY_RISK.get(risk, "WHEN_IDLE"),
        cache_hit=bool(result.get("cache_hit")),
    )


def register_assistant_routes(app: FastAPI) -> None:
    app.include_router(router)
