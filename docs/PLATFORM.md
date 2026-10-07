# QuickCart Intelligence Platform

A local-first, zero-cost quick-commerce intelligence system. Operational data flows from PostgreSQL through a Spark/Delta medallion lakehouse into analytics, ML, RAG, a bounded agentic assistant, and two distinct front ends — an **Operations console** for engineers and ops, and a plain-language **Business layer** for managers and leadership.

> Everything runs on a laptop. No cloud account, no paid API, and no managed data platform is required to see the whole system end to end.

---

## Contents

- [What QuickCart is](#what-quickcart-is)
- [Two experiences, one app](#two-experiences-one-app)
- [Personas](#personas)
- [User journeys](#user-journeys)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Data layers](#data-layers)
- [Semantic metrics and the business API](#semantic-metrics-and-the-business-api)
- [Identity and RBAC](#identity-and-rbac)
- [Assistant v2 and voice](#assistant-v2-and-voice)
- [Proposals and action governance](#proposals-and-action-governance)
- [Run it locally](#run-it-locally)
- [Phase 16 — Business Experience](#phase-16--business-experience)
- [Success metrics and limitations](#success-metrics-and-limitations)

---

## What QuickCart is

QuickCart simulates a quick-commerce ("q-commerce") business — dark stores, riders, orders, inventory, promotions — and then treats that business as a complete, inspectable data platform.

The point is not the demo data. The point is the **pipeline**: a deterministic simulator produces realistic operational events in PostgreSQL; change data capture and batch jobs move those events through a Delta Lake medallion; ML models, a RAG store, and an agent sit on top; and a serving read model makes it all fast enough to answer a manager's question in milliseconds.

Three principles hold everywhere:

- **Local-first** — the full stack boots with Docker and `uv` on one machine.
- **Zero-cost by default** — no AWS/GCP/Azure, Databricks, Snowflake, Confluent Cloud, or paid LLM is needed to run it.
- **Grounded and governed** — numbers come from data, the assistant cannot invent figures, and high-impact actions require a human tap.

---

## Two experiences, one app

QuickCart ships **one application with two front doors**. Your role decides where you land after login.

| | Operations console | Business layer |
|---|---|---|
| **Route** | `/` | `/b/*` |
| **Audience** | Engineers, ops, inventory, analysts | Executives, city/store/category managers, leadership |
| **Shell** | `app-shell.tsx` | `BusinessShell` |
| **Language** | Technical — Delta, SQL, lineage, SSE, models | Plain English — Sales, Average basket, Running low |
| **Primary jobs** | Inspect the pipeline, run SQL, watch live streams, approve proposals | See the day, spot what needs attention, ask questions, approve suggestions |

The two are deliberately connected. An **ExperienceSwitcher** maps a business screen to its nearest ops screen and back (for example `/b/stores` ↔ `/map`, `/b/actions` ↔ `/proposals`, `/b/ask` ↔ `/agent`), so a technical user can jump from a manager's view straight into the underlying system.

### Operations console (`/`)

The ops console exposes the platform itself. Pages include the live overview (`/`), the agent console (`/agent`), the interactive system map (`/map`), live streaming (`/live`), data and database explorers (`/data`, `/database`, `/cube`, `/query`), the medallion layers and lineage (`/layers`, `/lineage`), ML (`/ml`), proposals (`/proposals`), logs (`/logs`), the Streamlit dashboard embed (`/streamlit`), and reference pages for architecture, tech, tooling, roadmap, and trust.

### Business layer (`/b/*`)

The business layer hides every piece of jargon and answers the questions a manager actually asks. The left rail (desktop) and bottom tabs (mobile) cover:

| Route | Purpose |
|---|---|
| `/b/welcome` | 7-step onboarding wizard |
| `/b/today` | Morning briefing and the state of the day |
| `/b/stores`, `/b/stores/[id]` | Store league table and per-store scorecard |
| `/b/products` | Running low · Best sellers · Slow movers |
| `/b/delivery` | On-time rate and delivery-time health |
| `/b/money` | Sales, discounts, refunds, margin |
| `/b/targets` | Month-to-date pacing vs plan |
| `/b/customers` | Who is ordering; cohorts and health |
| `/b/ask` | Full assistant surface |
| `/b/actions` | Suggestions waiting for a decision |
| `/b/reports` | Saved reports and digests |
| `/b/learn` | Guided journeys and a plain-language glossary |
| `/b/settings` | Preferences and credits |

On mobile the tabs are **Today · Stores · Ask (centre orb) · Actions · More**. The ops `ControlDock` is not mounted under `/b` — the bottom-right corner belongs to the assistant character.

---

## Personas

Business personas (P5–P9) are the audience for `/b/*`. Operations personas (P1–P4) keep the console at `/`.

| ID | Role | Tech comfort | Primary screens | Example question |
|---|---|---|---|---|
| **P5** | Business Executive (front-line) | 2/5 | `/b/today`, `/b/actions`, `/b/ask` | "What needs me before noon?" |
| **P6** | City Business Manager | 3/5 | `/b/stores`, `/b/targets`, `/b/money` | "Am I on track this month?" |
| **P7** | Dark Store Manager | 2/5 | `/b/stores/[id]`, `/b/products` (mobile) | "What runs out in four hours?" |
| **P8** | Category Manager | 3/5 | `/b/products`, category filters | "Did the promo lift units?" |
| **P9** | Leadership / CXO | 2/5 | `/b/today`, `/b/reports`, voice | "City comparison? MTD vs target?" |

| ID | Role | Console | Needs |
|---|---|---|---|
| **P1** | Learner / developer | `/` | Understand and implement every layer |
| **P2** | Operations manager | `/` | Concise view of active operational problems |
| **P3** | Inventory manager | `/` | Restock proposals and anomaly alerts |
| **P4** | Analyst | `/` | SQL access and consistent business metrics |

Each business persona is scope-limited. A store manager sees one store; a city manager sees their city; leadership sees the company. Scope is enforced server-side on every request, tool call, and voice action — never by prompt alone.

---

## User journeys

The business layer ships guided **journeys** that walk a persona through a real question on real screens. Each step has a question as its title, navigates to the actual screen, dims the rest with a spotlight, and explains the result in ≤2 sentences using the user's own numbers. Voice can narrate.

- **A — "How did my store do yesterday?"** Sales → delivery → bestsellers → today's actions.
- **B — "What's about to run out?"** Find low stock → draft a restock suggestion (PENDING).
- **C — "Why are deliveries late?"** Hour → store → pack vs ride → riders → flag ops.
- **D — "Did my promo work?"** Units lifted vs discount given.
- **E — "Prepare my weekly review."** Auto-drafted report.

**End-to-end example (P7, Dark Store Manager, 8:00 a.m.):**

1. Opens `/b/today`, hears a one-paragraph morning briefing.
2. "Needs your attention" flags two SKUs that run out before lunch.
3. Taps a card → journey B drafts a **restock suggestion**.
4. Reviews the suggested quantity, taps **Approve** — the action moves from PENDING to approved, logged against the manager as principal.
5. Asks the orb, "Why were we late yesterday?" The assistant returns a verified answer card; the manager flags ops if needed.

---

## Architecture

```
PostgreSQL (operational source of truth)
   │  CDC (Debezium) ──► Redpanda (Kafka-compatible broker)
   ▼
Raw Delta  ──►  Bronze  ──►  Silver  ──►  Gold (marts, ML outputs)
                                             │
                                             ▼
                              Serving read model (Postgres serving.*)
                                             │
                               FastAPI ──────┤──── /api/v1/b/*  (business)
                                             └──── /api/v1/*    (ops, agent, live, SQL)
                                             │
                         ┌───────────────────┴───────────────────┐
                    Next.js console (/)                 Next.js business (/b/*)
```

Three data motions coexist:

- **Batch medallion** — Spark jobs transform raw → bronze → silver → gold with Delta ACID, MERGE, SCD2, and optimization. Airflow orchestrates the batch workflows.
- **Live streaming** — a continuous writer/worker keeps the operational store and live views moving; the ops console streams events over SSE (`/live`).
- **Serving read model** — after each gold refresh, a snapshot job writes plain-language, pre-computed metrics into Postgres `serving.*` tables. The business API reads **Postgres, not Spark**, which is what makes `/b/today` fast.

The medallion is the analytical storage model; PostgreSQL remains the operational source of truth; the serving layer is the fast, read-only face the business app talks to.

---

## Tech stack

| Layer | Technology | Role |
|---|---|---|
| Language / JVM | Python 3.12, Java 17 | Simulation, ETL, ML, APIs, agents; Spark runtime |
| Operational DB | PostgreSQL | Source of truth and serving read model |
| Compute | PySpark 4.2 | Batch and streaming transforms |
| Lakehouse | Delta Lake 4.4 | ACID tables, MERGE, time travel |
| Object storage | S3-compatible (SeaweedFS locally) | Lakehouse storage |
| Streaming | Redpanda + Debezium | Kafka-compatible broker and CDC |
| Orchestration | Airflow | Batch workflow scheduling |
| ML | Spark MLlib + MLflow | Models with predictions written back to Gold |
| Retrieval | Qdrant + local embeddings | RAG over unstructured docs |
| LLM | Gemini (opt-in) / Ollama (local fallback) | Assistant text + Gemini Live voice |
| API | FastAPI | Single service boundary |
| Frontend | Next.js + shadcn (Geist, steel-blue) | Ops console and business layer |
| Dashboard | Streamlit | Operations dashboard |

**Deployment.** The default is local. An optional short-lived **AWS EC2** demo runs the backend, continuous writer/worker, Next.js, and Streamlit as systemd services with PostgreSQL / Redpanda / Qdrant in Docker (`scripts/aws_demo/`). The Next.js front end can also deploy to **Vercel** (`frontend/vercel.json`). Neither is required to run or evaluate the platform.

The LLM choice honors the local-first rule: with `GEMINI_API_KEY` set, the assistant uses Gemini (and Live voice); without it, text falls back to local Ollama and voice is hidden.

---

## Data layers

| Layer | What it holds |
|---|---|
| **Raw** | Faithful copy of operational tables and event streams as Delta |
| **Bronze** | Typed, deduplicated, append-only ingestion |
| **Silver** | Cleaned, conformed, business-keyed entities (orders, items, deliveries, ratings, wastage) |
| **Gold** | Analytical marts and ML outputs |
| **Serving** | Pre-computed, plain-language snapshots in Postgres for the business app |

**Gold business marts** (added in Phase 16, beyond the core five): `gold_store_scorecard_daily`, `gold_margin_daily`, `gold_category_daily`, `gold_wastage_daily`, `gold_customer_health_daily`, `gold_promo_daily`, plus rider productivity and supplier performance.

**Serving tables** (migration `V008`): `serving.metric_daily`, `serving.metric_hourly`, `serving.store_scorecard`, `serving.category_daily`, `serving.snapshot_runs`. The snapshot job (`quickcart.business.snapshot`) runs after the gold refresh and also upserts `serving.margin_daily` from Postgres.

Invalid data is never silently discarded — quality rules quarantine bad records rather than dropping them.

---

## Semantic metrics and the business API

A single **semantic registry** is the source of truth for every metric.

- `src/quickcart/semantics/metrics.yaml` + `registry.py` define each metric's key, plain label, formula, unit, Gold source, direction, thresholds, explainers, synonyms, and drivers.
- The same registry feeds the API, the agent, the UI glossary, and the generated `docs/data_dictionary/metrics.md`. This removes the classic bug of two screens computing "late rate" differently.

The **business API** lives under `/api/v1/b/` (`src/quickcart/api/business/`). It reads the serving model with a read-only connection per request and returns plain-language payloads. Every metric value has the shape:

```text
MetricValue { label, value, display, delta_pct, compare_to, status, explanation, as_of }
```

Explanations are deterministic templates — never free LLM text. Endpoints include:

| Endpoint | Returns |
|---|---|
| `GET /api/v1/b/today` | Morning briefing + headline tiles |
| `GET /api/v1/b/stores/scorecards` | Store league table |
| `GET /api/v1/b/stores/{store_id}` | Store detail (needs `drill:store`) |
| `GET /api/v1/b/products?tab=running_low\|bestsellers\|slow` | Product lists |
| `GET /api/v1/b/delivery/health` | On-time / delivery-time health |
| `GET /api/v1/b/customers/health` | Cohort / customer health |
| `GET /api/v1/b/money` | Sales, discounts, refunds, margin |
| `GET /api/v1/b/targets` | MTD pacing vs plan |
| `GET /api/v1/b/alerts` | Open alerts |
| `GET /api/v1/b/reports` · `POST /api/v1/b/reports` | List / create saved reports |
| `GET /api/v1/b/metrics` · `GET /api/v1/b/metrics/{key}/explain` | Catalog and deterministic explainer |
| `GET /api/v1/b/journeys` · `GET /api/v1/b/journeys/{id}/steps/{n}` | Guided journey content |

The whole router requires `kpi:read`; single-store drill-down additionally requires `drill:store`.

---

## Identity and RBAC

Migration `V007` introduces users, roles, permissions, scopes, preferences, sessions, and an audit trail. Sessions are JWT in an httpOnly cookie; the frontend uses middleware and a same-origin `/qc-api` rewrite.

- **Roles:** `business_exec`, `city_manager`, `store_manager`, `category_manager`, `leadership`, `ops_manager`, `inventory_manager`, `admin`.
- **Scopes:** `company` · `city` · `store` · `category` — enforced server-side on every REST, agent, and voice tool call.
- **Key rules:** business roles never receive `sql:execute` / `copilot:sql_tool`; the approver is always the logged-in principal; admins cannot approve their own proposals.

With `auth_enforce` off (the default for easy local use), an anonymous caller is treated as a synthetic admin so the console works unauthenticated. With it on, a valid session cookie carrying the required permission is mandatory. Scope-leak tests cover REST, the text agent, and the voice tool bridge.

---

## Assistant v2 and voice

The assistant's contract is simple: **the model writes words, the server renders numbers.**

**Text.** Assistant v2 uses a native `google-genai` function-calling loop with a scoped `ToolRegistry`; Ollama keeps a local pipeline fallback. Tools include `get_metric`, `compare_stores`, `explain_metric_change`, `get_briefing`, `get_alerts`, `get_targets_progress`, `draft_action` (drafts PENDING only), and `build_report` — all RBAC- and scope-clamped in `ToolRegistry.execute`.

Answers follow the `AnswerDraft` contract — a headline referencing tool results only (e.g. `{{c1.value}}`), ≤3 bullets, typed cards (`kpi`, `trend`, `compare`, `table`, `risk_list`, `proposal`), and ≤3 follow-ups. **Provenance** is checked: every numeric reference must resolve to a tool result; one repair attempt is allowed, then the assistant falls back to cards only. Streaming SSE adds `tool_start`, `card`, and `followups` events.

Surfaces: `/b/ask`, ⌘K Ask (prefix a query with `?`), "Ask about this" on any tile (passes structured context), and voice — all sharing one conversation via `AssistantProvider`.

**Voice (opt-in).** The **Matrix Orb** (credited to Rare UI) plus a monochrome SVG face is the assistant's body; the mouth and eyes are driven by live audio level. `POST /api/v1/voice/session` mints single-use ephemeral tokens; the browser connects over WSS to Gemini Live (PCM 16 kHz in / 24 kHz out); tool calls route to `POST /api/v1/assistant/tools/{name}` with the session cookie and push cards on-screen. Push-to-talk is the default; hands-free is optional. If there is no key, a blocked socket, or a denied mic, the UI shows a text-only banner and voice hides gracefully. Reduced-motion users get a static orb.

---

## Proposals and action governance

AI can **draft** but never **approve**.

- The assistant and journeys can only create proposals in the **PENDING** state (`draft_action`).
- Approval requires an on-screen tap by a permitted user. **Voice alone can never approve** an action.
- The approver recorded is always the logged-in principal; admins cannot approve.
- Business users review suggestions at `/b/actions`, which maps to the ops `/proposals` surface.

Proposals v2 (`V017`) widens proposal types beyond RESTOCK. Today, non-RESTOCK types **stub-execute** (audit only) until full applicators land, so every decision is still logged even when no automated side effect runs yet.

---

## Run it locally

Prerequisites: Git, Docker (with Compose), Python 3.12 + `uv`, Java 17.

```bash
make setup                               # uv sync + .env
make core-up && make db-init && make seed-smoke

uv run python -m quickcart.identity.seed       # persona users
uv run python -m quickcart.simulator.business  # business data
uv run python -m quickcart.business.snapshot   # serving read model
uv run python -m quickcart.business.alerts     # alerts engine

uv run python -m quickcart.api                 # FastAPI :8000 (docs at /docs)
cd frontend && npm install && npm run dev       # Next.js :3000
```

Optional extras: `make storage-up` (S3), `make streaming-up` (Redpanda + Debezium), Airflow / MLflow / Qdrant via their compose profiles, and `uv run streamlit run dashboard/app.py` for the ops dashboard.

**Demo logins** (password `quickcart`): `exec@quickcart.local`, `city.blr@quickcart.local`, `store8@quickcart.local`, and the other seeded personas.

**Tips.** Business ⌘K opens Ask/jump — prefix with `?` to ask. Metric tiles expose "Ask about this." Set `VOICE_ENABLED=true` and `GEMINI_API_KEY` for the talking character. Measure Today latency with `uv run python -m quickcart.business.bench_today`.

**Checks.**

```bash
uv run ruff check .
uv run pytest
make clean-clone-check                   # uv sync + ruff + pytest + frontend typecheck/vitest
```

---

## Phase 16 — Business Experience

Phase 16 added the entire business layer on top of the completed Phases 0–15 platform. It shipped in eight slices:

| Slice | Delivered |
|---|---|
| **B0** Governance | Design spec, PRD personas P5–P9 (FR-033–FR-045), ADR-002/003/004, plan + task checklist |
| **B1** Identity & RBAC | `V007`, `src/quickcart/identity/`, JWT cookie auth, principal/permission/scope deps, persona seeds, scope-leak tests |
| **B2** Semantic + serving | `metrics.yaml` registry, `V008` serving tables, snapshot job, `/api/v1/b/*`, measured Today p95 |
| **B3** Business UI | `(business)/b` shell + ExperienceSwitcher, onboarding, Today/core screens, journeys A–C, formatters, Vitest |
| **B4** Assistant v2 (text) | `google-genai` tool loop, scoped ToolRegistry, answer cards + provenance, Ask/⌘K, eval set |
| **B5** Voice | Matrix Orb + SVG face, Gemini Live ephemeral sessions, tool bridge, fallbacks, fake-Live tests |
| **B6** Data wave 1 | `V009`–`V013` (costs, targets, refunds/wastage, promos, ratings), simulator + Gold marts, Targets/Money, journey D |
| **B7** Data wave 2 + actions | `V014`–`V018` (alerts, suppliers/POs, rider shifts, proposals v2, CDC), notifications, Mailpit digests, journey E |
| **B8** Hardening | Playwright persona + voice flows, ESLint/typecheck in CI, WCAG AA + reduced motion, clean-clone |

Benchmarks are treated as **settings**, not hardcoded industry numbers: the simulator runs ~50 orders/store/day with 25–40 min delivery promises, and status is computed against same-weekday-last-week / 4-week averages and configurable targets.

---

## Success metrics and limitations

**Targets**

- Onboarding completion ≥ 80% of first-run demo users.
- Time-to-first-answer (guided or Ask) < 60 s.
- `/b/today` p95 < 150 ms locally — measured at mean 8.3 ms / p95 10.0 ms (2026-10-07 local smoke).
- Business eval set: ≥ 90% tool/card accuracy, 100% answer-contract compliance, **zero** scope leaks.
- Voice session succeeds (setup → first audio) when a key is present, and hides gracefully when absent.
- Proposal approval always comes from the principal; never auto-approved by voice.

**Limitations**

- Non-RESTOCK proposal types stub-execute (audit only) until full applicators land.
- `silver_wastage_events` / `silver_order_ratings` are optional; Gold writes empty wastage until the CDC silver layer lands.
- Playwright browsers are installed locally; CI runs typecheck + vitest.
- **English only** in this release (voice may understand Hinglish via Gemini when enabled).
- The AWS demo instance is not free and not production-hardened — destroy it after use.

---

*The Matrix Orb is modelled on [Rare UI Matrix Orb](https://www.rareui.com/components/matrixorb); attribution appears in Settings → About and the Ask footer. Full specification package lives in [`kit/`](../kit/README.md).*
