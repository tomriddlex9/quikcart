"""POST /api/v1/voice/session: gating, RBAC, locked tool list, minter failure handling."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.voice import principal_dependency, register_voice_routes
from quickcart.config.settings import Settings
from quickcart.voice.tokens import FakeTokenMinter, VoiceTokenRequest, build_live_config
from tests.unit.agents.business_fixtures import make_principal, make_registry

pytestmark = pytest.mark.unit


def _settings(**overrides) -> Settings:
    base = {"voice_enabled": True, "gemini_api_key": "test-key", "_env_file": None}
    return Settings(**{**base, **overrides})


def _client(settings: Settings, minter=None, principal=None) -> tuple[TestClient, FakeTokenMinter]:
    minter = minter or FakeTokenMinter()
    app = FastAPI()
    app.state.voice_settings = settings
    app.state.voice_token_minter = minter
    app.state.assistant_registry = make_registry()
    register_voice_routes(app)
    if principal is not None:
        app.dependency_overrides[principal_dependency] = lambda: principal
    return TestClient(app), minter


def test_session_returns_token_model_and_locked_voice_tools() -> None:
    client, minter = _client(_settings(), principal=make_principal("business_exec"))
    response = client.post("/api/v1/voice/session")
    assert response.status_code == 200
    data = response.json()
    assert data["token"] == "auth_tokens/fake-token"
    assert data["model"] == "gemini-3.8-live"
    assert data["ws_url"].startswith("wss://")
    assert "BidiGenerateContentConstrained" in data["ws_url"]
    assert len(data["voice_session_id"]) == 32 and data["expires_at"]
    assert data["max_session_seconds"] == 600
    request = minter.requests[0]
    names = {t["name"] for t in request.tools}
    assert "get_metric" in names and "run_readonly_sql" not in names
    assert request.voice == "Aoede" and request.max_session_seconds == 600


def test_session_ids_are_unique() -> None:
    client, _ = _client(_settings())
    ids = {client.post("/api/v1/voice/session").json()["voice_session_id"] for _ in range(3)}
    assert len(ids) == 3


def test_503_when_voice_disabled_or_key_missing() -> None:
    off, minter = _client(_settings(voice_enabled=False))
    assert off.post("/api/v1/voice/session").status_code == 503
    no_key, _ = _client(_settings(gemini_api_key=""))
    response = no_key.post("/api/v1/voice/session")
    assert response.status_code == 503 and "GEMINI_API_KEY" in response.json()["detail"]
    assert minter.requests == []


def test_status_reports_enabled_only_with_flag_and_key() -> None:
    def enabled(**overrides) -> bool:
        return _client(_settings(**overrides))[0].get("/api/v1/voice/status").json()["enabled"]

    assert enabled() is True
    assert enabled(voice_enabled=False) is False
    assert enabled(gemini_api_key="") is False


def test_permission_is_enforced_for_real_principals() -> None:
    # No override: the real dependency resolves an anonymous caller to the synthetic admin
    # (auth not enforced), so it passes; a real principal without copilot:voice must not.
    client, _ = _client(_settings())
    assert client.post("/api/v1/voice/session").status_code == 200

    from fastapi import HTTPException

    def deny() -> None:
        raise HTTPException(status_code=403, detail="missing permission: copilot:voice")

    app = FastAPI()
    app.state.voice_settings = _settings()
    app.state.voice_token_minter = FakeTokenMinter()
    app.state.assistant_registry = make_registry()
    register_voice_routes(app)
    app.dependency_overrides[principal_dependency] = deny
    denied = TestClient(app).post("/api/v1/voice/session")
    assert denied.status_code == 403 and "copilot:voice" in denied.json()["detail"]


def test_copilot_voice_is_a_known_permission_held_by_business_roles() -> None:
    from quickcart.identity.catalog import PERMISSIONS

    assert "copilot:voice" in PERMISSIONS
    assert "copilot:voice" in make_principal("business_exec").permissions


def test_minter_failure_is_a_503() -> None:
    client, _ = _client(_settings(), minter=FakeTokenMinter(fail_with="quota exceeded"))
    response = client.post("/api/v1/voice/session")
    assert response.status_code == 503 and "quota exceeded" in response.json()["detail"]


def test_live_config_locks_audio_transcription_resumption_compression_and_tools() -> None:
    tools = make_registry().declarations("voice", make_principal("business_exec"))
    config = build_live_config(
        VoiceTokenRequest(
            model="gemini-3.8-live",
            voice="Aoede",
            tools=tools,
            ttl_seconds=60,
            max_session_seconds=600,
        )
    )
    assert [m.value for m in config.response_modalities] == ["AUDIO"]
    assert config.speech_config.voice_config.prebuilt_voice_config.voice_name == "Aoede"
    assert config.input_audio_transcription is not None
    assert config.output_audio_transcription is not None
    assert config.session_resumption is not None
    assert config.context_window_compression.sliding_window is not None
    declared = {d.name for d in config.tools[0].function_declarations}
    assert declared == {t["name"] for t in tools} and "run_readonly_sql" not in declared


def test_gemini_minter_requests_single_use_locked_token() -> None:
    from types import SimpleNamespace

    from quickcart.voice.tokens import GeminiTokenMinter

    captured = {}

    class _Tokens:
        def create(self, *, config):
            captured["config"] = config
            return SimpleNamespace(name="auth_tokens/abc")

    minter = GeminiTokenMinter("k", client=SimpleNamespace(auth_tokens=_Tokens()))
    minted = minter.mint(
        VoiceTokenRequest(
            model="gemini-3.8-live",
            voice="Aoede",
            tools=[],
            ttl_seconds=60,
            max_session_seconds=600,
        )
    )
    config = captured["config"]
    assert minted.token == "auth_tokens/abc"
    assert config.uses == 1
    assert config.live_connect_constraints.model == "gemini-3.8-live"
    assert config.expire_time > config.new_session_expire_time
