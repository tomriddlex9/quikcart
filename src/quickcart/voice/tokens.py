"""Ephemeral Gemini Live tokens (Phase B5).

The browser opens the Live WebSocket itself, but never sees the long-lived API key:
the server mints a **single-use** ephemeral token whose Live configuration is *locked*
(model, audio-only responses, transcription, resumption, compression, system
instruction and the voice-surface tool declarations for this principal). The client can
therefore not widen its own tool list or change the model; tool *execution* still goes
through ``POST /api/v1/assistant/tools/{name}`` with the user's cookie.

``TokenMinter`` is the seam: ``GeminiTokenMinter`` calls ``google-genai``;
``FakeTokenMinter`` is the offline double for tests.
"""

from __future__ import annotations

import warnings
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import structlog

from quickcart.voice.prompts import VOICE_SYSTEM_PROMPT

log = structlog.get_logger(__name__)

LIVE_API_VERSION = "v1alpha"
LIVE_WS_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    f"google.ai.generativelanguage.{LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained"
)
# Server-side compression keeps long sessions inside the context window.
CONTEXT_TRIGGER_TOKENS = 25_600
CONTEXT_TARGET_TOKENS = 12_800


class VoiceMintError(RuntimeError):
    """Token minting failed (provider error or misconfiguration)."""


@dataclass(frozen=True)
class VoiceTokenRequest:
    """Everything the minter locks into the token."""

    model: str
    voice: str
    tools: Sequence[dict[str, Any]]  # Gemini function declarations (already principal-filtered)
    ttl_seconds: int  # window in which the token may *start* its session
    max_session_seconds: int  # hard cap on the session once started
    system_instruction: str = VOICE_SYSTEM_PROMPT


@dataclass(frozen=True)
class MintedToken:
    token: str
    expires_at: datetime  # when the token (and any session on it) is dead
    ws_url: str = LIVE_WS_URL


class TokenMinter(Protocol):
    def mint(self, request: VoiceTokenRequest, *, now: datetime | None = None) -> MintedToken: ...


def _expiry(request: VoiceTokenRequest, now: datetime) -> tuple[datetime, datetime]:
    """(``expire_time``, ``new_session_expire_time``) — both UTC."""
    start_by = now + timedelta(seconds=request.ttl_seconds)
    return start_by + timedelta(seconds=request.max_session_seconds), start_by


def build_live_config(request: VoiceTokenRequest) -> Any:
    """The locked ``LiveConnectConfig`` (imported lazily: the SDK is an optional extra)."""
    from google.genai import types

    declarations = [types.FunctionDeclaration.model_validate(d) for d in request.tools]
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=request.voice)
            )
        ),
        system_instruction=request.system_instruction,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=types.SessionResumptionConfig(),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=CONTEXT_TRIGGER_TOKENS,
            sliding_window=types.SlidingWindow(target_tokens=CONTEXT_TARGET_TOKENS),
        ),
        tools=[types.Tool(function_declarations=declarations)] if declarations else None,
    )


class GeminiTokenMinter:
    """``client.auth_tokens.create`` with ``uses=1`` and locked Live constraints."""

    def __init__(self, api_key: str, *, client: Any | None = None) -> None:
        if not api_key.strip() and client is None:
            raise VoiceMintError("gemini_api_key is not configured (env GEMINI_API_KEY)")
        self._api_key = api_key.strip()
        self._client = client

    def _sdk_client(self) -> Any:
        if self._client is None:
            from google import genai
            from google.genai import types

            self._client = genai.Client(
                api_key=self._api_key,
                http_options=types.HttpOptions(api_version=LIVE_API_VERSION),
            )
        return self._client

    def mint(self, request: VoiceTokenRequest, *, now: datetime | None = None) -> MintedToken:
        from google.genai import errors, types

        issued = now or datetime.now(UTC)
        expire_time, new_session_expire_time = _expiry(request, issued)
        try:
            config = types.CreateAuthTokenConfig(
                uses=1,
                expire_time=expire_time,
                new_session_expire_time=new_session_expire_time,
                live_connect_constraints=types.LiveConnectConstraints(
                    model=request.model, config=build_live_config(request)
                ),
            )
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", errors.ExperimentalWarning)
                created = self._sdk_client().auth_tokens.create(config=config)
        except Exception as exc:  # provider/network/validation: surfaced as a 503 by the API
            log.error("voice.mint_failed", error=str(exc), error_type=type(exc).__name__)
            raise VoiceMintError(f"could not mint a voice token: {exc}") from exc
        name = getattr(created, "name", None)
        if not name:
            raise VoiceMintError("provider returned no token")
        return MintedToken(token=name, expires_at=expire_time)


@dataclass
class FakeTokenMinter:
    """Offline double: records requests, returns a deterministic token (or fails)."""

    token: str = "auth_tokens/fake-token"
    fail_with: str | None = None
    requests: list[VoiceTokenRequest] = field(default_factory=list)

    def mint(self, request: VoiceTokenRequest, *, now: datetime | None = None) -> MintedToken:
        self.requests.append(request)
        if self.fail_with:
            raise VoiceMintError(self.fail_with)
        expire_time, _ = _expiry(request, now or datetime.now(UTC))
        return MintedToken(token=self.token, expires_at=expire_time)
