# QuickCart Intelligence Platform

A local-first, zero-cost learning platform that simulates a quick-commerce business and flows its operational data through PostgreSQL → PySpark → Delta Lake (Bronze/Silver/Gold) → analytics, ML, RAG, and a bounded agentic AI operations assistant with human-approved actions.

The full specification package lives in [`kit/`](kit/README.md). This README is the working root for the implementation.

## Reading order

1. [`kit/01_ARCHITECTURE_AND_TECH_STACK.md`](kit/01_ARCHITECTURE_AND_TECH_STACK.md) — architecture and pinned versions
2. [`kit/02_PRD.md`](kit/02_PRD.md) — requirements (highest authority)
3. [`kit/03_IMPLEMENTATION_PLAN.md`](kit/03_IMPLEMENTATION_PLAN.md) — phase plan (Phases 0–15)
4. [`kit/04_DATA_MODEL_AND_EVENTS.md`](kit/04_DATA_MODEL_AND_EVENTS.md) — data contracts
5. [`kit/05_AI_EDITOR_HANDOFF.md`](kit/05_AI_EDITOR_HANDOFF.md) — engineering rules for AI editors
6. [`kit/06_SETUP_AND_RUNBOOK.md`](kit/06_SETUP_AND_RUNBOOK.md) — target runbook
7. [`kit/07_TESTING_AND_ACCEPTANCE.md`](kit/07_TESTING_AND_ACCEPTANCE.md) — acceptance gates
8. [`kit/TASKS.md`](kit/TASKS.md) — execution tracker
9. [`kit/AGENTS.md`](kit/AGENTS.md) — repo rules for coding agents

## Host prerequisites

- Git, Docker with Compose plugin
- Python 3.12 and `uv` (uv manages the interpreter: `brew install uv`)
- Java 17 (Spark prerequisite: `brew install openjdk@17`; export `JAVA_HOME=$(brew --prefix openjdk@17)`)
- Optional: DBeaver or `psql` for SQL exploration

Verify: `git --version && uv --version && java -version && docker --version && docker compose version`

## Setup

```bash
make setup          # uv sync --all-groups + create .env from .env.example
uv run pytest       # test suite
uv run ruff check . # lint
```

Windows (no Make): run the commands shown by `make help` manually via `uv run ...`.

## Local environment notes

- **Port conflicts**: if host port 5432 is already taken (e.g. a native PostgreSQL), set
  `POSTGRES_PORT` in your local `.env` to a free port (this dev machine uses 5434) and
  restart the profile. See `docs/learning/phase-1.md` for the full record.
- **OrbStack/Docker Desktop** must be running before `make core-up`.

## Current phase status

| Phase | Status |
|---|---|
| 0 — Repository and developer environment | ✅ Complete |
| 1 — PostgreSQL + deterministic simulator | ✅ Complete |
| 2 — SQL analytics foundation | ✅ Complete |
| 3 — PySpark fundamentals | ✅ Complete |
| 4–15 | ⏳ Pending (see `kit/TASKS.md`) |

### Phase 0–3 commands

```bash
make core-up     # start PostgreSQL (compose core profile)
make db-init     # apply migrations
make seed        # reference data + full historical simulation (seed 42, 100k orders)
make seed-smoke  # tiny deterministic dataset for quick checks
make db-check    # validate integrity, ordering, causal sanity
make db-reset    # drop + recreate schema (destructive)
make export-raw  # PostgreSQL → data/raw (CSV tables + supplier catalog + JSONL events)
make spark-demo  # Spark learning demo: raw → jobs → Parquet + captured plans
```

Useful modules: `uv run python -m quickcart.sql.runner` is exercised via tests; analysis SQL lives in `sql/exercises/{beginner,intermediate,advanced}/` (30 questions, each with assumptions and edge cases in the header).

Equivalent module commands: `uv run python -m quickcart.db.init`, `uv run python -m quickcart.simulator.seed_reference`, `uv run python -m quickcart.simulator.historical --seed 42 --orders 100000`, `uv run python -m quickcart.db.validate`, `uv run python -m quickcart.db.reset`.

## Layout

- `src/quickcart/` — all implementation code (config, db, simulator, later lakehouse/ml/ai/api)
- `infrastructure/postgres/migrations/` — ordered versioned DDL (`V001__core_schema.sql`, …)
- `sql/`, `orchestration/`, `dashboard/`, `notebooks/` — created in their phases
- `docs/learning/` — per-phase learning notes (what was built, run, tested, learned, limitations)
- `docs/data_dictionary/` — metric and table definitions
- `docs/decisions/` — architecture decision records
- `data/` — local raw/bronze/silver/gold/quarantine/checkpoints/artifacts (gitignored)
- `tests/` — unit / integration / contracts / data_quality

## Ground rules

One phase at a time; the repository must stay runnable and green at every phase boundary. No cloud services, no paid APIs. Never silently discard invalid data. See `AGENTS.md` / `kit/AGENTS.md` for the full rule set.
