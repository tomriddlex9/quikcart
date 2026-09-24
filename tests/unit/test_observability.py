"""Unit tests for quickcart.observability (no external services)."""

import asyncio

import pytest

from quickcart.observability import (
    CorrelationIdMiddleware,
    bind_correlation_id,
    correlation_id,
    get_correlation_id,
    new_correlation_id,
    set_correlation_id,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_correlation_id():
    token = correlation_id.set(None)
    try:
        yield
    finally:
        correlation_id.reset(token)


def test_new_correlation_id_sets_context() -> None:
    value = new_correlation_id()
    assert value
    assert correlation_id.get() == value
    assert get_correlation_id() == value


def test_set_correlation_id_roundtrip() -> None:
    set_correlation_id("req-123")
    assert get_correlation_id() == "req-123"


@pytest.mark.parametrize("bad", ["with space", "slash/evil", "", "x" * 65, "semi;colon"])
def test_set_correlation_id_rejects_unsafe(bad: str) -> None:
    with pytest.raises(ValueError):
        set_correlation_id(bad)


def test_bind_correlation_id_processor_injects_value() -> None:
    set_correlation_id("req-abc")
    event = bind_correlation_id(None, "info", {"event": "demo"})
    assert event["correlation_id"] == "req-abc"


def test_bind_correlation_id_creates_one_when_unset() -> None:
    token = correlation_id.set(None)
    try:
        event = bind_correlation_id(None, "info", {"event": "demo"})
        assert event["correlation_id"]
        assert correlation_id.get() == event["correlation_id"]
    finally:
        correlation_id.reset(token)


def _capturing_app() -> object:
    async def app(scope: dict, receive: object, send: object) -> None:
        scope["_messages"].append({"type": "context", "value": correlation_id.get()})
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    return app


async def _noop_receive() -> dict:
    return {"type": "http.request"}


async def _noop_send(message: dict) -> None:
    return None


def _run(middleware: CorrelationIdMiddleware, scope: dict) -> list[dict]:
    scope.setdefault("_messages", [])
    messages: list[dict] = []

    async def send(message: dict) -> None:
        messages.append(message)

    async def drive() -> None:
        await middleware(scope, _noop_receive, send)

    asyncio.run(drive())
    return scope["_messages"] + messages


def test_middleware_echoes_inbound_header() -> None:
    middleware = CorrelationIdMiddleware(_capturing_app())
    messages = _run(middleware, {"type": "http", "headers": [(b"x-correlation-id", b"req-42")]})

    start = next(m for m in messages if m["type"] == "http.response.start")
    assert (b"x-correlation-id", b"req-42") in start["headers"]
    ctx = next(m for m in messages if m["type"] == "context")
    assert ctx["value"] == "req-42"
    # Context is cleared once the request completes.
    assert correlation_id.get() is None


def test_middleware_generates_id_when_header_missing() -> None:
    middleware = CorrelationIdMiddleware(_capturing_app())
    messages = _run(middleware, {"type": "http", "headers": []})
    start = next(m for m in messages if m["type"] == "http.response.start")
    echoed = dict(start["headers"])[b"x-correlation-id"]
    assert echoed
    ctx = next(m for m in messages if m["type"] == "context")
    assert ctx["value"] == echoed.decode()


def test_middleware_replaces_invalid_inbound_id() -> None:
    middleware = CorrelationIdMiddleware(_capturing_app())
    messages = _run(
        middleware, {"type": "http", "headers": [(b"x-correlation-id", b"bad id!")]}
    )
    start = next(m for m in messages if m["type"] == "http.response.start")
    echoed = dict(start["headers"])[b"x-correlation-id"]
    assert echoed != b"bad id!"
    ctx = next(m for m in messages if m["type"] == "context")
    assert ctx["value"] == echoed.decode()


def test_middleware_passes_non_http_scopes_through() -> None:
    seen: list[str] = []

    async def app(scope: dict, receive: object, send: object) -> None:
        seen.append(scope["type"])

    middleware = CorrelationIdMiddleware(app)
    asyncio.run(middleware({"type": "lifespan"}, _noop_receive, _noop_send))
    assert seen == ["lifespan"]
    assert correlation_id.get() is None
