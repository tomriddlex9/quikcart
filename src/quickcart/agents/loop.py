"""NativeToolLoop — the model ⇄ tools loop of the Assistant v2 (Phase B4).

Used when a Gemini key is configured. The model calls tools natively (declared
from each `ToolSpec.args_model`), the loop executes them through
`ToolRegistry.execute` (so RBAC, scope, surface and audit always apply), caps
the exchange at ``max_steps`` model turns, then hydrates the model's structured
reply into verified cards (`agents.cards`).

The loop is a generator of ``(event, data)`` pairs matching the SSE contract:
``status | tool | token | card | followups | error | done``. Tokens are emitted
sentence by sentence **after verification** (placeholders rendered, unbacked
figures dropped), so unverified numbers never reach the UI — while still
streaming live from the model rather than replaying a finished answer.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog

from quickcart.agents.cards import (
    AnswerDraft,
    AnswerEnvelope,
    EvidenceStore,
    Fact,
    allowed_numbers,
    hydrate_answer,
    parse_answer_draft,
    proposal_fact_from_row,
    render_sentence,
    split_sentences,
)
from quickcart.agents.gemini_tools import ModelStep, ToolCall, ToolCallingLLM, ToolResponse, Turn
from quickcart.agents.llm import LLMError
from quickcart.agents.prompts import NATIVE_PROMPT_VERSION, NATIVE_SYSTEM_PROMPT, REPAIR_PROMPT
from quickcart.agents.tools import ToolError, ToolPermissionError, ToolRegistry
from quickcart.identity.models import Principal

logger = structlog.get_logger(__name__)

DEFAULT_MAX_STEPS = 5
MAX_CALLS_PER_STEP = 4
FINAL_MAX_TOKENS = 1_500
GENERIC_VIEW_CHAR_CAP = 8_000
DEGRADED_ANSWER = (
    "The operations assistant is temporarily unavailable (infrastructure "
    "error); no evidence was retrieved, so nothing is reported. Please retry "
    "shortly or check the service logs."
)
NO_ANSWER = "I could not produce an answer for that. Please try rephrasing."

_FOLLOWUPS: dict[str, list[str]] = {
    "get_metric": ["Why did it change?", "Which stores are weakest on this?"],
    "compare_stores": ["Why is the weakest store behind?", "Anything else needing attention?"],
    "explain_metric_change": ["Compare stores on this metric", "Show what needs attention"],
    "get_briefing": ["Which stores need help?", "What is running low?"],
    "get_alerts": ["Summarize today", "Which store is weakest on delivery?"],
    "draft_action": ["Show what needs attention"],
}

Event = tuple[str, dict[str, Any]]


# --------------------------------------------------------------------------- #
# Streaming helpers
# --------------------------------------------------------------------------- #

_SUMMARY_KEY_RE = re.compile(r'"summary"\s*:\s*"')
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", '"': '"', "\\": "\\", "/": "/"}


class SummaryStreamer:
    """Incrementally extracts the decoded ``summary`` string from streaming JSON."""

    def __init__(self) -> None:
        self._buf = ""
        self._pos: int | None = None
        self.done = False

    def feed(self, text: str) -> str:
        if self.done:
            return ""
        self._buf += text
        if self._pos is None:
            match = _SUMMARY_KEY_RE.search(self._buf)
            if match is None:
                return ""
            self._pos = match.end()
        out: list[str] = []
        buf, pos = self._buf, self._pos
        while pos < len(buf):
            ch = buf[pos]
            if ch == '"':
                self.done = True
                pos += 1
                break
            if ch != "\\":
                out.append(ch)
                pos += 1
                continue
            if pos + 1 >= len(buf):
                break
            esc = buf[pos + 1]
            if esc == "u":
                if pos + 6 > len(buf):
                    break
                try:
                    out.append(chr(int(buf[pos + 2 : pos + 6], 16)))
                except ValueError:
                    out.append("?")
                pos += 6
            else:
                out.append(_ESCAPES.get(esc, esc))
                pos += 2
        self._pos = pos
        return "".join(out)


class SentenceGate:
    """Buffers streamed summary text and releases verified, rendered sentences."""

    def __init__(self, evidence: EvidenceStore) -> None:
        self._evidence = evidence
        self._allowed = allowed_numbers(evidence.values())
        self._pending = ""
        self.emitted: list[str] = []

    def push(self, delta: str) -> list[str]:
        self._pending += delta
        sentences = split_sentences(self._pending)
        if len(sentences) <= 1:
            return []
        self._pending = sentences[-1]
        return self._release(sentences[:-1])

    def flush(self) -> list[str]:
        sentences = split_sentences(self._pending)
        self._pending = ""
        return self._release(sentences)

    def _release(self, sentences: list[str]) -> list[str]:
        released: list[str] = []
        for sentence in sentences:
            rendered, *_ = render_sentence(sentence, self._evidence, self._allowed)
            if rendered:
                prefix = " " if self.emitted else ""
                self.emitted.append(rendered)
                released.append(prefix + rendered)
        return released


def _parse_json_object(text: str) -> Any | None:
    start = text.find("{")
    if start == -1:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError:
        return None
    return obj


def _chunk(text: str, size: int = 48) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] if text else []


# --------------------------------------------------------------------------- #
# The loop
# --------------------------------------------------------------------------- #


class NativeToolLoop:
    def __init__(
        self,
        llm: ToolCallingLLM,
        registry: ToolRegistry,
        *,
        max_steps: int = DEFAULT_MAX_STEPS,
        artifacts_dir: Path | None = None,
        system_prompt: str = NATIVE_SYSTEM_PROMPT,
    ) -> None:
        self._llm = llm
        self._registry = registry
        self._max_steps = max_steps
        self._artifacts_dir = artifacts_dir
        self._system = system_prompt

    @property
    def model(self) -> str | None:
        return getattr(self._llm, "model", None)

    # -- public ------------------------------------------------------------------
    def run(
        self,
        message: str,
        *,
        session_id: str | None = None,
        principal: Principal | None = None,
        channel: str = "text",
        history: list[Turn] | None = None,
    ) -> Iterator[Event]:
        request_id = uuid4().hex
        started = datetime.now(UTC).isoformat()
        run = _Run(request_id=request_id, evidence=EvidenceStore())
        turns: list[Turn] = [*(history or []), Turn("user", message)]
        tools = self._registry.declarations(channel, principal)
        yield "status", {"stage": "planning", "model": self.model}
        try:
            final = yield from self._tool_phase(turns, tools, run, principal, channel)
            envelope, streamed = yield from self._answer_phase(final, turns, run)
        except LLMError as exc:
            logger.exception("agent.native.llm_failure", error=str(exc))
            yield (
                "error",
                {
                    "detail": str(exc),
                    "answer": DEGRADED_ANSWER,
                    "degraded": True,
                    "model": self.model,
                },
            )
            yield "done", self._payload(run, None, degraded=True, answer=DEGRADED_ANSWER)
            return

        if not streamed:
            for piece in _chunk(envelope.summary):
                yield "token", {"text": piece}
        for card in envelope.cards:
            yield "card", card.model_dump(mode="json")
        yield "followups", {"items": envelope.followups}
        trace_path = self._persist(run, envelope, session_id, message, started)
        yield "done", self._payload(run, envelope, degraded=False, trace_path=trace_path)

    # -- phases ---------------------------------------------------------------------
    def _tool_phase(
        self,
        turns: list[Turn],
        tools: list[dict[str, Any]],
        run: _Run,
        principal: Principal | None,
        channel: str,
    ) -> Iterator[Event]:
        """Model ⇄ tools until the model answers or the step cap is hit."""
        for _ in range(self._max_steps):
            step, gate = yield from self._model_step(turns, tools, run, stream_summary=True)
            if not step.tool_calls:
                run.gate = gate
                return step
            yield "status", {"stage": "tools", "model": self.model}
            turns.append(Turn("model", step.text, step.tool_calls, raw=step.raw))
            responses: list[ToolResponse] = []
            for call in step.tool_calls[:MAX_CALLS_PER_STEP]:
                response = yield from self._run_tool(call, run, principal, channel)
                responses.append(response)
            for call in step.tool_calls[MAX_CALLS_PER_STEP:]:
                responses.append(
                    ToolResponse(call.name, {"error": "too many tool calls in one step"}, call.id)
                )
            turns.append(Turn("tool", tool_responses=responses))
        # Cap reached: force a final answer with no tools.
        logger.warning("agent.native.step_cap", max_steps=self._max_steps)
        run.errors.append(f"step cap of {self._max_steps} reached; answering with what was found")
        step, gate = yield from self._model_step(turns, None, run, stream_summary=True)
        run.gate = gate
        return step

    def _model_step(
        self,
        turns: list[Turn],
        tools: list[dict[str, Any]] | None,
        run: _Run,
        *,
        stream_summary: bool,
    ) -> Iterator[Event]:
        """One streamed model call → ``(ModelStep, SentenceGate)``; tokens as verified."""
        streamer = SummaryStreamer()
        gate = SentenceGate(run.evidence)
        final: ModelStep | None = None
        for chunk in self._llm.stream_step(
            turns,
            system=self._system,
            tools=tools,
            response_schema=AnswerDraft,
            max_tokens=FINAL_MAX_TOKENS,
        ):
            if chunk.step is not None:
                final = chunk.step
            elif chunk.text_delta and stream_summary:
                for sentence in gate.push(streamer.feed(chunk.text_delta)):
                    yield "token", {"text": sentence}
        if final is None:
            raise LLMError("model stream ended without a final step")
        if streamer.done or gate.emitted:
            for sentence in gate.flush():
                yield "token", {"text": sentence}
        return final, gate

    def _answer_phase(self, final: ModelStep, turns: list[Turn], run: _Run) -> Iterator[Event]:
        yield "status", {"stage": "answer", "model": self.model}
        draft = self._draft_from(final, run)
        envelope = hydrate_answer(draft, run.evidence)
        prov = envelope.provenance
        if (prov.stray_numbers or prov.unresolved) and run.evidence and not run.repaired:
            run.repaired = True
            repaired = self._repair(turns, final, prov.stray_numbers or prov.unresolved)
            if repaired is not None:
                better = hydrate_answer(repaired, run.evidence)
                if _issue_count(better) < _issue_count(envelope):
                    envelope = better
        if not envelope.followups:
            envelope.followups = self._default_followups(run)
        # Once any verified sentence has streamed, `done.answer` is the authority for
        # the final text; never append a second copy of the summary as tokens.
        streamed = bool(run.gate and run.gate.emitted)
        return envelope, streamed

    # -- internals -----------------------------------------------------------------
    def _draft_from(self, final: ModelStep, run: _Run) -> AnswerDraft:
        text = final.text.strip()
        draft = parse_answer_draft(_parse_json_object(text)) if text else None
        if draft is None:
            run.errors.append("model reply was not the structured answer; using plain text")
            draft = AnswerDraft(summary=text or "")
        if not draft.summary.strip() and not draft.cards and not run.evidence:
            draft = AnswerDraft(summary=NO_ANSWER)
        if not draft.cards and run.default_cards:
            draft = draft.model_copy(update={"cards": parse_cards(run.default_cards[:2])})
        return draft

    def _repair(self, turns: list[Turn], final: ModelStep, strays: list[str]) -> AnswerDraft | None:
        repair_turns = [
            *turns,
            Turn("model", final.text or "{}"),
            Turn("user", REPAIR_PROMPT.format(strays=", ".join(map(str, strays[:6])))),
        ]
        try:
            step = self._llm.generate(
                repair_turns,
                system=self._system,
                tools=None,
                response_schema=AnswerDraft,
                max_tokens=FINAL_MAX_TOKENS,
            )
        except LLMError as exc:
            logger.warning("agent.native.repair_failed", error=str(exc))
            return None
        return parse_answer_draft(_parse_json_object(step.text))

    def _run_tool(
        self, call: ToolCall, run: _Run, principal: Principal | None, channel: str
    ) -> Iterator[Event]:
        step_no = len(run.tool_trace) + 1
        entry: dict[str, Any] = {
            "step": step_no,
            "tool": call.name,
            "arguments_summary": json.dumps(call.args, default=str)[:200],
        }
        ok, cache_hit, summary = True, False, ""
        yield "tool_start", {"name": call.name, "step": step_no}
        try:
            result = self._registry.execute(call.name, dict(call.args), principal, channel)
        except ToolPermissionError as exc:
            ok, summary = False, f"not allowed: {exc}"
            response: dict[str, Any] = {"error": summary}
        except ToolError as exc:
            ok, summary = False, str(exc)
            response = {"error": summary}
        except Exception as exc:  # a tool bug must be loud, but must not kill the turn
            logger.exception("agent.native.tool_crash", tool=call.name)
            ok, summary = False, f"{call.name} failed unexpectedly"
            response = {"error": summary, "detail": type(exc).__name__}
        else:
            summary = str(result.get("summary", ""))[:300]
            cache_hit = bool(result.get("cache_hit"))
            response = self._ingest(call.name, result, run)
        if not ok:
            run.errors.append(f"{call.name}: {summary}")
        entry["result_summary"] = summary if ok else f"ERROR: {summary}"
        entry["cache_hit"] = cache_hit
        run.tool_trace.append(entry)
        yield "tool", {"name": call.name, "ok": ok, "cache_hit": cache_hit, "summary": summary}
        return ToolResponse(call.name, response, call.id)

    def _ingest(self, name: str, result: dict[str, Any], run: _Run) -> dict[str, Any]:
        """Register a tool result's facts; return what the model gets to see."""
        facts = result.get("facts")
        evidence_summary: dict[str, Any] = {
            "tool": name,
            "summary": result.get("summary", ""),
            "type": (result.get("evidence") or {}).get("type", "fact"),
        }
        run.evidence_list.append(evidence_summary)
        run.default_cards.extend(result.get("card_drafts") or [])
        if isinstance(facts, dict) and facts:
            run.evidence.add_many(facts)
            return result.get("model_view") or {"summary": result.get("summary", "")}
        # Legacy tools (no facts): make their raw evidence citable so figures verify.
        raw = result.get("evidence") or {}
        run.legacy_count += 1
        ref = f"{name}:{run.legacy_count}"
        if raw.get("type") == "proposal":
            fact = proposal_fact_from_row(raw)
            run.default_cards.append({"type": "proposal", "ref": fact.ref})
        else:
            fact = Fact(ref=ref, kind="note", label=name, data=raw)
        run.evidence.add(fact)
        text = json.dumps(raw, default=str)
        if len(text) > GENERIC_VIEW_CHAR_CAP:
            text = text[:GENERIC_VIEW_CHAR_CAP] + "...[truncated]"
        return {"ref": fact.ref, "summary": result.get("summary", ""), "evidence_json": text}

    @staticmethod
    def _default_followups(run: _Run) -> list[str]:
        for entry in reversed(run.tool_trace):
            if entry["tool"] in _FOLLOWUPS and not str(entry["result_summary"]).startswith("ERROR"):
                return _FOLLOWUPS[entry["tool"]][:3]
        return []

    def _payload(
        self,
        run: _Run,
        envelope: AnswerEnvelope | None,
        *,
        degraded: bool,
        answer: str | None = None,
        trace_path: str | None = None,
    ) -> dict[str, Any]:
        return {
            "answer": answer if answer is not None else (envelope.summary if envelope else ""),
            "cards": [c.model_dump(mode="json") for c in envelope.cards] if envelope else [],
            "followups": envelope.followups if envelope else [],
            "provenance": envelope.provenance.model_dump(mode="json") if envelope else None,
            "evidence": run.evidence_list,
            "tool_trace": run.tool_trace,
            "request_id": run.request_id,
            "trace_path": trace_path,
            "degraded": degraded,
            "model": self.model,
            "handled_at": datetime.now(UTC).isoformat(),
            "intent": "native",
            "mode": "native",
        }

    def _persist(
        self,
        run: _Run,
        envelope: AnswerEnvelope,
        session_id: str | None,
        message: str,
        started: str,
    ) -> str | None:
        if self._artifacts_dir is None:
            return None
        trace = {
            "request_id": run.request_id,
            "session_id": session_id,
            "started_at": started,
            "finished_at": datetime.now(UTC).isoformat(),
            "prompt_version": NATIVE_PROMPT_VERSION,
            "mode": "native",
            "model": self.model,
            "user_query": message,
            "tool_trace": run.tool_trace,
            "facts": {ref: fact.model_dump(mode="json") for ref, fact in run.evidence.items()},
            "errors": run.errors,
            "answer": envelope.model_dump(mode="json"),
        }
        path = self._artifacts_dir / f"{run.request_id}.json"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(trace, indent=2, default=str), encoding="utf-8")
        except OSError as exc:
            logger.warning("agent.trace_write_failed", request_id=run.request_id, error=str(exc))
            return None
        return str(path)


class _Run:
    """Mutable per-request state (kept out of the loop so the loop is reusable)."""

    def __init__(self, request_id: str, evidence: EvidenceStore) -> None:
        self.request_id = request_id
        self.evidence = evidence
        self.evidence_list: list[dict[str, Any]] = []
        self.tool_trace: list[dict[str, Any]] = []
        self.default_cards: list[dict[str, Any]] = []
        self.errors: list[str] = []
        self.legacy_count = 0
        self.repaired = False
        self.gate: SentenceGate | None = None


def parse_cards(raw_cards: list[dict[str, Any]]) -> list[Any]:
    parsed = parse_answer_draft({"summary": "", "cards": raw_cards})
    return parsed.cards if parsed else []


def _issue_count(envelope: AnswerEnvelope) -> int:
    prov = envelope.provenance
    return len(prov.stray_numbers) + len(prov.unresolved) + prov.dropped_cards
