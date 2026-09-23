# QuickCart Intelligence Platform — Detailed Implementation Plan

This plan is written so that a human developer or AI code editor can implement the repository incrementally without guessing the intended order.

## Global implementation rules

1. Do not jump ahead to later phases.
2. At the end of every phase, the repository must run and tests must pass.
3. Prefer the simplest local implementation that demonstrates the concept.
4. Do not add cloud dependencies unless explicitly requested later.
5. Do not hide logic in notebooks. Reusable logic belongs in Python modules; notebooks are for exploration.
6. Every new source/table/topic/API gets a documented contract.
7. Every pipeline must be rerunnable.
8. Every phase must update README/runbook documentation.
9. Never silently discard invalid data.
10. Add performance optimizations only after a baseline exists.

---

# Phase 0 — Repository and developer environment

## Objective

Create a reproducible project skeleton with no business functionality yet.

## Implement

- Git repository
- Python 3.12 configuration
- `uv` project
- `pyproject.toml`
- `uv.lock`
- Ruff
- Pytest
- `.gitignore`
- `.env.example`
- `Makefile` or task runner commands
- base package directories
- Docker Compose file with no unnecessary profiles enabled
- documentation index

## Dependency groups

Suggested groups:

- `dev`
- `spark`
- `ml`
- `ai`
- `dashboard`

Avoid installing every future dependency in the default environment if separate groups are practical.

## Commands to provide

```text
make setup
make lint
make test
make format
```

If Make is inconvenient on Windows, provide equivalent `uv run` commands in the README.

## Tests

- trivial smoke test proving test runner works
- lint gate passes

## Exit criteria

- clean clone can install dependencies
- `uv run pytest` passes
- `uv run ruff check .` passes

---

# Phase 1 — QuickCart operational database and simulator

## Objective

Create a coherent transactional source system before any Spark work.

## 1.1 PostgreSQL container

Add Compose profile `core` with PostgreSQL.

Configuration:

- named volume for local persistence
- health check
- non-default application user
- database name `quickcart`
- initialization path only for bootstrapping, not uncontrolled schema changes

## 1.2 DDL

Create normalized tables for:

- stores
- customers
- customer_addresses
- products
- product_prices
- riders
- inventory
- inventory_movements
- promotions
- orders
- order_items
- payments
- deliveries
- support_tickets

Use appropriate:

- primary keys
- foreign keys
- unique constraints
- checks
- indexes
- numeric types for money
- UTC timestamps

## 1.3 Seed/reference data

Generate stable:

- store list
- categories
- product catalog
- promotion types

## 1.4 Historical simulator

Implement deterministic generator with config dataclass/YAML.

Pipeline:

```text
config + seed
  ↓
entity generators
  ↓
business behavior model
  ↓
transaction generator
  ↓
PostgreSQL loader
```

### Behavior rules

Implement at least:

- day/hour demand seasonality
- weekend effect
- store-specific demand multiplier
- product popularity distribution
- promotion uplift
- weather placeholder signal initially
- distance influence on delivery time
- workload influence on pick time
- rider shortage influence on delay
- stock availability affecting fulfillment

## 1.5 CLI commands

Examples:

```text
quickcart db init
quickcart seed reference
quickcart simulate historical --orders 100000 --seed 42
quickcart db reset
```

Exact CLI library is optional; plain Python module commands are acceptable initially.

## 1.6 Tests

- referential integrity
- deterministic generation using fixed seed
- no invalid currency values
- orders have items
- completed deliveries occur after order creation
- generator creates expected causal direction in aggregate

## Exit criteria

- PostgreSQL starts from Compose
- deterministic seed produces populated database
- 100k order seed can complete on target workstation
- basic SQL queries validate expected row counts

---

# Phase 2 — SQL analytics foundation

## Objective

Understand the relational source and business semantics before Spark.

## Implement

Create `sql/exercises/` with at least 30 questions grouped:

### Beginner

- revenue by store
- order counts by day
- top products
- payment status counts
- cancellation count

### Intermediate

- AOV by store/category
- customer repeat rate
- rider utilization
- delivery SLA by hour
- promotion redemption
- stock movements

### Advanced

- cohort retention
- funnel conversion
- rolling 7-day revenue
- cancellation change vs prior week
- rank products inside category
- store performance percentile
- inventory cover
- customer recency/frequency/value
- lag/lead delivery patterns

## Artifacts

For each exercise:

- business question
- SQL
- explanation
- edge cases
- optional optimized version

## Exit criteria

- 30 queries executable
- advanced set uses window functions and CTEs
- metric definitions documented

---

# Phase 3 — PySpark fundamentals

## Objective

Introduce Spark without streaming, Delta, or object storage complexity.

## 3.1 Data export

Create repeatable export from PostgreSQL to local raw files:

```text
data/raw/<entity>/load_date=YYYY-MM-DD/*.parquet|csv|json
```

For learning, deliberately use multiple formats:

- CSV for supplier-like sources
- JSON for nested event-like source
- Parquet for larger relational exports

## 3.2 Spark session helper

Create one central Spark session builder with configuration isolated from transformation code.

## 3.3 Learning jobs

Implement transformations that demonstrate:

- `select`
- `filter`
- `withColumn`
- explicit schemas
- groupBy
- joins
- SQL temp views
- window functions
- transformations/actions
- `explain`

## 3.4 Spark tests

Provide session fixture suitable for unit tests.

Test transformation functions with tiny DataFrames.

## Exit criteria

- Spark batch job reads exported files
- output Parquet written locally
- tests run without manual Spark setup
- learning notes explain lazy evaluation and plans

---

# Phase 4 — Delta Lake and Medallion MVP

## Objective

Create the first true end-to-end lakehouse.

## 4.1 Delta setup

Pin compatible PySpark/Delta versions.

Centralize Spark Delta configuration.

## 4.2 Bronze loaders

Implement for core entities:

- orders
- order_items
- customers
- products
- inventory
- deliveries

Bronze requirements:

- source payload/columns preserved
- metadata added
- append/replay strategy documented

## 4.3 Silver transforms

Implement trusted tables with:

- explicit schemas
- type normalization
- UTC timestamps
- standard status enums
- deduplication
- null rules
- invalid row quarantine

Transformation code should be pure functions where practical:

```text
DataFrame → DataFrame
```

Infrastructure I/O should live separately.

## 4.4 Gold MVP

Implement:

- `gold_store_hourly_metrics`
- `gold_customer_360`
- `gold_inventory_health`
- `gold_delivery_performance`
- `gold_product_performance`

## 4.5 Pipeline CLI

Provide commands such as:

```text
make bronze
make silver
make gold
make lakehouse
```

## Exit criteria

- one command builds Bronze→Silver→Gold from seeded source data
- rerun is deterministic/idempotent under documented rules
- Gold queries return expected metrics
- raw data can be replayed

This is the first major milestone. Do not continue until stable.

---

# Phase 5 — Data quality, CDC-like merges, SCD2, Spark optimization

## Objective

Turn the batch lakehouse from a demo into a resilient learning implementation.

## 5.1 Failure injection

Simulator/export tooling shall support intentional defects:

- duplicate rows
- duplicate event IDs
- null customer ID
- nonexistent product ID
- negative amount
- malformed timestamp
- unexpected status
- late timestamp
- schema-added field

## 5.2 Data-quality framework

Do not require a third-party framework initially.

Create reusable rule abstraction:

```text
rule_id
severity
predicate
message
failure_action
```

Produce quality summary tables/logs.

## 5.3 Quarantine

Store invalid records with:

- original payload
- error code
- error message
- ingestion metadata
- failed rule IDs

## 5.4 Delta MERGE

Demonstrate upsert logic.

## 5.5 SCD Type 2

Implement a historical dimension, preferably customer address or product price attributes.

Required columns:

- business key
- surrogate/version key if useful
- valid_from
- valid_to
- is_current
- attribute columns

## 5.6 Optimization experiments

Create benchmark scripts/notes for:

### Partition pruning

Compare filtered query on partitioned vs intentionally unhelpful layout.

### Broadcast join

Compare execution plan for large orders + small product dimension.

### Shuffle

Use groupBy/join and inspect exchange operators.

### Skew

Create dominant store/product key and observe slow partition.

### Small files

Generate many tiny files and compare after compaction.

Do not invent speedup claims. Record actual local measurements and explain variability.

## Exit criteria

- invalid data is quarantined
- quality metrics produced
- SCD2 has tested history transitions
- MERGE test passes
- optimization notes include execution plans

---

# Phase 6 — S3-compatible object storage

## Objective

Move lake storage from local filesystem to a locally hosted S3-compatible service.

## Implement

- SeaweedFS profile/container(s)
- bucket creation bootstrap
- Spark S3A configuration
- credentials only in environment configuration
- equivalent Bronze/Silver/Gold paths on object storage

## Tests

- write/read small Delta table through S3 API
- lakehouse smoke pipeline against object store

## Exit criteria

- same pipeline can target `local` or `s3` storage via config
- business transformations do not change based on storage backend

---

# Phase 7 — Streaming with Redpanda

## Objective

Add live operational events.

## 7.1 Redpanda

Compose profile `streaming`:

- Redpanda broker
- optional Redpanda Console
- health checks

## 7.2 Topic contracts

Create topics such as:

- `quickcart.order-events.v1`
- `quickcart.app-events.v1`
- `quickcart.rider-events.v1`

Document keys, payload schema, timestamps, and version.

## 7.3 Real-time simulator

Implement producer with configurable event rate.

Events must correlate to realistic business process.

## 7.4 Structured Streaming

Implement:

```text
Redpanda
  ↓
Spark Structured Streaming
  ↓
Bronze Delta
```

Requirements:

- checkpoint path
- event IDs
- topic/partition/offset metadata
- graceful startup/shutdown
- malformed message handling

## 7.5 Event-time exercise

Demonstrate:

- event timestamp
- ingestion/processing timestamp
- late events
- watermark policy

## Exit criteria

- live producer events visible in Redpanda
- Spark consumes continuously
- Bronze grows
- restart resumes from checkpoint without naive double processing

---

# Phase 8 — PostgreSQL CDC with Debezium

## Objective

Propagate source DB changes automatically.

## 8.1 PostgreSQL CDC configuration

Enable required logical replication settings.

## 8.2 Debezium

Configure connector for selected tables first:

- orders
- inventory
- payments

Start small before capturing every table.

## 8.3 CDC Bronze schema

Preserve:

- operation type
- before
- after
- source metadata
- transaction/log position where provided
- event timestamp

## 8.4 Apply to Silver

Normalize CDC envelope into table changes.

Implement deterministic logic for:

- create
- update
- delete strategy

Use Delta MERGE where appropriate.

## Demo

Update source order status manually or through simulator and show propagation.

## Exit criteria

- source INSERT appears downstream
- UPDATE appears downstream
- deletion policy demonstrated
- restart resumes without full table reingestion

---

# Phase 9 — Airflow orchestration

## Objective

Schedule and coordinate batch pipelines.

## Compose

Add `orchestration` profile.

## Initial DAGs

### `daily_supplier_ingestion`

```text
sense/input
→ ingest Bronze
→ quality check
→ Silver
```

### `gold_refresh`

```text
validate Silver
→ build dimensions
→ build facts/marts
→ quality checks
```

### `weather_ingestion`

Scheduled API ingestion with local fallback fixture.

### `model_training`

Added in Phase 11 but DAG location prepared now.

## Requirements

- retries
- explicit dependencies
- useful logging
- no streaming execution inside scheduled DAG loop

## Exit criteria

- DAG can run successfully from clean seed
- failed quality task stops dependent publication
- backfill behavior documented

---

# Phase 10 — Analytics dashboard

## Objective

Turn Gold tables into a visible operations product.

## Implement Streamlit pages

1. Overview
2. Stores
3. Inventory
4. Delivery
5. Customers
6. Products
7. Pipeline/Data Quality

## Architecture

Initially direct query adapter is acceptable, but keep dashboard logic separate from data access so FastAPI can replace direct access in Phase 14.

## Exit criteria

- filters by date/store
- KPI definitions match data dictionary
- charts load from Gold, not from raw/Silver hacks

---

# Phase 11 — Classic ML + MLflow

## Objective

Train useful models from Gold/feature tables and persist predictions.

## 11.1 MLflow service

Add `ml` profile.

## 11.2 Feature tables

Create:

- `gold_delivery_features`
- `gold_demand_features`
- `gold_anomaly_features` or equivalent

## 11.3 Delivery-delay model

Implementation order:

1. baseline heuristic/logistic model
2. tree-based model
3. evaluate
4. leakage review
5. persist best candidate under explicit rules

## 11.4 Demand forecast

Start with simple baseline:

- last-period / moving-average / seasonal baseline

Then add stronger model.

Use time-based validation.

## 11.5 Anomaly detection

Start with statistical thresholds before complicated unsupervised methods.

## 11.6 Prediction sink

Write outputs into Gold prediction tables.

## Exit criteria

- MLflow shows reproducible runs
- baseline comparison documented
- prediction tables queryable
- dashboard can display model output

---

# Phase 12 — RAG

## Objective

Create local retrieval over fictional internal documents.

## 12.1 Qdrant

Add `ai` profile containing Qdrant.

## 12.2 Documents

Create versioned Markdown/PDF-like source docs in project fixtures.

Prefer Markdown sources for deterministic parsing during tests; optional PDFs can demonstrate extraction separately.

## 12.3 Ingestion

Implement:

```text
load → normalize → section split → chunk → embed → upsert
```

## 12.4 Retrieval

Return:

- text
- document ID/title
- section
- score
- version/effective date

## 12.5 Evaluation

Create 15–20 questions with expected source document/section.

Measure retrieval hit rate before evaluating answer quality.

## Exit criteria

- user can ask policy question
- system returns answer grounded in retrieved sections
- insufficient retrieval produces explicit uncertainty

---

# Phase 13 — LangGraph agent

## Objective

Create a controlled operations assistant using SQL, RAG, and ML tools.

## 13.1 Local LLM

Use Ollama with a tool-capable local model appropriate to available hardware.

Model name must be configuration, not hard-coded in domain logic.

## 13.2 Tool interfaces

Implement typed tools with Pydantic schemas.

First tools:

- `query_gold`
- `get_store_metrics`
- `get_inventory`
- `list_active_anomalies`
- `get_delivery_prediction`
- `get_demand_forecast`
- `search_company_docs`

## 13.3 SQL safety

Prefer predefined analytical functions for common operations.

If text-to-SQL is included:

- allow-list schemas/views
- parse/validate statement
- SELECT only
- statement timeout
- row limit
- no stacked statements
- no comments used to bypass validation

## 13.4 Graph state

Suggested state:

```text
request_id
user_query
intent
plan
selected_tools
tool_results
evidence
answer
proposal
errors
step_count
```

## 13.5 Routing

At minimum support:

- analytics
- policy
- prediction
- mixed
- unsupported/action

## 13.6 Evaluation

Create agent test set covering:

- correct tool choice
- wrong-tool traps
- insufficient evidence
- malformed request
- large-result prevention
- SQL injection-like prompt

## Exit criteria

- agent answers multi-source questions
- traces tool calls
- does not mutate source DB
- bounded loop enforced

---

# Phase 14 — FastAPI and human-approved action flow

## Objective

Create clean application boundaries and safe operational proposals.

## 14.1 FastAPI

Add domain/services/adapters structure.

Use Pydantic request/response models.

## 14.2 Proposal model

Example fields:

```text
proposal_id
proposal_type
created_at
created_by
source_request_id
entity_scope
recommended_action
reason
evidence
validation_status
status = PENDING|APPROVED|REJECTED|EXECUTED|FAILED
approved_by
approved_at
executed_at
```

## 14.3 Restock proposal

Agent may recommend quantity.

Deterministic service validates:

- SKU exists
- store exists
- quantity positive
- max limit
- inventory facts current enough
- duplicate open proposal check

## 14.4 Approval API

Approval endpoint must not trust arbitrary client-supplied action payload. It approves a stored proposal by ID.

## 14.5 Audit

Record state transitions.

## Exit criteria

- agent creates proposal
- dashboard/API shows pending proposal
- user approves/rejects
- only approved validated proposal can execute simulated mutation
- audit history visible

---

# Phase 15 — Engineering hardening and final demo

## Objective

Make the repository reproducible, observable, and portfolio-ready.

## Implement

- GitHub Actions
- full Ruff + Pytest workflow
- integration test profile
- structured logging
- correlation IDs
- pipeline metrics
- Prometheus/Grafana optional monitoring profile
- backup/reset docs
- architecture diagrams
- data lineage diagrams
- model cards
- RAG evaluation report
- agent evaluation report
- benchmark notes

## Final end-to-end demo scenario

1. Start required profiles.
2. Seed historical business.
3. Build lakehouse.
4. Start streaming.
5. Create/update an order in source DB.
6. Show CDC event.
7. Show downstream Silver/Gold update.
8. Show active dashboard.
9. Run delivery/demand inference.
10. Ask agent why a store is unhealthy.
11. Agent uses SQL + ML, optionally RAG.
12. Ask for action.
13. Agent creates restock proposal.
14. Human approves.
15. Simulated action updates operational state.
16. Audit trace is visible.

## Final exit criteria

All critical tests in `07_TESTING_AND_ACCEPTANCE.md` pass.

---

# Suggested implementation cadence

Do not treat this as a strict calendar, but a learning sequence.

| Block | Focus |
|---|---|
| 1 | Phase 0–1 |
| 2 | Phase 2–3 |
| 3 | Phase 4 |
| 4 | Phase 5 |
| 5 | Phase 6–7 |
| 6 | Phase 8–9 |
| 7 | Phase 10–11 |
| 8 | Phase 12 |
| 9 | Phase 13 |
| 10 | Phase 14–15 |

A block is complete only when its exit criteria pass.
