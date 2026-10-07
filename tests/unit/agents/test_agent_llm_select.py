"""Agent LLM selection — Gemini, then Grok, then Ollama. No network."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from quickcart.agents.llm import GeminiLLM, GrokLLM, select_agent_llm

pytestmark = pytest.mark.unit


def test_select_agent_llm_prefers_gemini(monkeypatch) -> None:
    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: SimpleNamespace(
            gemini_api_key="gk",
            gemini_model="gemini-test",
            gemini_base_url="https://generativelanguage.googleapis.com/v1beta",
            xai_api_key="xk",
            xai_model="grok-test",
            xai_base_url="https://api.x.ai/v1",
            ollama_model="qwen2.5:1.5b",
            ollama_base_url="http://127.0.0.1:11434",
        ),
    )
    llm = select_agent_llm()
    assert isinstance(llm, GeminiLLM)
    assert llm.model == "gemini-test"


def test_select_agent_llm_uses_grok_without_gemini(monkeypatch) -> None:
    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: SimpleNamespace(
            gemini_api_key="",
            gemini_model="gemini-3.8-flash",
            gemini_base_url="https://generativelanguage.googleapis.com/v1beta",
            xai_api_key="xk",
            xai_model="grok-test",
            xai_base_url="https://api.x.ai/v1",
            ollama_model="qwen2.5:1.5b",
            ollama_base_url="http://127.0.0.1:11434",
        ),
    )
    llm = select_agent_llm()
    assert isinstance(llm, GrokLLM)
    assert llm.model == "grok-test"


def test_select_agent_llm_falls_back_to_ollama(monkeypatch) -> None:
    class _FakeOllama:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.model = "qwen-fake"

        def chat(self, *args: object, **kwargs: object) -> str:
            return "{}"

    monkeypatch.setattr(
        "quickcart.agents.llm.get_settings",
        lambda: SimpleNamespace(
            gemini_api_key="",
            gemini_model="gemini-3.8-flash",
            gemini_base_url="https://generativelanguage.googleapis.com/v1beta",
            xai_api_key="",
            xai_model="grok-3-mini",
            xai_base_url="https://api.x.ai/v1",
            ollama_model="qwen2.5:1.5b",
            ollama_base_url="http://127.0.0.1:11434",
        ),
    )
    monkeypatch.setattr("quickcart.agents.llm.OllamaLLM", _FakeOllama)
    llm = select_agent_llm()
    assert isinstance(llm, _FakeOllama)
