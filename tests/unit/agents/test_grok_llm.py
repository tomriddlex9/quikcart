"""Unit tests for ``GrokLLM`` — no real xAI network calls."""

from __future__ import annotations

import json
from typing import Any

import pytest

from quickcart.agents.llm import GrokLLM, LLMError

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


def test_grok_llm_raises_when_api_key_missing() -> None:
    with pytest.raises(LLMError, match="XAI_API_KEY"):
        GrokLLM(api_key="")


def test_grok_llm_chat_parses_completion_content() -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(request: Any, timeout: float | None = None) -> _FakeHttpResponse:
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["body"] = json.loads(request.data.decode("utf-8"))
        auth = request.get_header("Authorization")
        assert auth == "Bearer test-key"
        return _FakeHttpResponse(
            {
                "choices": [
                    {"message": {"content": '{"sql": "SELECT 1 LIMIT 10"}'}},
                ],
            }
        )

    llm = GrokLLM(
        model="grok-test",
        base_url="https://api.x.ai/v1",
        api_key="test-key",
        urlopen=fake_urlopen,
    )
    reply = llm.chat(
        [{"role": "user", "content": "count orders"}],
        json_mode=True,
        max_tokens=512,
    )

    assert reply == '{"sql": "SELECT 1 LIMIT 10"}'
    assert llm.model == "grok-test"
    assert captured["url"] == "https://api.x.ai/v1/chat/completions"
    assert captured["body"]["model"] == "grok-test"
    assert captured["body"]["temperature"] == 0
    assert captured["body"]["response_format"] == {"type": "json_object"}
    assert captured["body"]["max_tokens"] == 512


def test_grok_llm_raises_on_empty_content() -> None:
    def fake_urlopen(_request: Any, timeout: float | None = None) -> _FakeHttpResponse:
        return _FakeHttpResponse({"choices": [{"message": {"content": "   "}}]})

    llm = GrokLLM(api_key="test-key", urlopen=fake_urlopen)
    with pytest.raises(LLMError, match="empty reply"):
        llm.chat([{"role": "user", "content": "hi"}])
