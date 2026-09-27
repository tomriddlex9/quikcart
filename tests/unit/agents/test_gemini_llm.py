"""Unit tests for ``GeminiLLM`` — no real Google network calls."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest

from quickcart.agents.llm import GeminiLLM, LLMError

pytestmark = pytest.mark.unit


class _FakeHttpResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _FakeHttpResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def test_gemini_llm_raises_when_api_key_missing() -> None:
    with pytest.raises(LLMError, match="GEMINI_API_KEY"):
        GeminiLLM(api_key="")


def test_gemini_llm_chat_parses_generate_content() -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(request: Any, timeout: float | None = None) -> _FakeHttpResponse:
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeHttpResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": '{"sql": "SELECT 1 LIMIT 10"}'}],
                        }
                    }
                ]
            }
        )

    llm = GeminiLLM(
        model="gemini-test",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        api_key="test-key",
        urlopen=fake_urlopen,
    )
    reply = llm.chat(
        [
            {"role": "system", "content": "You write SQL."},
            {"role": "user", "content": "count orders"},
        ],
        json_mode=True,
        max_tokens=512,
    )

    assert reply == '{"sql": "SELECT 1 LIMIT 10"}'
    assert llm.model == "gemini-test"
    parsed = urlparse(captured["url"])
    assert parsed.path.endswith("/models/gemini-test:generateContent")
    assert parse_qs(parsed.query)["key"] == ["test-key"]
    assert captured["body"]["systemInstruction"]["parts"][0]["text"] == "You write SQL."
    assert captured["body"]["contents"][0]["role"] == "user"
    assert captured["body"]["generationConfig"]["temperature"] == 0
    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 512
    assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"


def test_gemini_llm_raises_on_empty_content() -> None:
    def fake_urlopen(_request: Any, timeout: float | None = None) -> _FakeHttpResponse:
        return _FakeHttpResponse(
            {"candidates": [{"content": {"parts": [{"text": "   "}]}}]}
        )

    llm = GeminiLLM(api_key="test-key", urlopen=fake_urlopen)
    with pytest.raises(LLMError, match="empty reply"):
        llm.chat([{"role": "user", "content": "hi"}])
