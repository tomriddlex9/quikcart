# QuickCart Implementation Checklist

Use this file as the execution tracker. Check items only after tests/acceptance criteria pass.

## Phase 0 — Environment

- [x] Initialize `uv` project
- [x] Create `pyproject.toml`
- [x] Pin Python 3.12
- [x] Configure Ruff
- [x] Configure Pytest
- [x] Add `.gitignore`
- [x] Add `.env.example`
- [x] Add Makefile/task commands
- [x] Create initial package structure
- [x] Add Docker Compose skeleton
- [x] Add smoke test
- [x] Confirm lint/test commands pass

## Phase 1 — PostgreSQL + simulator

- [x] Add PostgreSQL Compose `core` profile
- [x] Add health check
- [x] Create DDL/migration layout
- [x] Implement stores
- [x] Implement customers/addresses
- [x] Implement products/prices
- [x] Implement inventory/movements
- [x] Implement riders
- [x] Implement promotions
- [x] Implement orders/items
- [x] Implement payments
- [x] Implement deliveries
- [x] Implement support tickets
- [x] Build deterministic reference-data generator
- [x] Build deterministic historical simulator
- [x] Encode demand seasonality
- [x] Encode promotion uplift
- [x] Encode workload/rider/distance delay behavior
- [x] Implement DB load/reset/validate commands
- [x] Add integrity tests

## Phase 2 — SQL

- [x] Define metric dictionary
- [x] Add 10 beginner queries
- [x] Add 10 intermediate queries
- [x] Add 10 advanced queries
- [x] Document edge cases

## Phase 3 — PySpark fundamentals

- [x] Raw export layer
- [x] Spark session builder
- [x] CSV explicit-schema example
- [x] JSON nested example
- [x] Parquet example
- [x] joins/groupBy/window jobs
- [x] explain-plan examples
- [x] Spark test fixture

## Phase 4 — Medallion MVP

- [x] Configure Delta
- [x] Bronze orders
- [x] Bronze customers
- [x] Bronze products
- [x] Bronze inventory
- [x] Bronze deliveries
- [x] Silver orders
- [x] Silver customers
- [x] Silver products
- [x] Silver inventory
- [x] Silver deliveries
- [x] quarantine output
- [x] Gold store hourly metrics
- [x] Gold customer 360
- [x] Gold inventory health
- [x] Gold delivery performance
- [x] Gold product performance
- [x] idempotent pipeline test

## Phase 5 — Quality + optimization

- [x] Bad-data injection framework
- [x] Rule catalog
- [x] Quality metrics
- [x] Delta MERGE
- [x] SCD2
- [x] partition-pruning experiment
- [x] broadcast-join experiment
- [x] shuffle experiment
- [x] skew experiment
- [x] small-file experiment

## Phase 6 — Object storage

- [x] SeaweedFS profile
- [x] S3 bucket bootstrap
- [x] Spark S3A config
- [x] storage-backend abstraction
- [x] S3 Delta smoke test

## Phase 7 — Streaming

- [x] Redpanda profile
- [x] topic bootstrap
- [x] event schema/contracts
- [x] live simulator producer
- [x] Structured Streaming consumer
- [x] checkpoints
- [x] malformed-event handling
- [x] event-time/watermark exercise
- [x] restart/replay test

## Phase 8 — CDC

- [x] PostgreSQL logical replication config
- [x] Debezium connector
- [x] orders CDC
- [x] inventory CDC
- [x] payments CDC
- [x] CDC Bronze adapter
- [x] Silver MERGE from CDC
- [x] insert/update/delete demo

## Phase 9 — Airflow

- [x] Airflow profile
- [x] supplier ingestion DAG
- [x] Bronze→Silver DAG
- [x] Silver→Gold DAG
- [x] quality gate task
- [x] weather DAG
- [x] backfill/retry documentation

## Phase 10 — Dashboard

- [x] Streamlit shell
- [x] Overview page
- [x] Stores page
- [x] Inventory page
- [x] Delivery page
- [x] Customers page
- [x] Products page
- [x] Pipeline quality page

## Phase 11 — ML

- [x] MLflow profile
- [x] delivery feature table
- [x] delivery baseline
- [x] delivery model
- [x] demand feature table
- [x] demand baseline
- [x] demand model
- [x] anomaly baseline
- [x] anomaly model/rules
- [x] write predictions to Gold
- [x] dashboard predictions

## Phase 12 — RAG

- [x] Qdrant profile
- [x] internal docs fixtures
- [x] chunking
- [x] local embeddings
- [x] index/upsert
- [x] retriever
- [x] retrieval evaluation set
- [x] grounded answer function

## Phase 13 — Agent

- [x] Ollama config
- [x] typed tool interfaces
- [x] SQL analytics tool
- [x] inventory/store tools
- [x] ML tools
- [x] RAG tool
- [x] LangGraph state
- [x] routing
- [x] bounded loop
- [x] agent traces
- [x] agent evaluation suite
- [x] Gemini-first agent LLM with heuristic classify skip
- [x] Gold tool TTL cache
- [x] SSE agent chat stream + live console

## Phase 14 — FastAPI + actions

- [x] FastAPI app
- [x] health route
- [x] analytics routes
- [x] prediction routes
- [x] agent route
- [x] proposal model
- [x] proposal validation
- [x] approve/reject routes
- [x] simulated action executor
- [x] audit trail
- [x] approval UI

## Phase 15 — Hardening

- [x] GitHub Actions
- [x] integration test profile
- [x] structured logs
- [x] correlation IDs
- [ ] Prometheus metrics
- [ ] Grafana profile/dashboards
- [x] final architecture diagrams
- [ ] model cards
- [ ] RAG evaluation report
- [ ] agent evaluation report
- [x] final end-to-end demo script
- [ ] final clean-clone validation

## Phase 16 — Business Experience

### B0 — Governance
- [x] Design spec `docs/superpowers/specs/2026-10-07-business-experience-design.md`
- [x] PRD personas P5–P9 and FR-033–FR-045
- [x] ADR-002 business experience + RBAC
- [x] ADR-003 serving read model
- [x] ADR-004 Gemini opt-in assistant + Live voice
- [x] Phase 16 section in `kit/03_IMPLEMENTATION_PLAN.md`
- [x] Phase 16 checklist in `kit/TASKS.md`

### B1 — Identity & RBAC
- [x] `V007__identity.sql` (users, roles, permissions, scopes, preferences, sessions, audit)
- [x] `src/quickcart/identity/` package
- [x] `get_principal` / `require_permission` / `scope_filter` API deps
- [x] Auth routes + JWT httpOnly session cookie
- [x] Seeded demo user per persona
- [x] Approver bound to principal (not free-text)
- [x] Frontend JWT middleware + role-based landing
- [x] `/qc-api` same-origin rewrite
- [x] RBAC matrix + scope-leak tests

### B2 — Semantic registry & serving
- [x] `src/quickcart/semantics/metrics.yaml` + registry
- [x] `V008__serving_read_model.sql`
- [x] Serving snapshot job after gold refresh
- [x] Business API `/api/v1/b/*` with `MetricValue`
- [x] Metric explain templates (deterministic)
- [x] Measure `/b/today` local p95 (`python -m quickcart.business.bench_today`)

### B3 — Business UI shell
- [x] Ops routes under `app/(ops)/` (URLs unchanged)
- [x] `app/(business)/b` layout + BusinessShell + nav
- [x] ExperienceSwitcher
- [x] 7-step onboarding + getting-started checklist
- [x] Today, Stores, Store detail, Products, Delivery, Money, Customers, Actions, Learn, Settings
- [x] Journey engine + journeys A–C
- [x] Plain-language formatters (₹ L/Cr, IST)
- [x] Per-persona demo fixtures
- [x] Vitest setup for business/assistant helpers

### B4 — Assistant v2 (text)
- [x] Migrate GeminiLLM to `google-genai`
- [x] Native function-calling loop (Ollama keeps pipeline)
- [x] RBAC/scoped ToolRegistry + business tools
- [x] AnswerDraft cards + provenance check
- [x] Real token streaming + card/followup SSE events
- [x] Session memory with ownership checks
- [x] ⌘K Ask mode + Ask-about-this
- [x] Business eval set (`business_eval.yaml`)

### B5 — Voice (Matrix Orb + Gemini Live)
- [x] Vendor Matrix Orb (+ speaking state, levelSource, rareui credit)
- [x] VoiceCharacter SVG face over orb
- [x] `POST /api/v1/voice/session` ephemeral tokens
- [x] PCM capture worklet + live client + audio player (barge-in)
- [x] Tool bridge to `/assistant/tools/{name}`
- [x] Voice state machine + session resumption / 15-min UX
- [x] Fallbacks when key/mic/WS unavailable
- [x] Fake Live socket tests

### B6 — Data wave 1
- [x] `V009`–`V013` migrations (costs, targets, refunds/wastage, promo redemptions, ratings/NPS)
- [x] Simulator `business.py` generators
- [x] Silver + Gold marts (scorecard, margin, category, wastage, customer health, promo)
- [x] Targets screen + Money margin view
- [x] Journey D (promo)

### B7 — Data wave 2 + actions
- [x] `V014` alerts/notifications engine + notification centre
- [x] `V015` suppliers / POs / GRN
- [x] `V016` rider shifts
- [x] `V017` proposals v2 executors + saved reports/digests (Mailpit)
- [x] `V018` CDC publication for new tables
- [x] Journey E (weekly review)

### B8 — Hardening
- [x] Playwright persona login/onboarding/Today/assistant (+ voice turn)
- [x] ESLint + typecheck in CI
- [x] Accessibility pass (WCAG AA, reduced motion)
- [x] Learning notes / runbook updates
- [x] Clean-clone validation
- [x] `uv run ruff check .` and `uv run pytest` green
