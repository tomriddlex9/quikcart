# Phase 3 — PySpark fundamentals

## What was built

Spark introduced without streaming, Delta, or object storage (kit/03 §3):

- **Dependency group**: `spark = ["pyspark==4.2.0"]` (pinned baseline, verified
  resolvable on 2026-09-23; Java 17 via Homebrew keg-only openjdk@17).
- **Raw export layer** (`src/quickcart/ingestion/export.py`, `make export-raw`):
  all 14 tables → `data/raw/<entity>/load_date=YYYY-MM-DD/*.csv` via `COPY (SELECT
  ...)` with timestamps rendered UTC-naive and booleans as text; a seeded
  supplier-catalog CSV; nested order-event envelopes as JSON Lines
  (kit/04 §4 contract, deterministic `uuid5` event IDs).
- **Spark session builder** (`lakehouse/common/spark.py`): one central builder;
  `test=True` gives a lightweight local session; best-effort JAVA_HOME probe for
  keg-only openjdk.
- **Explicit schemas** (`lakehouse/learning/schemas.py`): StructType contracts for
  CSV sources (money as `DecimalType`, timestamps as `TimestampType`) and the JSON
  event envelope with a nested payload struct.
- **Learning jobs** (`lakehouse/learning/jobs.py`): pure DataFrame→DataFrame
  transforms (revenue by store, orders by day, delivery-timing metrics with derived
  `is_late`, top products, windowed category share, GMV percentile) + `explain_text`.
- **Demo** (`make spark-demo`): reads raw exports, runs the jobs, writes Parquet to
  `data/artifacts/phase3/`, captures physical plans to `plans.txt`.
- **Tests**: 8 Spark unit tests (tiny in-memory DataFrames) + 3 export boundary
  integration tests; `spark_session` fixture is session-scoped.

## How to run / test

```bash
make export-raw   # requires seeded DB
make spark-demo   # reads data/raw, writes data/artifacts/phase3
uv run pytest     # includes Spark unit + export integration tests
```

## Verification executed

- `uv run pytest`: **43 passed** (was 30 before Phase 3).
- Full-scale demo: Spark 4.2.0 read 97,824 orders / 299,918 items / 15,404 events
  from CSV/JSONL exports; late-delivery rate computed as 0.4505; plans captured.
- Captured `revenue_by_store` plan shows: CSV `FileScan` with `PushedFilters`
  (predicate pushdown), two `Exchange hashpartitioning` stages around
  partial→final `HashAggregate` (the shuffle), and `Exchange rangepartitioning`
  for the final sort — the narrow-vs-wide transformation story in one plan.

## What was learned

- **Spark 4 API changes hit real code**: `Column.over()` requires an explicit
  window spec (no bare `.over()` for whole-frame windows) — use
  `Window.partitionBy()`; join-then-filter needs explicit aliasing when both sides
  carry a `status` column.
- **Lazy evaluation verified in tests**: defining a filtered plan executes nothing
  until the `count()` action — asserted explicitly.
- **psycopg COPY yields memoryview chunks**: write export files in binary mode.
- Export-then-read with explicit schemas is the contract layer: the exporter
  normalises timestamps to UTC-naive strings precisely so Spark's
  `timestampFormat` parses deterministically.

## Known limitations

- `explain_text` uses the private `_jdf.queryExecution()` accessor (stable in
  practice; `df.explain()` prints but cannot capture).
- Demo runs on `local[*]`; scale/benchmark exercises arrive in Phase 5 per the
  optimization-experiment plan.
- Spark warning about the native Hadoop library on macOS is cosmetic
  (builtin-java classes used).
