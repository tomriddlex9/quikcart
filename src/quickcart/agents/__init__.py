"""Bounded operations agent (kit/03 Phase 13).

The agent is an orchestrator, not an unrestricted executor (kit/05 §14): it
routes a user request to typed tools over Gold analytics, persisted ML
predictions, grounded RAG retrieval, and — when the user asks for an action —
a proposal-creation tool that never executes (human approval, Phase 14).

Public contract (consumed by `quickcart.api.app` and the CLI):

- `service.chat(message, session_id=None)` — the API-facing entry point;
- `graph.build_graph` — the LangGraph state machine;
- `tools.build_registry` — typed, Pydantic-validated tool implementations;
- `llm.LLMClient` / `llm.OllamaLLM` — injectable LLM boundary.
"""
