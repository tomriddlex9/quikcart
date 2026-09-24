# Phase 9 — Airflow orchestration

## What was built

- `orchestration` profile: Airflow 3.3.2 (pinned) via
  `infrastructure/airflow/Dockerfile` (JRE 17 installed — architecture-neutral
  `default-java` symlink; the pip-as-root guard is real, so `uv` stays in the
  airflow user's bin and works for the root runtime via PATH). Runs
  `airflow standalone` (sqlite backend — local learning mode), repo mounted
  at `/opt/airflow/project`, DAGs at `/opt/airflow/dags` (read-only).
- DAGs (BashOperator over `uv run --all-groups python -m ...`, retries=2):
  - `quickcart_daily_lakehouse`: export_raw → build_bronze →
    build_silver_quality_gate → publish_gold. The silver step exits non-zero
    when the quarantine gate trips, which blocks publish_gold by ordinary
    all-success dependency semantics.
  - `quickcart_weather_ingestion`: Open-Meteo weather pull with deterministic
    local fixture fallback (kit/02 FR-005); idempotent per day.
- `src/quickcart/ingestion/weather.py` (+ `tests/fixtures/weather_fixture.json`,
  unit tests with monkeypatched urlopen: API path, fallback path, idempotency).
- Key detail: `uv run` installs only default groups unless `--all-groups` —
  DAG tasks silently missed pyspark without it.

## Verification executed (kit/07 Phase 9)

- `airflow dags list`: both DAGs import, zero import errors (gate 1).
- `airflow dags test quickcart_weather_ingestion 2026-09-23`: DagRun success.
- `airflow dags test quickcart_daily_lakehouse 2026-09-23`: full chain
  export→bronze→silver→gold **DagRun success** inside the container against
  the host database (gate: success path).
- Quality-gate blocking: the silver task's SystemExit is proven by unit tests;
  the DAG's blocking semantics follow from all-success dependencies (the
  failing-run log shows downstream tasks unrunnable/upstream_failed).
- Retry behaviour: retries=2 + 1-minute delay configured on every task
  (visible as `up_for_retry` transitions during the debugging runs).

## What was learned

- The apache/airflow image refuses root pip installs; CLI from a root runtime
  needs `HOME=/home/airflow` so user-site resolves.
- Container→host Postgres works via `host.docker.internal` + the published
  port; container Spark needed the JVM path fix (arm64 vs amd64).

## Known limitations

- LocalExecutor-in-standalone only; no celery/multi-node.
- The container writes lakehouse data as root into the mounted repo (local
  learning trade-off, documented).
