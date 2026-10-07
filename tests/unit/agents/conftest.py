import pytest

from quickcart.agents import service
from quickcart.agents.tools import reset_tool_cache


@pytest.fixture(autouse=True)
def _reset_agent_tool_cache() -> None:
    reset_tool_cache()
    yield
    reset_tool_cache()


@pytest.fixture(autouse=True)
def _no_native_gemini_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's GEMINI_API_KEY must never route unit tests to the network.

    Tests that exercise the native loop install their own (fake-LLM) loop.
    """
    monkeypatch.setattr(service, "_native_loop", lambda: None)
