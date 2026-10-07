"""Native tool-calling LLM boundary (Assistant v2) + the Gemini implementation.

`ToolCallingLLM` is provider-neutral: the loop speaks `Turn`s and gets a
`ModelStep` (text and/or tool calls) back, so tests inject a scripted fake with
no network and no SDK. `GeminiToolLLM` adapts it to ``google.genai`` with the
SDK's automatic function calling **disabled** — the loop owns execution so RBAC,
audit, caps and provenance always run.

The old REST `GeminiLLM.chat()` in ``llm.py`` is untouched; it still serves the
NL→SQL path and the planned pipeline.

Gemini thought signatures: when the model returns function calls, the provider
`Content` is kept on the `Turn` (``raw``) and replayed verbatim on the next
request — required by thinking models.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel

from quickcart.agents.declarations import schema_for
from quickcart.agents.llm import DEFAULT_TIMEOUT_SECONDS, LLMError
from quickcart.config.settings import get_settings

logger = structlog.get_logger(__name__)


# --------------------------------------------------------------------------- #
# Provider-neutral types
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ToolCall:
    name: str
    args: dict[str, Any] = field(default_factory=dict)
    id: str | None = None


@dataclass(frozen=True)
class ToolResponse:
    name: str
    response: dict[str, Any]
    id: str | None = None


@dataclass
class Turn:
    role: Literal["user", "model", "tool"]
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_responses: list[ToolResponse] = field(default_factory=list)
    raw: Any = None  # provider content to replay verbatim (thought signatures)


@dataclass
class ModelStep:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw: Any = None
    finish_reason: str | None = None
    usage: dict[str, int] = field(default_factory=dict)


@dataclass
class StepChunk:
    """One streaming increment; the last chunk carries the assembled ``step``."""

    text_delta: str = ""
    step: ModelStep | None = None


ResponseSchema = type[BaseModel] | dict[str, Any]


@runtime_checkable
class ToolCallingLLM(Protocol):
    model: str

    def generate(
        self,
        turns: list[Turn],
        *,
        system: str,
        tools: list[dict[str, Any]] | None = None,
        response_schema: ResponseSchema | None = None,
        max_tokens: int | None = None,
    ) -> ModelStep: ...

    def stream_step(
        self,
        turns: list[Turn],
        *,
        system: str,
        tools: list[dict[str, Any]] | None = None,
        response_schema: ResponseSchema | None = None,
        max_tokens: int | None = None,
    ) -> Iterator[StepChunk]: ...


# --------------------------------------------------------------------------- #
# Gemini (google-genai)
# --------------------------------------------------------------------------- #


def _schema_dict(schema: ResponseSchema) -> dict[str, Any]:
    return schema_for(schema) if isinstance(schema, type) else schema


def _is_schema_with_tools_rejection(exc: Exception) -> bool:
    text = str(exc).lower()
    return "mime" in text or ("function calling" in text and "json" in text)


class GeminiToolLLM:
    """``google.genai`` client with tools + optional structured output."""

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        client: Any | None = None,
        schema_with_tools: bool = True,
    ) -> None:
        settings = get_settings()
        self._model = model or settings.gemini_model
        if not self._model:
            raise LLMError("gemini_model is not configured (env GEMINI_MODEL)")
        if client is not None:
            self._client = client
        else:
            key = (settings.gemini_api_key if api_key is None else api_key or "").strip()
            if not key:
                raise LLMError("gemini_api_key is not configured (env GEMINI_API_KEY)")
            from google import genai
            from google.genai import types

            self._client = genai.Client(
                api_key=key, http_options=types.HttpOptions(timeout=int(timeout * 1000))
            )
        self._schema_with_tools = schema_with_tools

    @property
    def model(self) -> str:
        return self._model

    # -- request building ------------------------------------------------------
    @staticmethod
    def _contents(turns: list[Turn]) -> list[Any]:
        from google.genai import types

        contents: list[Any] = []
        for turn in turns:
            if turn.role == "user":
                contents.append(types.Content(role="user", parts=[types.Part(text=turn.text)]))
            elif turn.role == "model":
                if turn.raw is not None:
                    contents.append(turn.raw)
                    continue
                parts: list[Any] = [types.Part(text=turn.text)] if turn.text else []
                parts += [
                    types.Part(function_call=types.FunctionCall(name=c.name, args=c.args, id=c.id))
                    for c in turn.tool_calls
                ]
                contents.append(types.Content(role="model", parts=parts))
            else:
                contents.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part(
                                function_response=types.FunctionResponse(
                                    name=r.name, response=r.response, id=r.id
                                )
                            )
                            for r in turn.tool_responses
                        ],
                    )
                )
        return contents

    def _config(
        self,
        system: str,
        tools: list[dict[str, Any]] | None,
        response_schema: ResponseSchema | None,
        max_tokens: int | None,
    ) -> Any:
        from google.genai import types

        kwargs: dict[str, Any] = {"system_instruction": system, "temperature": 0}
        if max_tokens is not None:
            kwargs["max_output_tokens"] = max_tokens
        if tools:
            kwargs["tools"] = [
                types.Tool(
                    function_declarations=[
                        types.FunctionDeclaration.model_validate(d) for d in tools
                    ]
                )
            ]
            kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(
                disable=True
            )
        if response_schema is not None and (not tools or self._schema_with_tools):
            kwargs["response_mime_type"] = "application/json"
            kwargs["response_schema"] = _schema_dict(response_schema)
        return types.GenerateContentConfig(**kwargs)

    # -- response parsing ---------------------------------------------------------
    @staticmethod
    def _parts(response: Any) -> tuple[list[Any], str | None]:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return [], None
        candidate = candidates[0]
        content = getattr(candidate, "content", None)
        reason = getattr(candidate, "finish_reason", None)
        return list(getattr(content, "parts", None) or []), (
            getattr(reason, "name", None) or (str(reason) if reason else None)
        )

    @staticmethod
    def _step_from_parts(parts: list[Any], reason: str | None, usage: Any) -> ModelStep:
        from google.genai import types

        text_bits: list[str] = []
        calls: list[ToolCall] = []
        for part in parts:
            if getattr(part, "thought", False):
                continue
            call = getattr(part, "function_call", None)
            if call is not None and getattr(call, "name", None):
                calls.append(ToolCall(call.name, dict(call.args or {}), getattr(call, "id", None)))
            elif isinstance(getattr(part, "text", None), str):
                text_bits.append(part.text)
        meta = {
            "prompt_tokens": getattr(usage, "prompt_token_count", None) or 0,
            "output_tokens": getattr(usage, "candidates_token_count", None) or 0,
        }
        return ModelStep(
            text="".join(text_bits),
            tool_calls=calls,
            raw=types.Content(role="model", parts=parts) if calls else None,
            finish_reason=reason,
            usage=meta,
        )

    # -- calls ----------------------------------------------------------------------------
    def _call(self, method: str, turns: list[Turn], **cfg: Any) -> Any:
        contents = self._contents(turns)
        config = self._config(**cfg)
        try:
            return getattr(self._client.models, method)(
                model=self._model, contents=contents, config=config
            )
        except Exception as exc:
            if (
                cfg.get("tools")
                and cfg.get("response_schema") is not None
                and self._schema_with_tools
                and _is_schema_with_tools_rejection(exc)
            ):
                logger.warning("agent.gemini_schema_with_tools_unsupported", model=self._model)
                self._schema_with_tools = False
                return self._call(method, turns, **cfg)
            logger.warning("agent.llm_error", model=self._model, error=str(exc))
            raise LLMError(f"gemini call failed: {exc}") from exc

    def generate(
        self,
        turns: list[Turn],
        *,
        system: str,
        tools: list[dict[str, Any]] | None = None,
        response_schema: ResponseSchema | None = None,
        max_tokens: int | None = None,
    ) -> ModelStep:
        response = self._call(
            "generate_content",
            turns,
            system=system,
            tools=tools,
            response_schema=response_schema,
            max_tokens=max_tokens,
        )
        parts, reason = self._parts(response)
        return self._step_from_parts(parts, reason, getattr(response, "usage_metadata", None))

    def stream_step(
        self,
        turns: list[Turn],
        *,
        system: str,
        tools: list[dict[str, Any]] | None = None,
        response_schema: ResponseSchema | None = None,
        max_tokens: int | None = None,
    ) -> Iterator[StepChunk]:
        stream = self._call(
            "generate_content_stream",
            turns,
            system=system,
            tools=tools,
            response_schema=response_schema,
            max_tokens=max_tokens,
        )
        parts: list[Any] = []
        reason: str | None = None
        usage: Any = None
        try:
            for chunk in stream:
                new_parts, new_reason = self._parts(chunk)
                reason = new_reason or reason
                usage = getattr(chunk, "usage_metadata", None) or usage
                for part in new_parts:
                    parts.append(part)
                    text = getattr(part, "text", None)
                    is_plain_text = (
                        isinstance(text, str)
                        and text
                        and not getattr(part, "thought", False)
                        and getattr(part, "function_call", None) is None
                    )
                    if is_plain_text:
                        yield StepChunk(text_delta=text)
        except Exception as exc:
            if (
                not parts
                and tools
                and response_schema is not None
                and self._schema_with_tools
                and _is_schema_with_tools_rejection(exc)
            ):
                logger.warning("agent.gemini_schema_with_tools_unsupported", model=self._model)
                self._schema_with_tools = False
                yield from self.stream_step(
                    turns,
                    system=system,
                    tools=tools,
                    response_schema=response_schema,
                    max_tokens=max_tokens,
                )
                return
            logger.warning("agent.llm_error", model=self._model, error=str(exc))
            raise LLMError(f"gemini stream failed: {exc}") from exc
        yield StepChunk(step=self._step_from_parts(parts, reason, usage))


def select_tool_llm() -> ToolCallingLLM | None:
    """`GeminiToolLLM` when a Gemini key is configured, else ``None`` (planned pipeline)."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    return GeminiToolLLM(model=settings.gemini_model, api_key=settings.gemini_api_key)
