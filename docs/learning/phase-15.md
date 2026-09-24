# Phase 15 — Engineering Hardening (learning note)

Phase 15 makes the repository reproducible, observable, and portfolio-ready
(kit/03 Phase 15, NFR-007). It adds no new business capability; it hardens what
Phases 0–14 built.

## What was built

- **GitHub Actions CI** (`.github/workflows/ci.yml`): on every push/PR to `main` —
  checkout → astral-sh/setup-uv (Python 3.12, cached) → Temurin Java 17 (PySpark
  prerequisite) → `uv sync --all-groups` → `uv run ruff check .` →
  `uv run pytest -q` → `docker compose config --quiet`. Any failing step fails
  the workflow. Integration tests skip gracefully when no services are reachable,
  so CI is green on a clean runner without Docker services.
- **Correlation-ID observability** (`src/quickcart/observability.py`): a
  `contextvars.ContextVar` holding the current correlation id, a structlog
  processor (`bind_correlation_id`) that injects it into every log event, and a
  pure-ASGI `CorrelationIdMiddleware` that accepts/validates/echoes the
  `X-Correlation-ID` header. Header values are strictly validated
  (`[A-Za-z0-9_.-]{1,64}`); invalid inbound ids are replaced, never echoed.
- **Scripted end-to-end demo** (`scripts/demo.sh`): the kit/07 §9 acceptance
  scenario as one re-runnable script — service verification → conditional seed →
  export + Bronze/Silver/Gold → 30 live order events through Redpanda → CDC
  update/apply on a real order → three ML trainings against MLflow → RAG build +
  eval → API health check → manual UI steps. RAG/API steps degrade to an
  informative skip if those packages are not present yet.
- **Architecture documentation**: `docs/architecture/system-map.md` (component →
  phase map + full platform mermaid flowchart mirroring kit/01 §2) and
  `docs/architecture/data-lineage.md` (batch, streaming, CDC, and quarantine
  lineages with merge-key and quality-gate invariants).

## How to run

```bash
# CI (validates on any push to main; locally you can simulate the same gate with)
uv sync --all-groups && uv run ruff check . && uv run pytest -q && docker compose config --quiet

# Demo (requires the core+storage+streaming+ml+ai profiles up; see script step 1)
scripts/demo.sh
```

## How to test / verification performed

- `uv run ruff check src/quickcart/observability.py tests/unit/test_observability.py` — clean.
- `uv run pytest tests/unit/test_observability.py tests/unit/test_smoke.py -q` — 17 passed.
  Covers: contextvar get/set/new, unsafe-id rejection, processor injection (and
  lazy creation when unset), middleware echo/generate/replace behaviour, context
  cleanup after the request, non-HTTP pass-through.
- Graceful-skip proof for CI: `POSTGRES_PORT=59999 uv run pytest tests/integration -q`
  (dead port ⇒ services unreachable) — 18 skipped, 2 passed, 0 failed, exit 0.
- `bash -n scripts/demo.sh` — syntax clean. The full script was **not** executed
  here (it mutates the shared DB and runs ~minutes of Spark); every command in it
  is an existing, individually tested Makefile target or module CLI.
- `docker compose config --quiet` — valid (this is also the CI compose gate).
- `.github/workflows/ci.yml` parsed as valid YAML.

## What was learned

- **Contextvars are the right primitive** for request-scoped ids: they propagate
  through `async`/`await` without threading locals, and a single structlog
  processor merges them into every event. The subtle part is *cleanup* — the
  middleware must reset the contextvar on a token, or ids leak between requests
  on the same worker (caught by a unit test before it shipped).
- **CI for a services-heavy repo**: the honest gate is "unit tests must pass
  everywhere; integration tests must *skip cleanly* without services." Testing
  the skip path itself (point the suite at a dead port) is a one-command check
  that keeps the contract from rotting.
- **A demo script is a contract test for the runbook**: writing `scripts/demo.sh`
  surfaced two real gaps — negative array indexing that would break macOS bash
  3.2, and a `make dashboard-up` target that does not exist (the runbook command
  is `uv run streamlit run dashboard/app.py`).

## Wiring note for the API (Phase 14 owner)

`src/quickcart/api/app.py` did not exist when this phase landed, so it was left
untouched. One-line integration once it does:

```python
from quickcart.observability import bind_correlation_id, correlation_id_middleware

app.add_middleware(correlation_id_middleware)
# and add bind_correlation_id to the structlog processor chain in
# quickcart.logging.configure_logging (before ConsoleRenderer).
```

Then every request log and every proposal-audit correlation id can share the same
`X-Correlation-ID`.

## Monitoring profile (optional)

`docker compose --profile monitoring up -d` starts Prometheus (:9090) and
Grafana (:3000, admin / quickcart_grafana_dev per compose config). This profile
is **optional** for Phase 15 acceptance; it was config-validated
(`docker compose config --quiet` with the profile merged) but not left running.
The owned monitoring configs live in `infrastructure/monitoring/`.

## Known limitations

- The full demo script was syntax-checked and step-by-step audited, but not
  executed end-to-end in one run during this phase.
- CI cannot be pushed/triggered from this environment; the workflow is validated
  structurally and mirrors exactly the commands run locally.
- `kit/TASKS.md` boxes for model cards, RAG/agent evaluation reports, Grafana
  dashboards, and clean-clone validation remain for their owning phases/agents.
- Observability covers correlation IDs only; Prometheus metrics instrumentation
  of the API/pipeline is part of the optional monitoring follow-up.
