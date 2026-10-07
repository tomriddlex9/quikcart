"""Voice HTTP surface (Phase B5): ``/api/v1/voice/*``.

``POST /api/v1/voice/session`` mints a single-use, locked Gemini Live token for the
signed-in caller. The browser then talks to Gemini directly (audio never touches this
server) and executes tool calls through ``/api/v1/assistant/tools/{name}`` with the
user's cookie, so RBAC, data scope and audit stay server-side.

Permission: ``copilot:voice`` (see ``quickcart.identity.catalog``). The endpoint is
503 when voice is disabled or no ``GEMINI_API_KEY`` is configured.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from quickcart.agents.tools import ToolRegistry
from quickcart.api.assistant import get_assistant_registry
from quickcart.api.deps import require_permission
from quickcart.config.settings import Settings, get_settings
from quickcart.identity.models import Principal
from quickcart.voice.tokens import (
    GeminiTokenMinter,
    TokenMinter,
    VoiceMintError,
    VoiceTokenRequest,
)

log = structlog.get_logger(__name__)

VOICE_PERMISSION = "copilot:voice"

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


class VoiceStatus(BaseModel):
    enabled: bool
    max_session_seconds: int


class VoiceSessionResponse(BaseModel):
    token: str
    model: str
    expires_at: datetime
    ws_url: str
    voice_session_id: str
    max_session_seconds: int


def get_voice_settings(request: Request) -> Settings:
    """``app.state.voice_settings`` when injected (tests); process settings otherwise."""
    injected = getattr(request.app.state, "voice_settings", None)
    return injected if injected is not None else get_settings()


def get_token_minter(request: Request, settings: Settings) -> TokenMinter:
    """Injected minter in tests; the Gemini-backed one otherwise."""
    injected = getattr(request.app.state, "voice_token_minter", None)
    if injected is not None:
        return injected
    return GeminiTokenMinter(settings.gemini_api_key)


def _voice_available(settings: Settings) -> bool:
    return bool(settings.voice_enabled and settings.gemini_api_key.strip())


principal_dependency = require_permission(VOICE_PERMISSION)  # tests override this callable
PrincipalDep = Annotated[Principal, Depends(principal_dependency)]
SettingsDep = Annotated[Settings, Depends(get_voice_settings)]
RegistryDep = Annotated[ToolRegistry, Depends(get_assistant_registry)]


@router.get("/status")
def voice_status(_principal: PrincipalDep, settings: SettingsDep) -> VoiceStatus:
    """Lets the console hide the voice dock (403 = no permission, ``enabled`` false = off)."""
    return VoiceStatus(
        enabled=_voice_available(settings), max_session_seconds=settings.voice_max_session_seconds
    )


@router.post("/session")
def create_voice_session(
    request: Request,
    principal: PrincipalDep,
    settings: SettingsDep,
    registry: RegistryDep,
) -> VoiceSessionResponse:
    if not settings.voice_enabled:
        raise HTTPException(status_code=503, detail="voice is not enabled")
    if not settings.gemini_api_key.strip():
        raise HTTPException(
            status_code=503, detail="voice is unavailable: GEMINI_API_KEY is not set"
        )

    minter = get_token_minter(request, settings)
    tools: list[dict[str, Any]] = registry.declarations("voice", principal)
    spec = VoiceTokenRequest(
        model=settings.gemini_live_model,
        voice=settings.gemini_live_voice,
        tools=tools,
        ttl_seconds=settings.voice_token_ttl_seconds,
        max_session_seconds=settings.voice_max_session_seconds,
    )
    try:
        minted = minter.mint(spec)
    except VoiceMintError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    voice_session_id = uuid.uuid4().hex
    log.info(
        "voice.session_minted",
        voice_session_id=voice_session_id,
        user_id=principal.user_id,
        persona=principal.persona,
        model=spec.model,
        tools=len(tools),
    )
    return VoiceSessionResponse(
        token=minted.token,
        model=spec.model,
        expires_at=minted.expires_at,
        ws_url=minted.ws_url,
        voice_session_id=voice_session_id,
        max_session_seconds=settings.voice_max_session_seconds,
    )


def register_voice_routes(app: FastAPI) -> None:
    app.include_router(router)
