"""SSE chat_sse event order with FakeLLM — no network, no Spark."""

from __future__ import annotations

import json

from quickcart.agents import service
from quickcart.agents.graph import build_graph
from tests.unit.agents.fakes import FakeLLM, build_fake_registry


def _parse_sse(chunks: list[bytes]) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    event_name = "message"
    data_lines: list[str] = []
    raw = b"".join(chunks).decode("utf-8")
    for line in raw.splitlines():
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].strip())
        elif line == "":
            if data_lines:
                events.append((event_name, json.loads("\n".join(data_lines))))
            event_name = "message"
            data_lines = []
    if data_lines:
        events.append((event_name, json.loads("\n".join(data_lines))))
    return events


def test_chat_sse_emits_status_tool_token_done(monkeypatch, tmp_path) -> None:
    graph = build_graph(FakeLLM(), build_fake_registry(), artifacts_dir=tmp_path)
    monkeypatch.setattr(service, "_runtime", lambda: (graph, FakeLLM()))
    frames = list(service.chat_sse("How is Store 8 performing?", session_id="s-sse"))
    events = _parse_sse(frames)
    names = [name for name, _ in events]
    assert names[0] == "status"
    assert events[0][1]["stage"] == "classifying"
    assert "tool" in names
    assert "token" in names
    assert names[-1] == "done"
    done = events[-1][1]
    assert done["degraded"] is False
    assert done["answer"]
    assert done["tool_trace"]


def test_chat_sse_error_path_emits_done_degraded(monkeypatch) -> None:
    class _Boom:
        @staticmethod
        def stream(state, config=None, stream_mode=None):
            raise RuntimeError("spark vanished")

    class _Llm:
        model = "fake-model"

    monkeypatch.setattr(service, "_runtime", lambda: (_Boom(), _Llm()))
    events = _parse_sse(list(service.chat_sse("How is Store 8 performing?")))
    names = [name for name, _ in events]
    assert "error" in names
    assert names[-1] == "done"
    assert events[-1][1]["degraded"] is True
    # initial_state is used; request_id may be absent until classify
    assert "answer" in events[-1][1]
