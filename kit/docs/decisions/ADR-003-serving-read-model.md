# ADR-003 — Serving read model for business APIs

## Status

Accepted.

## Context

Business screens (`/b/today`, store scorecards, Money, etc.) need sub-second responses with plain-language metric payloads. Today Gold metrics are read through Spark Delta (`src/quickcart/lakehouse/readers.py`). Spark serialises local reads and is too slow and fragile for interactive business request paths. Competing late-delivery formulas also exist across tools and APIs, so numbers can disagree.

## Decision

- Introduce a **Postgres serving schema** (`V008__serving_read_model.sql`) with tables such as `serving.metric_daily`, `metric_hourly`, `store_scorecard`, `category_daily`, and `snapshot_runs`.
- Populate via `src/quickcart/business/snapshot.py` as a `serving_snapshot` stage after `gold_refresh` in `src/quickcart/live/worker.py`, and as an Airflow task.
- Business API package `src/quickcart/api/business/` (`/api/v1/b/*`) reads serving tables only, returning `MetricValue` contracts. Ops/analytical paths may continue reading Gold via Spark.
- A **semantic metric registry** (`src/quickcart/semantics/metrics.yaml` + `registry.py`) is the single definition of each metric (label, formula, source, thresholds, explainer) for API, assistant, UI glossary, and docs.

## Consequences

### Positive

- Interactive p95 target for `/b/today` under 150 ms locally becomes achievable and measurable
- Spark stays on the analytical path; business UX no longer blocks on the JVM
- One formula per metric ends UI/agent disagreement

### Negative

- Serving data can lag Gold by one snapshot interval; UI must show freshness
- Extra job and schema to operate and test
- Snapshot failures need clear degraded-state behaviour (stale badge, not silent wrong numbers)

## Follow-up

Phase 16 B2 implements registry + serving + business API (FR-037–FR-039). Ops console is not required to migrate off Spark in this phase.
