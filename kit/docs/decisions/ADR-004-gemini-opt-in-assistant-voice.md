# ADR-004 — Gemini as opt-in assistant and Live voice

## Status

Accepted.

## Context

ADR-001 requires a local-first, zero-cost default path. The agent already prefers Gemini when `GEMINI_API_KEY` is set (`src/quickcart/agents/llm.py`), with Grok/Ollama fallbacks. The Business Experience needs (1) grounded text answers with native function calling and structured answer cards, and (2) optional real-time voice via Gemini Live with ephemeral tokens. Shipping a mandatory paid cloud LLM would violate local-first. Passing the API key to the browser would be unsafe. The current OpenAI-compatible Gemini client (URL `?key=`, text-only history) cannot support Gemini multi-turn function calling correctly.

## Decision

- **Gemini remains opt-in.** With no `GEMINI_API_KEY`, text assistant uses the local Ollama (or Grok if configured) path; voice UI is hidden.
- Migrate Gemini text integration to the official `google-genai` SDK for native function calling; keep the existing classify→plan pipeline for Ollama/Grok.
- Voice (`FR-041`): backend `POST /api/v1/voice/session` mints single-use ephemeral tokens with locked model, system instruction, and tool declarations. Browser connects WebSocket directly to Gemini Live; PCM audio stays client-side. Tool calls POST back to FastAPI (`/api/v1/assistant/tools/{name}`) with the user cookie so RBAC/scope still apply. Never expose `NEXT_PUBLIC_GEMINI*` (CI grep).
- Visual presence: Rare UI Matrix Orb + SVG face (`FR-042`); push-to-talk default; reduced-motion safe.
- Safety: voice and text may only create PENDING proposals; approval is always an on-screen principal action.
- Model IDs and voice name live in settings (`src/quickcart/config/settings.py`); circuit-break to Ollama on quota errors.

## Consequences

### Positive

- Local clone without cloud keys still demos the business UI and text assistant
- Ephemeral tokens keep the long-lived API key server-side
- Same tool registry and provenance rules apply to text and voice

### Negative

- Voice and best text quality require a paid/configured Gemini key and network
- Preview Live APIs and quotas need capability maps and usage caps (`llm_usage`)
- Bundle and browser-audio complexity (HTTPS/secure context, sample rates, barge-in)

## Follow-up

Phase 16 B4 (text) and B5 (voice). Aligns with FR-040–FR-042 and the design spec voice section.
