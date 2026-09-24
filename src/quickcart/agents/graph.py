"""LangGraph state machine for the Phase 13 agent (kit/03 §13.4/13.5).

Flow:

```text
START → classify (intent: analytics | policy | prediction | mixed | unsupported)
      → plan (bounded, ordered tool list)
      → tool loop (one step per node visit, hard cap `max_steps` — kit AR-003;
        ToolError lands in state.errors and the loop degrades transparently)
      → action gate (proposal creation ONLY via the proper tool, AR-006)
      → grounded answer (LLM sees retrieved facts only; explicit uncertainty
        when evidence is insufficient — AR-005, RAGR-004)
      → trace persisted to data/artifacts/agent_traces/<request_id>.json
      → END
```

Every LLM interaction degrades to a deterministic fallback on malformed JSON
or an LLM outage — the agent never fabricates an answer it cannot support.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, TypedDict
from uuid import uuid4

import structlog
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ValidationError, model_validator

from quickcart.agents.llm import LLMClient, LLMError
from quickcart.agents.prompts import (
    ACTION_PROMPT,
    ANSWER_PROMPT,
    ANSWER_SCHEMA_HINT,
    INTENT_ROUTING_PROMPT,
    PLAN_PROMPT,
    PROMPT_VERSION,
)
from quickcart.agents.tools import (
    CreateRestockProposalArgs,
    ToolError,
    ToolRegistry,
)

logger = structlog.get_logger(__name__)

DEFAULT_MAX_STEPS = 5  # kit/02 AR-003
EVIDENCE_PROMPT_CHAR_CAP = 6_000

INTENTS = ("analytics", "policy", "prediction", "mixed", "unsupported")

CLARIFICATION_ANSWER = (
    "I could not determine which store you mean, so I have not run any store "
    "tool. Please rephrase with a numeric store id (for example \"store 8\") "
    "and I will look it up."
)

UNSUPPORTED_ANSWER = (
    "I don't have sufficient evidence to answer this: the request is outside "
    "the analytics, policy-document, and prediction scope my bounded tools "
    "cover, and I will not guess."
)

_WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}

# Deterministic pre-filter for the action gate: no action language, no gate call.
ACTION_KEYWORDS = ("restock", "replenish", "order more", "take action", "do something")


class AgentState(TypedDict, total=False):
    """Graph state (kit/03 §13.4) plus trace bookkeeping."""

    request_id: str
    session_id: str | None
    user_query: str
    intent: str
    intent_reasoning: str
    plan: list[dict[str, Any]]  # remaining steps: {"tool", "arguments", "purpose"}
    selected_tools: list[str]
    tool_results: list[dict[str, Any]]
    tool_trace: list[dict[str, Any]]  # {step, tool, arguments_summary, result_summary}
    evidence: list[dict[str, Any]]
    answer: str
    proposal: dict[str, Any] | None
    errors: list[str]
    step_count: int
    max_steps: int
    needs_clarification: bool
    trace_path: str | None
    started_at: str
    finished_at: str


class IntentClassification(BaseModel):
    intent: Literal["analytics", "policy", "prediction", "mixed", "unsupported"]
    reasoning: str = ""
    tools: list[str] = []


class PlanStep(BaseModel):
    tool: str
    arguments: dict[str, Any] = {}
    purpose: str = ""


class PlanDraft(BaseModel):
    steps: list[PlanStep] = []

    @model_validator(mode="before")
    @classmethod
    def _unwrap_nested_plan(cls, data: Any) -> Any:
        """Tolerate models that wrap the plan, e.g. {"plan": {"steps": [...]}}."""
        if isinstance(data, dict) and "steps" not in data and isinstance(
            data.get("plan"), dict
        ):
            return data["plan"]
        return data


class ActionDraft(BaseModel):
    wants_action: bool = False
    proposal: CreateRestockProposalArgs | None = None


class AnswerDraft(BaseModel):
    answer: str


# --------------------------------------------------------------------------- #
# Deterministic helpers (query understanding + fallbacks)
# --------------------------------------------------------------------------- #


def extract_store_id(query: str) -> int | None:
    """Resolve "store 8" and word forms ("store eight") to an id; else None."""
    match = re.search(r"\bstore\s+([a-z]+|\d+)\b", query.lower())
    if match is None:
        return None
    token = match.group(1)
    if token.isdigit():
        return int(token)
    return _WORD_NUMBERS.get(token)


def has_unresolvable_store_reference(query: str) -> bool:
    """True when the query points at a specific store we cannot resolve."""
    lowered = query.lower()
    if re.search(r"\b(?:that|this) store\b", lowered):
        return True
    match = re.search(r"\bstore\s+([a-z]+)\b", lowered)
    return match is not None and match.group(1) not in _WORD_NUMBERS


def extract_order_id(query: str) -> int | None:
    match = re.search(r"\border\s+(\d+)\b", query.lower())
    return int(match.group(1)) if match else None


def _heuristic_intent(query: str) -> IntentClassification:
    """Keyword fallback for classification when the LLM reply is unusable."""
    lowered = query.lower()
    policy = any(k in lowered for k in ("refund", "policy", "sop", "manual", "complaint"))
    prediction = any(k in lowered for k in ("forecast", "predict", "will ", "be late"))
    analytics = any(k in lowered for k in ("store", "revenue", "gmv", "order", "deliver",
                                           "inventor", "stock", "kpi", "cancel", "metric"))
    unsupported = any(k in lowered for k in ("favourite", "favorite", "colour", "ceo"))
    if unsupported and not (policy or prediction or analytics):
        intent: Literal["analytics", "policy", "prediction", "mixed", "unsupported"] = (
            "unsupported"
        )
    elif policy and analytics:
        intent = "mixed"
    elif policy:
        intent = "policy"
    elif prediction:
        intent = "prediction"
    elif analytics:
        intent = "analytics"
    else:
        intent = "unsupported"
    return IntentClassification(intent=intent, reasoning="heuristic fallback")


def _heuristic_plan(query: str, intent: str) -> list[PlanStep]:
    store_id = extract_store_id(query)
    order_id = extract_order_id(query)
    if intent == "policy":
        return [PlanStep(tool="search_company_docs", arguments={"query": query})]
    if intent == "prediction":
        if order_id is not None:
            return [PlanStep(tool="get_delivery_prediction", arguments={"order_id": order_id})]
        if store_id is not None:
            return [PlanStep(tool="get_demand_forecast", arguments={"store_id": store_id})]
        return [PlanStep(tool="list_active_anomalies", arguments={})]
    if intent == "analytics":
        if store_id is not None:
            return [PlanStep(tool="get_store_metrics", arguments={"store_id": store_id})]
        return [PlanStep(tool="get_kpi_summary", arguments={})]
    if intent == "mixed":
        first = (
            PlanStep(tool="get_store_metrics", arguments={"store_id": store_id})
            if store_id is not None
            else PlanStep(tool="get_kpi_summary", arguments={})
        )
        return [first, PlanStep(tool="search_company_docs", arguments={"query": query})]
    return []


def _extract_json(text: str) -> Any | None:
    """Parse the first JSON object in `text`, tolerating small-model quirks.

    Two observed behaviours of local models, both handled here:
    - trailing garbage after a complete object (whitespace runs, markdown
      fences) — ``raw_decode`` stops at the end of the first complete value;
    - a missing final closing brace when generation was cut mid-padding —
      up to a few ``}`` are appended as completion candidates. Every result
      is schema-validated by the caller, so a wrong completion simply falls
      back like any malformed reply.
    """
    start = text.find("{")
    if start == -1:
        return None
    candidate = text[start:]
    for suffix in ("", "}", "}}", "}}}", "}}}}"):
        try:
            obj, _end = json.JSONDecoder().raw_decode(candidate + suffix)
            return obj
        except json.JSONDecodeError:
            continue
    return None


def _evidence_for_prompt(evidence: list[dict[str, Any]]) -> str:
    payload = json.dumps(evidence, indent=2, default=str)
    if len(payload) > EVIDENCE_PROMPT_CHAR_CAP:
        head = payload[:EVIDENCE_PROMPT_CHAR_CAP]
        return f"{head}\n... [evidence truncated at {EVIDENCE_PROMPT_CHAR_CAP} chars]"
    return payload


# --------------------------------------------------------------------------- #
# Graph
# --------------------------------------------------------------------------- #


class AgentGraph:
    """Owns the LangGraph nodes; bound methods are the node callables."""

    def __init__(
        self,
        llm: LLMClient,
        registry: ToolRegistry,
        *,
        max_steps: int = DEFAULT_MAX_STEPS,
        artifacts_dir: Path,
    ) -> None:
        self._llm = llm
        self._registry = registry
        self._max_steps = max_steps
        self._artifacts_dir = artifacts_dir

    # -- nodes ---------------------------------------------------------------
    def classify(self, state: AgentState) -> dict[str, Any]:
        request_id = state.get("request_id") or uuid4().hex
        query = state["user_query"].strip()
        if not query:
            return {
                "request_id": request_id,
                "intent": "unsupported",
                "intent_reasoning": "empty request",
                "selected_tools": [],
                "plan": [],
                "errors": ["request was empty or whitespace"],
            }
        messages = [
            {"role": "system", "content": INTENT_ROUTING_PROMPT.format(
                schema=ANSWER_SCHEMA_HINT, query=query)},
            {"role": "user", "content": f"Classify this request: {query}"},
        ]
        errors = list(state.get("errors", []))
        try:
            raw = self._llm.chat(messages, json_mode=True, max_tokens=1200)
            parsed = _extract_json(raw)
            classification = IntentClassification.model_validate(parsed)
        except (LLMError, ValidationError, TypeError) as exc:
            errors.append(f"intent classification fallback: {exc}")
            classification = _heuristic_intent(query)
        known = [t for t in classification.tools if t in set(self._registry.names)]
        return {
            "request_id": request_id,
            "intent": classification.intent,
            "intent_reasoning": classification.reasoning,
            "selected_tools": known,
            "errors": errors,
        }

    def plan(self, state: AgentState) -> dict[str, Any]:
        query = state["user_query"].strip()
        intent = state.get("intent", "unsupported")
        errors = list(state.get("errors", []))
        if intent == "unsupported":
            return {"plan": [], "needs_clarification": False}
        if has_unresolvable_store_reference(query):
            errors.append("store reference could not be resolved; asking for clarification")
            return {"plan": [], "needs_clarification": True, "errors": errors}
        messages = [
            {"role": "system", "content": PLAN_PROMPT.format(
                intent=intent, max_steps=self._max_steps, query=query)},
            {"role": "user", "content": f"Plan for this request: {query}"},
        ]
        try:
            raw = self._llm.chat(messages, json_mode=True, max_tokens=1600)
            draft = PlanDraft.model_validate(_extract_json(raw))
            steps = draft.steps
        except (LLMError, ValidationError, TypeError) as exc:
            errors.append(f"planning fallback: {exc}")
            steps = _heuristic_plan(query, intent)
        # Keep only steps that name a real tool; record the drops.
        valid: list[PlanStep] = []
        for step in steps:
            if step.tool in set(self._registry.names):
                valid.append(step)
            else:
                errors.append(f"planned tool {step.tool!r} is not available; step dropped")
        return {
            "plan": [s.model_dump() for s in valid[: self._max_steps]],
            "needs_clarification": False,
            "errors": errors,
        }

    def run_tool_step(self, state: AgentState) -> dict[str, Any]:
        plan = list(state.get("plan", []))
        step_no = int(state.get("step_count", 0)) + 1
        errors = list(state.get("errors", []))
        tool_results = list(state.get("tool_results", []))
        evidence = list(state.get("evidence", []))
        tool_trace = list(state.get("tool_trace", []))
        if not plan:
            return {"step_count": step_no}
        step, remaining = plan[0], plan[1:]
        name = step["tool"]
        arguments = step.get("arguments") or {}
        trace_entry = {
            "step": step_no,
            "tool": name,
            "arguments_summary": json.dumps(arguments, default=str)[:200],
        }
        try:
            result = self._registry.execute(name, arguments)
        except ToolError as exc:
            errors.append(f"{name} failed: {exc}")
            trace_entry["result_summary"] = f"ERROR: {exc}"[:300]
            tool_trace.append(trace_entry)
            return {
                "plan": remaining,
                "step_count": step_no,
                "errors": errors,
                "tool_results": tool_results,
                "evidence": evidence,
                "tool_trace": tool_trace,
            }
        tool_results.append({"tool": name, "result": result})
        if isinstance(result.get("evidence"), dict):
            evidence.append({"tool": name, **result["evidence"]})
        trace_entry["result_summary"] = str(result.get("summary", ""))[:300]
        tool_trace.append(trace_entry)
        return {
            "plan": remaining,
            "step_count": step_no,
            "errors": errors,
            "tool_results": tool_results,
            "evidence": evidence,
            "tool_trace": tool_trace,
        }

    def gate_action(self, state: AgentState) -> dict[str, Any]:
        if state.get("needs_clarification") or state.get("intent") == "unsupported":
            return {}
        query = state["user_query"].strip()
        evidence = state.get("evidence", [])
        errors = list(state.get("errors", []))
        # Cheap deterministic pre-filter: skip the LLM call entirely unless the
        # request actually asks for an operational action.
        if not any(keyword in query.lower() for keyword in ACTION_KEYWORDS):
            return {"errors": errors}
        messages = [
            {"role": "system", "content": ACTION_PROMPT.format(
                query=query, evidence=_evidence_for_prompt(evidence))},
            {"role": "user", "content": f"Action decision for: {query}"},
        ]
        try:
            raw = self._llm.chat(messages, json_mode=True, max_tokens=1200)
            draft = ActionDraft.model_validate(_extract_json(raw))
        except (LLMError, ValidationError, TypeError) as exc:
            errors.append(f"action gate fallback (no proposal): {exc}")
            return {"errors": errors}
        if not draft.wants_action or draft.proposal is None:
            return {"errors": errors}
        try:
            result = self._registry.execute(
                "create_restock_proposal", draft.proposal.model_dump()
            )
        except ToolError as exc:
            errors.append(f"create_restock_proposal failed: {exc}")
            return {"errors": errors}
        proposal = result["evidence"]
        evidence = [*evidence, {"tool": "create_restock_proposal", **proposal}]
        tool_trace = list(state.get("tool_trace", []))
        tool_trace.append({
            "step": len(tool_trace) + 1,
            "tool": "create_restock_proposal",
            "arguments_summary": json.dumps(draft.proposal.model_dump(), default=str)[:200],
            "result_summary": str(result.get("summary", ""))[:300],
        })
        return {
            "proposal": proposal,
            "evidence": evidence,
            "tool_trace": tool_trace,
            "errors": errors,
        }

    def write_answer(self, state: AgentState) -> dict[str, Any]:
        if state.get("needs_clarification"):
            return {"answer": CLARIFICATION_ANSWER}
        evidence = state.get("evidence", [])
        if state.get("intent") == "unsupported" and not evidence:
            return {"answer": UNSUPPORTED_ANSWER}
        query = state["user_query"].strip()
        messages = [
            {"role": "system", "content": ANSWER_PROMPT.format(
                query=query, evidence=_evidence_for_prompt(evidence),
                schema=ANSWER_SCHEMA_HINT)},
            {"role": "user", "content": f"Answer this request from the evidence: {query}"},
        ]
        try:
            raw = self._llm.chat(messages, json_mode=True, max_tokens=2600)
            draft = AnswerDraft.model_validate(_extract_json(raw))
            return {"answer": draft.answer}
        except (LLMError, ValidationError, TypeError) as exc:
            errors = [*state.get("errors", []), f"answer fallback: {exc}"]
            fallback = self._fallback_answer(state)
            return {"answer": fallback, "errors": errors}

    def persist_trace(self, state: AgentState) -> dict[str, Any]:
        request_id = state.get("request_id") or uuid4().hex
        finished = datetime.now(UTC).isoformat()
        trace = {
            "request_id": request_id,
            "session_id": state.get("session_id"),
            "started_at": state.get("started_at"),
            "finished_at": finished,
            "prompt_version": PROMPT_VERSION,
            "user_query": state.get("user_query"),
            "intent": state.get("intent"),
            "intent_reasoning": state.get("intent_reasoning"),
            "selected_tools": state.get("selected_tools", []),
            "steps_used": state.get("step_count", 0),
            "max_steps": state.get("max_steps", self._max_steps),
            "tool_trace": state.get("tool_trace", []),
            "tool_results": state.get("tool_results", []),
            "evidence": state.get("evidence", []),
            "proposal": state.get("proposal"),
            "errors": state.get("errors", []),
            "answer": state.get("answer"),
        }
        path = self._artifacts_dir / f"{request_id}.json"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(trace, indent=2, default=str), encoding="utf-8")
        except OSError as exc:
            # A missing trace must not lose the answer; the failure is visible.
            logger.warning("agent.trace_write_failed", request_id=request_id, error=str(exc))
            return {"trace_path": None, "finished_at": finished,
                    "errors": [*state.get("errors", []), f"trace write failed: {exc}"]}
        return {"trace_path": str(path), "finished_at": finished}

    # -- internals -------------------------------------------------------------
    @staticmethod
    def _fallback_answer(state: AgentState) -> str:
        evidence = state.get("evidence", [])
        if not evidence:
            return UNSUPPORTED_ANSWER
        lines = [
            "The answer generator did not return a usable reply; here is exactly "
            "what the tools returned, uninterpreted:"
        ]
        for item in evidence:
            summary = json.dumps(item, default=str)[:500]
            lines.append(f"- {summary}")
        return "\n".join(lines)

    # -- routing -----------------------------------------------------------------
    def _route_after_plan(self, state: AgentState) -> str:
        if state.get("needs_clarification") or not state.get("plan"):
            return "answer"
        return "tools"

    def _route_after_tools(self, state: AgentState) -> str:
        if state.get("plan") and state.get("step_count", 0) < state.get(
            "max_steps", self._max_steps
        ):
            return "tools"
        return "action"


def build_graph(
    llm: LLMClient,
    registry: ToolRegistry,
    *,
    max_steps: int = DEFAULT_MAX_STEPS,
    artifacts_dir: Path,
) -> Any:
    """Compile the agent graph (returns a LangGraph Runnable)."""
    agent = AgentGraph(llm, registry, max_steps=max_steps, artifacts_dir=artifacts_dir)
    graph = StateGraph(AgentState)
    graph.add_node("classify", agent.classify)
    graph.add_node("plan", agent.plan)
    graph.add_node("tools", agent.run_tool_step)
    graph.add_node("action", agent.gate_action)
    graph.add_node("answer", agent.write_answer)
    graph.add_node("trace", agent.persist_trace)
    graph.add_edge(START, "classify")
    graph.add_edge("classify", "plan")
    graph.add_conditional_edges("plan", agent._route_after_plan,
                                {"tools": "tools", "answer": "answer"})
    graph.add_conditional_edges("tools", agent._route_after_tools,
                                {"tools": "tools", "action": "action"})
    graph.add_edge("action", "answer")
    graph.add_edge("answer", "trace")
    graph.add_edge("trace", END)
    return graph.compile()


def initial_state(user_query: str, session_id: str | None = None,
                  max_steps: int = DEFAULT_MAX_STEPS) -> AgentState:
    return {
        "user_query": user_query,
        "session_id": session_id,
        "intent": "unsupported",
        "plan": [],
        "selected_tools": [],
        "tool_results": [],
        "tool_trace": [],
        "evidence": [],
        "proposal": None,
        "errors": [],
        "step_count": 0,
        "max_steps": max_steps,
        "needs_clarification": False,
        "started_at": datetime.now(UTC).isoformat(),
    }
