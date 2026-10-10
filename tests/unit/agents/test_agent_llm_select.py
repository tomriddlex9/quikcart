"""Agent LLM selection — Grok by default, then Gemini, then Ollama. No network."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from quickcart.agents.llm import GeminiLLM, GrokLLM, select_agent_llm

pytestmark = pytest.mark.unit


def _settings(**overrides: object) -> SimpleNamespace:
    base = dict(
        gemini_api_key="",
        gemini_model="gemini-3.8-flash",
        gemini_base_url="https://generativelanguage.googleapis.com/v1beta",
        xai_api_key="",
        xai_model="grok-3-mini",
        xai_base_url="https://api.x.ai/v1",
        ollama_model="qwen2.5:1.5b",
        ollama_base_url="http://127.0.0.1:11434",
        assistant_provider="grok",
        assistant_require_cloud=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_select_agent_llm_prefers_grok(monkeypatch) -> None:
    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: _settings(xai_api_key="xk", xai_model="grok-test", gemini_api_key="gk"),
    )
    llm = select_agent_llm()
    assert isinstance(llm, GrokLLM)
    assert llm.model == "grok-test"


def test_select_agent_llm_gemini_when_provider_gemini(monkeypatch) -> None:
    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: _settings(
            assistant_provider="gemini",
            gemini_api_key="gk",
            gemini_model="gemini-test",
            xai_api_key="xk",
        ),
    )
    llm = select_agent_llm()
    assert isinstance(llm, GeminiLLM)
    assert llm.model == "gemini-test"


def test_select_agent_llm_auto_prefers_grok(monkeypatch) -> None:
    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: _settings(
            assistant_provider="auto",
            xai_api_key="xk",
            xai_model="grok-test",
            gemini_api_key="gk",
        ),
    )
    llm = select_agent_llm()
    assert isinstance(llm, GrokLLM)


def test_select_agent_llm_falls_back_to_ollama(monkeypatch) -> None:
    class _FakeOllama:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.model = "qwen-fake"

        def chat(self, *args: object, **kwargs: object) -> str:
            return "{}"

    monkeypatch.setattr("quickcart.agents.llm.get_settings", lambda: _settings())
    monkeypatch.setattr("quickcart.agents.llm.OllamaLLM", _FakeOllama)
    llm = select_agent_llm()
    assert isinstance(llm, _FakeOllama)


def test_select_agent_llm_refuses_ollama_when_cloud_required(monkeypatch) -> None:
    from quickcart.agents.llm import LLMError

    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: _settings(assistant_require_cloud=True),
    )
    with pytest.raises(LLMError, match="Cloud LLM required"):
        select_agent_llm()
