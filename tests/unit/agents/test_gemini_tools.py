"""GeminiToolLLM over a fake google-genai client — no network."""

from __future__ import annotations

import pytest
from google.genai import types

from quickcart.agents.cards import AnswerDraft
from quickcart.agents.gemini_tools import GeminiToolLLM, ToolCall, ToolResponse, Turn
from quickcart.agents.llm import LLMError

pytestmark = pytest.mark.unit

TOOLS = [
    {
        "name": "get_metric",
        "description": "d",
        "parameters": {
            "type": "object",
            "properties": {"metric": {"type": "string"}},
            "required": ["metric"],
        },
    }
]


def _response(*parts: types.Part, reason: str = "STOP") -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(role="model", parts=list(parts)),
                finish_reason=reason,
            )
        ],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=11, candidates_token_count=5
        ),
    )


class FakeModels:
    def __init__(self, responses=None, stream=None, error: Exception | None = None) -> None:
        self.responses = list(responses or [])
        self.stream = list(stream or [])
        self.error = error
        self.requests: list[dict] = []

    def generate_content(self, *, model, contents, config):
        self.requests.append({"model": model, "contents": contents, "config": config})
        if self.error:
            raise self.error
        return self.responses.pop(0)

    def generate_content_stream(self, *, model, contents, config):
        self.requests.append({"model": model, "contents": contents, "config": config})
        if self.error:
            raise self.error
        return iter(self.stream)


class FakeClient:
    def __init__(self, models: FakeModels) -> None:
        self.models = models


def _llm(models: FakeModels, **kw) -> GeminiToolLLM:
    return GeminiToolLLM(model="gemini-test", client=FakeClient(models), **kw)


def test_generate_parses_function_calls_and_keeps_raw_for_replay() -> None:
    signed = types.Part(
        function_call=types.FunctionCall(name="get_metric", args={"metric": "sales"}, id="c1"),
        thought_signature=b"sig",
    )
    models = FakeModels([_response(signed)])
    step = _llm(models).generate([Turn("user", "sales?")], system="sys", tools=TOOLS)
    assert step.tool_calls == [ToolCall("get_metric", {"metric": "sales"}, "c1")]
    assert step.raw.parts[0].thought_signature == b"sig"
    assert step.usage == {"prompt_tokens": 11, "output_tokens": 5}
    config = models.requests[0]["config"]
    assert config.system_instruction == "sys" and config.temperature == 0
    assert config.automatic_function_calling.disable is True
    assert config.tools[0].function_declarations[0].name == "get_metric"
    assert config.response_mime_type is None  # no schema requested


def test_second_request_replays_raw_model_content_and_tool_responses() -> None:
    signed = types.Part(
        function_call=types.FunctionCall(name="get_metric", args={}), thought_signature=b"sig"
    )
    first = _llm(FakeModels([_response(signed)])).generate(
        [Turn("user", "q")], system="s", tools=TOOLS
    )
    models = FakeModels([_response(types.Part(text='{"summary": "ok"}'))])
    llm = _llm(models)
    turns = [
        Turn("user", "q"),
        Turn("model", first.text, first.tool_calls, raw=first.raw),
        Turn("tool", tool_responses=[ToolResponse("get_metric", {"facts": []}, None)]),
    ]
    step = llm.generate(turns, system="s", tools=TOOLS, response_schema=AnswerDraft)
    contents = models.requests[0]["contents"]
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].thought_signature == b"sig"
    assert contents[2].parts[0].function_response.name == "get_metric"
    config = models.requests[0]["config"]
    assert config.response_mime_type == "application/json" and config.response_schema is not None
    assert step.text == '{"summary": "ok"}' and step.tool_calls == []


def test_thought_parts_are_not_answer_text() -> None:
    step = _llm(
        FakeModels([_response(types.Part(text="thinking...", thought=True), types.Part(text="hi"))])
    ).generate([Turn("user", "q")], system="s")
    assert step.text == "hi"


def test_stream_step_yields_text_deltas_then_final_step() -> None:
    chunks = [
        _response(types.Part(text='{"summary": "He')),
        _response(types.Part(text='llo"}'), reason="STOP"),
    ]
    chunks_out = list(
        _llm(FakeModels(stream=chunks)).stream_step(
            [Turn("user", "q")], system="s", response_schema=AnswerDraft
        )
    )
    assert [c.text_delta for c in chunks_out[:-1]] == ['{"summary": "He', 'llo"}']
    final = chunks_out[-1].step
    assert final.text == '{"summary": "Hello"}' and final.finish_reason == "STOP"


def test_stream_step_function_call_part_is_not_streamed_as_text() -> None:
    part = types.Part(function_call=types.FunctionCall(name="get_metric", args={"metric": "x"}))
    out = list(
        _llm(FakeModels(stream=[_response(part)])).stream_step(
            [Turn("user", "q")], system="s", tools=TOOLS
        )
    )
    assert len(out) == 1 and out[0].step.tool_calls[0].name == "get_metric"


def test_transport_errors_become_llm_errors() -> None:
    with pytest.raises(LLMError, match="gemini call failed"):
        _llm(FakeModels(error=RuntimeError("503"))).generate([Turn("user", "q")], system="s")


def test_schema_with_tools_rejection_retries_without_schema_once() -> None:
    class Rejecting(FakeModels):
        def generate_content(self, *, model, contents, config):
            self.requests.append({"config": config})
            if config.response_mime_type:
                raise RuntimeError(
                    "400 INVALID_ARGUMENT: Function calling with a response mime type: "
                    "'application/json' is unsupported"
                )
            return _response(types.Part(text="plain"))

    models = Rejecting()
    llm = _llm(models)
    step = llm.generate([Turn("user", "q")], system="s", tools=TOOLS, response_schema=AnswerDraft)
    assert step.text == "plain" and len(models.requests) == 2
    llm.generate([Turn("user", "q")], system="s", tools=TOOLS, response_schema=AnswerDraft)
    assert len(models.requests) == 3  # remembered: no second failed attempt


def test_missing_key_is_a_loud_error(monkeypatch) -> None:
    from types import SimpleNamespace

    monkeypatch.setattr(
        "quickcart.agents.gemini_tools.get_settings",
        lambda: SimpleNamespace(gemini_api_key="", gemini_model="m"),
    )
    with pytest.raises(LLMError, match="gemini_api_key"):
        GeminiToolLLM()


def test_select_tool_llm_is_none_without_a_key(monkeypatch) -> None:
    from types import SimpleNamespace

    from quickcart.agents import gemini_tools

    monkeypatch.setattr(
        gemini_tools, "get_settings", lambda: SimpleNamespace(gemini_api_key="", gemini_model="m")
    )
    assert gemini_tools.select_tool_llm() is None
    monkeypatch.setattr(
        gemini_tools, "get_settings", lambda: SimpleNamespace(gemini_api_key="k", gemini_model="m")
    )
    assert gemini_tools.select_tool_llm().model == "m"
