"""LLM boundary for the Phase 13 agent (kit/03 §13.1).

`LLMClient` is a protocol so tests and the evaluation suite inject a
deterministic `FakeLLM` — zero Ollama, zero network (kit/05 §4.3: domain
logic separate from I/O adapters). `OllamaLLM` is the only production
implementation: model name and base URL always come from
`quickcart.config.settings` (``OLLAMA_MODEL`` / ``OLLAMA_BASE_URL``) — never
hard-coded. Temperature is 0 for determinism, and transport failures surface
as `LLMError` so the service can degrade loudly rather than silently.
"""

from typing import Any, Protocol, runtime_checkable

import structlog

from quickcart.config.settings import get_settings

logger = structlog.get_logger(__name__)

DEFAULT_TIMEOUT_SECONDS = 120.0


class LLMError(Exception):
    """The local model is unreachable, timed out, or returned garbage."""


@runtime_checkable
class LLMClient(Protocol):
    """Minimal chat boundary used by the agent graph."""

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
    ) -> str:
        """Return the assistant reply for `messages` (optionally JSON-forced)."""
        ...


class OllamaLLM:
    """Tool-capable local LLM via the `ollama` Python package.

    `client` is injectable so tests can stub the transport without monkey
    patching; `model`/`base_url` override Settings for the same reason.
    """

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        client: object | None = None,
    ) -> None:
        settings = get_settings()
        self._model = model or settings.ollama_model
        if not self._model:
            raise LLMError("ollama_model is not configured (env OLLAMA_MODEL)")
        if client is not None:
            self._client = client
        else:
            import ollama

            self._client = ollama.Client(
                host=base_url or settings.ollama_base_url, timeout=timeout
            )

    @property
    def model(self) -> str:
        return self._model

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
    ) -> str:
        options: dict[str, Any] = {"temperature": 0}
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        last_error: str | None = None
        for attempt in range(2):  # one retry: small models occasionally return empty content
            try:
                response = self._client.chat(
                    model=self._model,
                    messages=messages,
                    format="json" if json_mode else None,
                    options=options,
                    # No `think` override: qwen3 separates reasoning from
                    # content, and its stage outputs parse reliably this way;
                    # `max_tokens` bounds the reasoning budget on CPUs.
                    keep_alive="10m",
                )
            except Exception as exc:  # transport/timeout/model errors -> loud failure
                logger.warning("agent.llm_error", model=self._model, error=str(exc))
                raise LLMError(f"ollama chat failed: {exc}") from exc
            content = getattr(response.message, "content", None)
            if isinstance(content, str) and content.strip():
                return content
            last_error = f"ollama returned an empty reply (model {self._model})"
            logger.warning("agent.llm_empty_reply", model=self._model, attempt=attempt)
        raise LLMError(last_error or "ollama returned an empty reply")
