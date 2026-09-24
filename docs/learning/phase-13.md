# Phase 13 — LangGraph agent

## What was built

- **`src/quickcart/agents/` package** — the bounded operations assistant
  (kit/03 §13, kit/05 §14: an orchestrator, not an unrestricted executor):
  - `llm.py` — `LLMClient` protocol + `OllamaLLM` (the `ollama` Python
    package, temperature 0, transport timeout, `LLMError` on failure, optional
    `max_tokens` → `num_predict` budget, one retry on empty content). Model
    name and base URL come only from `Settings.ollama_model` /
    `Settings.ollama_base_url` (env `OLLAMA_MODEL` / `OLLAMA_BASE_URL`) —
    never hard-coded. qwen3-style thinking stays enabled: the reasoning is
    separated from content server-side and the stage outputs parse far more
    reliably; `max_tokens` only bounds the reasoning budget. The protocol is
    injected everywhere, so tests and the eval suite run with zero Ollama
    and zero network.
  - `prompts.py` — versioned prompt constants (`PROMPT_VERSION = "1.0.0"`):
    system routing, planning, action gate, and grounded-answer prompts.
    Bracketed stage tags (`[INTENT]`/`[PLAN]`/`[ACTION]`/`[ANSWER]`) are part
    of the contract the `FakeLLM` dispatches on.
  - `tools.py` — typed tools with Pydantic argument schemas
    (`kit/03 §13.2`): `get_store_metrics`, `get_kpi_summary`,
    `get_inventory_risk`, `get_delivery_prediction`, `get_demand_forecast`,
    `list_active_anomalies`, `search_company_docs` (delegates to the Phase 12
    `Retriever.grounded_search` — explicit-uncertainty contract preserved),
    `create_restock_proposal` (delegates to Phase 14 `ProposalService`; can
    only create a PENDING proposal, never execute — AR-006), and the bounded
    `run_readonly_sql` escape hatch. Backends are injected through `ToolDeps`
    behind small protocols, so fakes satisfy the same shapes.
  - `graph.py` — LangGraph state machine with the §13.4 state fields
    (`request_id`, `user_query`, `intent`, `plan`, `selected_tools`,
    `tool_results`, `evidence`, `answer`, `proposal`, `errors`,
    `step_count`). Flow: START → classify (analytics | policy | prediction |
    mixed | unsupported) → bounded plan → tool loop (one step per node visit,
    hard cap 5 — AR-003; `ToolError` lands in `state.errors` and the loop
    degrades transparently) → action gate (proposal creation only through the
    proper tool; a cheap deterministic keyword pre-filter skips the gate LLM
    call entirely when the request contains no action language) → grounded
    answer (the LLM prompt contains *only* retrieved facts; insufficient
    evidence produces an explicit uncertainty answer, never fabrication —
    AR-005/RAGR-004) → JSON trace persisted per request at
    `data/artifacts/agent_traces/<request_id>.json`. Every LLM interaction
    falls back to deterministic heuristics on malformed JSON or LLM outage,
    recording the fallback in `state.errors`; the plan parser tolerates
    models that wrap the plan (`{"plan": {"steps": [...]}}`), and the JSON
    extractor stops at the first complete value via `raw_decode` because
    small models pad their reply with whitespace after the object.
  - `service.py` — `chat(message, session_id=None) -> {"answer", "evidence",
    "tool_trace", ...}`, the exact contract `src/quickcart/api/app.py` calls.
    Graph/retriever/LLM are built lazily and cached; genuine infrastructure
    failure is logged loudly and returns a degraded shape (`degraded: true`,
    empty evidence) rather than a silent success.
  - `cli.py` — `uv run python -m quickcart.agents.cli "<question>"` prints
    the answer, evidence summary, tool trace, and trace path.
  - `eval_suite.py` — the kit/07 §8 evaluation harness: a deterministic
    keyword-driven `FakeLLM` + in-memory fake backends, so the whole suite
    passes offline. 17 cases across tool routing (incl. the wrong-tool trap:
    refund-policy questions never touch SQL), grounding, safety (mutating /
    stacked / comment-bypass / split-keyword SQL rejected; oversized results
    capped at 500 rows), resilience (failed tool → recorded error, surviving
    evidence still used), ambiguity ("store eight" → id 8; "that store" →
    clarification question, no tools run), and the proposal flow (created
    PENDING, never executed). `--live` runs the same suite against the real
    model.
- **SQL guard** (`validate_readonly_sql`, kit/03 §13.3 / kit/02 AR-002) —
  dependency-free, layered: comment stripping that honours string literals →
  stacked-statement rejection → SELECT-only start keyword → whole-word
  blocklist scan on a string-masked safety view (`'DELETE'` inside a literal
  is data, not syntax) → table allow-list (`silver_*`/`gold_*`, CTE-aware) →
  `LIMIT <= 500` (appended when absent). Execution registers Delta temp views
  per referenced table, runs under a named Spark job group with a
  wall-clock timeout, and cancels the group on expiry.

## How to run

```bash
# offline evaluation suite (FakeLLM, no services needed)
uv run python -m quickcart.agents.eval_suite

# live agent (needs compose profiles: core/ai up, data/gold built, Ollama serving $OLLAMA_MODEL)
export OLLAMA_MODEL=qwen3:4b
uv run python -m quickcart.agents.cli "Why are deliveries late at Store 8 today?"

# via the FastAPI boundary (Phase 14)
curl -X POST localhost:8000/api/v1/agent/chat -H 'Content-Type: application/json' \
  -d '{"message": "How is store 8 performing?"}'
```

Traces land in `data/artifacts/agent_traces/<request_id>.json`; eval traces in
`data/artifacts/agent_eval/`.

## How to test

```bash
export JAVA_HOME=$(brew --prefix openjdk@17)
uv run pytest tests/unit/agents/                 # 62 tests, all offline
QUICKCART_RUN_LIVE_AGENT=1 uv run pytest tests/integration/test_agent_live.py -q
uv run ruff check .
```

## Verification executed

- **62 unit tests** (`tests/unit/agents/`): SQL guard matrix (mutating/DDL,
  stacked, comment bypass, split keywords, allow-list, LIMIT enforcement,
  string-literal masking), routing for all five intents + wrong-tool trap,
  tool argument validation, proposal delegation (create-only, PENDING,
  service rejection surfaced), bounded loop cut at exactly 5 steps,
  grounding (evidence present in the LLM prompt, fake answer echoed),
  JSON extraction against model padding/truncation quirks,
  explicit-uncertainty paths, trace persistence, and the `service.chat`
  contract including the loud-degradement path. One test exercises
  `run_readonly_sql` against a real Spark session + Delta table (600 rows →
  capped at 500). All green (`pytest_exit=0`).
- **17/17 evaluation cases** (`uv run python -m quickcart.agents.eval_suite`,
  offline FakeLLM mode): see the case list in `eval_suite.py`.
- **Live integration** (`QUICKCART_RUN_LIVE_AGENT=1 uv run pytest
  tests/integration/test_agent_live.py`): `test_live_analytics_question_uses_real_gold_data`
  and `test_live_unsupported_question_does_not_fabricate` PASSED against the
  real qwen3:4b + real Gold; the policy test SKIPPED by its guard because
  Qdrant's container wedged mid-session (TCP open, HTTP unresponsive;
  OrbStack's daemon control plane hung — restarting it would have bounced
  the shared PostgreSQL other phases use). The policy→RAG path is covered
  offline (routing tests + eval cases) against the real `Retriever`
  contract; Phase 12 verified that same index live at hit-rate 1.0.
- **Live CLI** (`uv run python -m quickcart.agents.cli "How is store 1
  performing? Give me the key metrics."`, real qwen3:4b, real Gold): the
  model-classified analytics intent drove `get_store_metrics` over Spark and
  produced a grounded, value-citing answer; trace persisted. The PRD's
  example question ("Why are deliveries late at store 8 today?") was also
  run end-to-end: it plans `list_active_anomalies`, which raises a visible
  ToolError because Phase 11 prediction tables are not built yet — the
  agent answered with explicit "no evidence" instead of fabricating.
- `uv run ruff check .` — repo-wide pass.

Acceptance gates (kit/07 Phase 13):

| Gate | Status |
|---|---|
| analytics question chooses SQL/analytics tool | PASS (unit routing test + eval `analytics_routing`; live CLI: model-chosen `get_store_metrics` on real Gold) |
| policy question chooses RAG | PASS (unit routing test + eval `policy_routing`, wrong-tool trap included; live Qdrant run blocked by container wedge — guard skipped cleanly) |
| prediction question chooses ML | PASS (unit routing test + eval `prediction_routing`; live run planned `list_active_anomalies` for the delivery-latency question) |
| mixed question can use multiple tools | PASS (unit routing test + eval `mixed_routing`) |
| mutating SQL request rejected | PASS (`test_mutating_and_ddl_statements_rejected`, eval `mutating_sql` — runner never invoked) |
| max-step loop enforced | PASS (`test_plan_wanting_many_steps_is_cut_at_max_steps`, step_count == 5) |
| oversized SQL result limited | PASS (LIMIT guard: `test_sql_tool_executes_against_real_spark_delta`, eval `oversized_sql`) |

## What was learned

- **The orchestrator pattern is mostly about refusal.** Most of the value is
  in what the agent *cannot* do: no shell, no arbitrary SQL, no self-approved
  actions. The SQL guard's layered design (strip → scan masked view →
  allow-list → cap) shows why single-check validation fails: `SEL/**/ECT`
  defeats keyword scans, `'DELETE'` in a string literal defeats naive
  blocklists, and comments defeat everything that runs before stripping.
- **Grounding is a prompt-construction discipline.** The answer node only
  ever sees the evidence JSON; the "insufficient evidence" answer is a
  code path, not a prompt hope. When the RAG floor trips, the uncertainty
  *message* travels through state into the answer prompt, so the model is
  answering "why can't I answer" rather than being trusted to decline.
- **LLM JSON is unreliable; plan for it.** Every node has a deterministic
  fallback (keyword classifier, heuristic planner, evidence dump), and each
  fallback is recorded in `state.errors` — degradation is visible in the
  trace, never silent (kit/05 §4.2).
- **LangGraph's value here is auditability, not autonomy.** One step per
  node visit makes the tool trace a first-class artifact; the per-request
  JSON trace made every eval failure debuggable without a debugger.
- **Small local models follow structure, not nuance — and their failure modes
  are operational, not just textual.** `qwen3:4b` with temperature 0 reliably
  produces the tagged JSON stages *when its reasoning budget fits*: with
  thinking enabled and a bounded `num_predict`, intent/plan parse in seconds;
  when the budget is too tight the content comes back empty, and with
  `think=False` it narrates reasoning into the answer instead. Observed live
  and handled: wrapped plans (`{"plan": ...}` — unwrap validator), JSON
  padded with whitespace runs (`raw_decode` + missing-brace completion),
  invented `order_id: 0` (the `gt=0` argument schema rejects it), occasional
  empty replies (one retry, then the deterministic fallback engages and the
  degradation is recorded in `state.errors`). The agent never fabricates on
  any of these paths — that property came from the graph design, not luck.

## Known limitations

- Intent routing extracts arguments (store id, order id) with regex/word
  numbers; it covers the evaluation set but is not a general NLU layer.
- `run_readonly_sql` validates statically: the allow-list is name-based
  (`silver_*`/`gold_*`), and exotic Spark SQL syntax outside the tested
  matrix may be over- or under-restricted. CTEs are supported; nested
  subqueries in FROM are treated conservatively.
- The statement timeout uses a daemon thread + `cancelJobGroup`; a cancelled
  JVM-side job is best-effort on very small local Spark.
- Prediction tools (`gold_delivery_predictions`, `gold_demand_forecasts`,
  `gold_anomalies`) raise a visible `ToolError` until Phase 11 model outputs
  are built — the agent degrades transparently instead of fabricating.
- The eval `FakeLLM` is keyword-driven; it proves the graph executes routing
  decisions correctly, not that a real model classifies perfectly. The
  `--live` mode and `tests/integration/test_agent_live.py` cover the real
  model but are environment-gated.
- Live latency is seconds-to-minutes per request (Spark session startup plus
  2–4 model calls of ~5–60 s each on this MPS-accelerated Air); the qwen3
  model occasionally returns empty content when its reasoning budget is
  tight — the retry usually rescues it, and the deterministic fallback
  always does. The CLI and live tests are correctness checks, not an
  interactive-chat UX.
- Session memory is out of scope: `session_id` is recorded in the trace but
  the graph is stateless per request.
