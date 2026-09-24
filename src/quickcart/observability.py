"""Request-scoped correlation IDs for structured logs (kit/03 Phase 15).

One operation — an API request, a proposal approval, a pipeline run — gets one
correlation id that is attached to every structlog event emitted while it is in
flight, so an operator can follow it across API, executor, and pipeline logs.

Components:

- ``correlation_id`` — the ContextVar holding the id for the current context.
- ``new_correlation_id`` / ``set_correlation_id`` / ``get_correlation_id`` —
  create, import (validated), and read the current id.
- ``bind_correlation_id`` — structlog processor that injects the id into every
  event dict. When no id is set yet (e.g. CLI or pipeline code), it creates one
  lazily so every log line remains traceable.
- ``CorrelationIdMiddleware`` — pure-ASGI middleware: reads the inbound
  ``X-Correlation-ID`` header (validated; rejected ids are replaced), stores it
  in the contextvar for the duration of the request, and echoes it back on the
  response. Framework-agnostic; with FastAPI use
  ``app.add_middleware(correlation_id_middleware)``.
"""

import re
import uuid
from contextvars import ContextVar
from typing import Any

CORRELATION_HEADER = "x-correlation-id"
_MAX_ID_LENGTH = 64
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.\-]+$")

correlation_id: ContextVar[str | None] = ContextVar("quickcart_correlation_id", default=None)


def new_correlation_id() -> str:
    """Generate a fresh id, store it in the current context, and return it."""
    value = uuid.uuid4().hex
    correlation_id.set(value)
    return value


def set_correlation_id(value: str) -> None:
    """Import an externally supplied id (e.g. an inbound request header)."""
    if len(value) > _MAX_ID_LENGTH or not _SAFE_ID.fullmatch(value):
        raise ValueError(f"invalid correlation id: {value!r}")
    correlation_id.set(value)


def get_correlation_id() -> str:
    """Return the current id, creating one lazily if the context has none."""
    value = correlation_id.get()
    if value is None:
        return new_correlation_id()
    return value


def bind_correlation_id(
    logger: Any, method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """structlog processor: add ``correlation_id`` to every event."""
    event_dict["correlation_id"] = get_correlation_id()
    return event_dict


class CorrelationIdMiddleware:
    """Pure-ASGI middleware threading X-Correlation-ID through a request."""

    def __init__(self, app: Any) -> None:
        self._app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        header_value = self._inbound_id(scope.get("headers", []))
        token = correlation_id.set(header_value or new_correlation_id())
        try:
            await self._app(scope, receive, self._send_with_id(send))
        finally:
            correlation_id.reset(token)

    @staticmethod
    def _inbound_id(headers: list[tuple[bytes, bytes]]) -> str | None:
        for name, value in headers:
            if name.lower() != CORRELATION_HEADER.encode():
                continue
            candidate = value.decode("ascii", errors="ignore")
            if len(candidate) <= _MAX_ID_LENGTH and _SAFE_ID.fullmatch(candidate):
                return candidate
        return None

    @staticmethod
    def _send_with_id(send: Any) -> Any:
        current = correlation_id.get()

        async def send_with_header(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if current is not None and all(
                    name.lower() != CORRELATION_HEADER.encode() for name, _ in headers
                ):
                    headers.append((CORRELATION_HEADER.encode(), current.encode()))
                    message = {**message, "headers": headers}
            await send(message)

        return send_with_header


# Alias so framework integrations read naturally:
# ``app.add_middleware(correlation_id_middleware)``.
correlation_id_middleware = CorrelationIdMiddleware
