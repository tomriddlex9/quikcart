# Product Requirements Document (PRD)

## QuickCart Intelligence Platform

**Status:** Implementation-ready learning PRD  
**Primary objective:** Build an end-to-end local data, ML, and agentic AI platform around a realistic quick-commerce business simulation.  
**Primary user:** Developer/data engineer learning modern data platform architecture.  
**Secondary users:** Simulated operations manager, analyst, inventory manager, and support/ops user interacting with the final app.

---

# 1. Product vision

Create a self-contained quick-commerce platform that demonstrates how operational events become trustworthy analytical data and then become decisions, predictions, explanations, and human-approved actions.

The product should answer three progressively harder classes of question:

1. **What happened?** — SQL and analytics.
2. **What is likely to happen?** — ML predictions and forecasts.
3. **Why is it happening and what should we do?** — agentic AI using SQL, RAG, and ML tools.

The final system should feel like a small internal operations platform rather than a collection of notebooks.

---

# 2. Problem statement

Learning PySpark, SQL, data engineering, ML, RAG, and agents separately produces fragmented knowledge. It is difficult to understand:

- where each technology belongs,
- how data contracts flow between systems,
- how real-time and batch pipelines coexist,
- why Bronze/Silver/Gold layers exist,
- how predictions return to operational analytics,
- how LLMs should use structured data without treating a vector DB as a universal datastore,
- and how agent actions can be made safe and auditable.

This project solves the learning problem by forcing all components to cooperate around a single domain.

---

# 3. Goals

## G1 — Build a realistic operational data source

Create a relational QuickCart database with realistic entities and relationships, seeded by a deterministic simulator.

## G2 — Build a Medallion Lakehouse

Ingest raw source data and transform it through Bronze, Silver, and Gold using PySpark and Delta Lake.

## G3 — Learn Spark deeply

Demonstrate partitions, shuffles, joins, optimization, streaming, late events, and execution plans rather than merely using DataFrame syntax.

## G4 — Support batch and near-real-time data

Combine file/API ingestion, event streaming, and CDC.

## G5 — Produce decision-ready analytics

Create reusable Gold marts and at least 30 SQL analyses.

## G6 — Build useful ML models

Implement delivery-delay prediction, demand forecasting, and operational anomaly detection with tracked experiments.

## G7 — Build grounded AI

Create a RAG system for unstructured company documents and an agent that combines SQL, RAG, and ML tools.

## G8 — Add safe actions

Allow the AI to propose operational actions, but require human approval and deterministic validation before mutations.

## G9 — Keep the default system zero-cost

All mandatory components must run locally.

## G10 — Make the repository a learning artifact

Code, docs, tests, architecture notes, data dictionaries, benchmarks, and failure cases must explain what was learned.

---

# 4. Non-goals

The following are explicitly out of scope for the default project:

- production deployment to a real cloud account
- real customer PII
- real payment processing
- autonomous purchasing or money movement
- Kubernetes
- enterprise IAM
- active-active multi-region infrastructure
- petabyte-scale benchmarking
- exact reproduction of Blinkit/Zepto internal systems
- building a generic LLM framework
- building a full React/Next.js frontend before the data platform is complete

---

# 5. Personas

## P1 — Learner / developer

Needs to understand and implement every layer.

Success means:

- can explain data lineage end-to-end,
- can debug a failed pipeline,
- can reason about Spark execution,
- can write analytical SQL,
- can train/evaluate models,
- can explain why a tool call or RAG lookup was used.

## P2 — Operations manager

Needs a concise view of active operational problems.

Primary questions:

- Which store is unhealthy?
- Why are deliveries delayed?
- Where are stockouts likely?
- Are cancellations or payment failures abnormal?

## P3 — Inventory manager

Needs:

- stock-cover visibility,
- demand forecast,
- restock proposals,
- anomaly alerts.

## P4 — Analyst

Needs:

- trusted Gold tables,
- reusable definitions,
- SQL access,
- consistent business metrics.

---

# 6. Core user journeys

## UJ1 — Explore business performance

1. User opens dashboard.
2. User selects a date/store.
3. System shows orders, GMV, cancellation rate, delivery SLA, and inventory warnings.
4. User drills into a metric.
5. Metric is backed by a documented Gold table.

## UJ2 — Investigate a delivery problem

1. User asks: "Why are deliveries delayed at Store 8 today?"
2. Agent identifies analytical intent.
3. Agent retrieves store metrics from Gold.
4. Agent optionally retrieves delay-model predictions.
5. Agent compares current state to historical baseline.
6. Agent returns grounded explanation with evidence.

## UJ3 — Investigate stockout risk

1. Demand forecast identifies high-risk SKU/store pairs.
2. Inventory dashboard highlights risk.
3. User asks AI for cause and recommended response.
4. Agent reads current inventory and forecast.
5. Agent retrieves inventory SOP if procedure is relevant.
6. Agent produces a restock proposal.
7. User approves/rejects.
8. Decision and execution status are audited.

## UJ4 — Replay and fix bad data

1. Data-quality rule detects malformed or invalid input.
2. Invalid record is quarantined, not silently dropped.
3. Developer fixes transformation logic or source fixture.
4. Bronze raw data is replayed.
5. Silver/Gold are regenerated deterministically.

## UJ5 — Observe CDC

1. Source order changes from `PLACED` to `DELIVERED`.
2. Debezium publishes a change event.
3. Streaming ingestion lands it in Bronze.
4. Silver applies the change safely.
5. Gold metrics update.

---

# 7. Functional requirements

## FR-001 — Reproducible local environment

The repository shall provide documented commands to initialize each activated phase.

Acceptance:

- clean clone can create Python environment,
- required Docker profile starts,
- health checks pass,
- seed command creates a working dataset.

## FR-002 — Deterministic synthetic-data generator

The simulator shall support a seed so datasets can be reproduced.

It shall generate coherent causal patterns instead of independent random outcomes.

Configuration must include:

- number of stores
- products
- customers
- riders
- historical date range
- order volume
- event rate
- anomaly scenarios
- RNG seed

## FR-003 — Relational source schema

PostgreSQL shall enforce primary/foreign keys where appropriate.

Schema migrations/DDL shall be version-controlled.

## FR-004 — Batch ingestion

The platform shall ingest at least CSV and JSON sources into Bronze.

Every Bronze record shall contain ingestion metadata.

## FR-005 — API enrichment

Weather or equivalent external context shall be ingestible through a Python job.

Tests shall use fixtures/mocks rather than depend on network availability.

## FR-006 — Bronze persistence

Bronze must preserve raw data sufficiently for replay.

Malformed rows must be quarantined or retained with error information rather than silently discarded.

## FR-007 — Silver transformations

Silver shall implement:

- explicit schemas
- casts
- null rules
- deduplication
- timestamp normalization
- referential validation
- business validation
- standard naming
- quarantine path

## FR-008 — Gold marts

At minimum implement:

- store hourly metrics
- customer 360
- inventory health
- delivery performance
- product performance

## FR-009 — Idempotency

Rerunning a completed batch for the same source data must not create duplicates or change business results unexpectedly.

## FR-010 — SCD Type 2

At least one meaningful dimension, such as customer address or product price/category attributes, shall preserve historical versions.

## FR-011 — Spark optimization demonstrations

The repo shall include documented examples showing at least:

- partition pruning
- broadcast join
- shuffle analysis
- skew scenario
- small-file scenario

Each example must show observed behavior before and after the optimization.

## FR-012 — Streaming events

The simulator shall publish events to Redpanda using Kafka-compatible APIs.

Spark Structured Streaming shall ingest at least order events into Bronze.

## FR-013 — Streaming reliability

Streaming job shall use checkpoints and deterministic event IDs.

Duplicate/replayed events shall not double-count Gold metrics.

## FR-014 — Late data

At least one streaming pipeline shall demonstrate event time, processing time, watermarking, and a defined policy for too-late events.

## FR-015 — CDC

PostgreSQL row changes shall be captured with Debezium.

At minimum demonstrate inserts, updates, and deletes/tombstones or an explicit deletion strategy.

## FR-016 — Airflow orchestration

Airflow shall orchestrate batch workflows including at least:

- supplier/file ingestion
- Bronze→Silver
- Silver→Gold
- data-quality checks
- model training trigger or scheduled job

Streaming processes must remain independent long-running services.

## FR-017 — SQL analytics catalog

At least 30 meaningful SQL questions shall be implemented and documented.

## FR-018 — Delivery-delay ML model

The system shall train and evaluate a model that predicts late delivery risk.

Metrics and artifacts shall be tracked in MLflow.

## FR-019 — Demand forecast

The system shall generate SKU/store demand forecasts for at least one useful horizon.

## FR-020 — Anomaly detection

The system shall identify unusual operational behavior and write anomalies into a queryable table.

## FR-021 — Prediction persistence

All production-style inference outputs shall include model version and prediction timestamp and shall be persisted for downstream use.

## FR-022 — Dashboard

Streamlit shall display major KPIs, trends, model outputs, and anomalies.

## FR-023 — RAG ingestion

Internal documents shall be parsed, chunked, embedded, and indexed in Qdrant.

Metadata shall include document identity and version/effective-date information.

## FR-024 — Grounded RAG response

RAG responses shall expose the retrieved document/section metadata used to answer.

## FR-025 — Agent SQL tool

Agent shall have controlled read-only access to approved analytical views/tables.

It shall not receive a generic unrestricted database connection.

## FR-026 — Agent ML tools

Agent shall be able to retrieve persisted ML outputs and/or invoke bounded inference functions.

## FR-027 — Agent tool routing

Agent shall distinguish at least:

- structured analytics → SQL tool
- policy/document question → RAG tool
- prediction question → ML tool
- mixed question → multiple tools

## FR-028 — Action proposals

The agent shall be able to create a structured proposal object without executing the final business mutation.

## FR-029 — Approval workflow

Proposal execution shall require explicit approval through application/API state.

## FR-030 — Audit trail

The platform shall record:

- proposal creator
- agent trace/correlation ID
- proposal payload
- validation result
- approver decision
- action outcome
- timestamps

## FR-031 — FastAPI service boundary

Analytics, prediction, agent, and proposal functionality shall be exposed through versioned API routes.

## FR-032 — Health endpoints

Each major service must expose or support a health check used by the local runbook.

---

# 8. Data requirements

## DR-001 — Synthetic only by default

No real customer data shall be required.

## DR-002 — Referential coherence

Generated order items must refer to valid orders/products except when explicitly generated as data-quality failure scenarios.

## DR-003 — Event identity

Every event must contain a stable event ID.

## DR-004 — Timestamps

Use timezone-aware UTC timestamps internally. Local presentation timezone may be configured at the UI layer.

## DR-005 — Money

Use decimal/numeric semantics for monetary values; avoid binary floating point for persisted currency amounts.

## DR-006 — Units

Inventory quantities and measurement units must be explicit.

## DR-007 — Schema versions

Event and batch contracts must include a schema version where evolution is demonstrated.

---

# 9. Data-quality requirements

Minimum rules:

- order ID not null
- order amount non-negative
- status in known enum
- valid store
- valid customer
- order item quantity > 0
- payment amount logically reconciles with order amount within documented rules
- delivery timestamp not before order timestamp
- inventory not below allowed threshold unless explicitly simulating discrepancy
- duplicate event IDs rejected/deduplicated

Every rule must have:

- rule ID
- severity
- action: reject/quarantine/warn
- test
- observability metric

---

# 10. Analytics requirements

Minimum Gold metric definitions must be documented in a data dictionary.

Examples:

### GMV

Document whether canceled/refunded orders are included.

### Cancellation rate

Define numerator, denominator, and event-time window.

### Late delivery rate

Define promised SLA and completed-order population.

### Stock cover

Define units on hand divided by expected demand over a specified horizon.

Avoid ambiguous metric names without definitions.

---

# 11. ML requirements

## MLR-001 — Baseline first

Every model must compare against a simple baseline.

## MLR-002 — Time-aware split where appropriate

Demand forecasting and operational prediction must avoid random splits that leak future information.

## MLR-003 — Leakage review

Each model shall document potential leakage fields and why they are excluded.

## MLR-004 — Reproducibility

Training records:

- dataset/version or generation seed
- feature list
- training code version where practical
- hyperparameters
- metrics
- artifact/model

## MLR-005 — Prediction contract

Persist:

- entity key
- prediction
- optional probability/interval
- prediction timestamp
- model name/version
- feature snapshot reference where practical

---

# 12. RAG requirements

## RAGR-001

Chunk by meaningful document boundaries where possible instead of arbitrary fixed-size splitting only.

## RAGR-002

Retrieved chunks must retain source metadata.

## RAGR-003

Implement a small retrieval evaluation set with expected relevant documents/sections.

## RAGR-004

The assistant shall say when retrieval does not provide sufficient evidence instead of fabricating internal policy.

---

# 13. Agent requirements

## AR-001 — Bounded tools

No shell tool and no arbitrary Python execution exposed to the model.

## AR-002 — Read-only analytical SQL

Allow-list views/schemas. Validate SQL. Reject mutating statements.

## AR-003 — Max steps

Enforce bounded tool iterations.

## AR-004 — Tool result size

Large SQL results must be aggregated/paginated before being returned to the LLM.

## AR-005 — Grounding

Final answers should distinguish retrieved facts, model predictions, and proposed actions.

## AR-006 — Human approval

No high-impact operational mutation occurs from LLM text alone.

---

# 14. API requirements

Use `/api/v1` versioning.

Initial endpoints:

```text
GET  /health
GET  /api/v1/stores
GET  /api/v1/stores/{store_id}/metrics
GET  /api/v1/inventory
GET  /api/v1/inventory/risks
GET  /api/v1/orders/{order_id}
GET  /api/v1/anomalies
GET  /api/v1/predictions/delivery/{order_id}
POST /api/v1/agent/chat
POST /api/v1/proposals
POST /api/v1/proposals/{proposal_id}/approve
POST /api/v1/proposals/{proposal_id}/reject
```

OpenAPI docs must be available in development.

---

# 15. Dashboard requirements

## Page: Overview

- orders today
- GMV
- cancellation rate
- late-delivery rate
- active operational anomalies

## Page: Stores

- store comparison
- drill-down
- workload
- rider capacity

## Page: Inventory

- current stock
- stock cover
- demand forecast
- stockout risk

## Page: Delivery

- SLA
- duration distributions
- late-risk predictions

## Page: ML

- prediction summaries
- forecast vs actual
- model version

## Page: AI Assistant

- chat
- visible tool/evidence summary
- proposal cards

## Page: Approvals

- pending proposals
- rationale
- approve/reject
- audit history

---

# 16. Non-functional requirements

## NFR-001 — Local performance

Default seed and Phase 4 pipelines should be usable on a developer workstation without requiring a cluster.

## NFR-002 — Resource isolation

Use Docker Compose profiles. Do not run unused heavy services.

## NFR-003 — Deterministic setup

Dependencies must be pinned/locked.

## NFR-004 — Testability

Domain logic should be separated from infrastructure adapters.

## NFR-005 — Observability

Jobs must emit structured logs and useful metrics/counters.

## NFR-006 — Security hygiene

Secrets go in environment variables/local secret files excluded from Git.

## NFR-007 — Documentation

Every phase must include:

- what was built
- how to run
- how to test
- what concept was learned
- known limitations

---

# 17. Success metrics for the learning project

The project is successful when the developer can demonstrate:

1. A PostgreSQL business mutation propagating through CDC into the lakehouse.
2. A raw event surviving Bronze and being cleaned into Silver.
3. A Gold metric being derived from trusted Silver tables.
4. A Spark optimization with measured improvement/explanation.
5. A streaming event affecting near-real-time analytics.
6. A model trained and tracked in MLflow.
7. A prediction stored back into Gold.
8. A document question answered via RAG with evidence.
9. A mixed analytical question answered by the agent using more than one tool.
10. A proposed action requiring explicit human approval.
11. A failed data-quality record being quarantined and recoverable.
12. A clean clone reproducing the working phase from documentation.

---

# 18. Milestone definition

## M0 — Development environment

Tooling installed and verified.

## M1 — Operational business simulator

PostgreSQL + deterministic data.

## M2 — SQL analytics foundation

30-question SQL catalog started; core questions answered.

## M3 — Spark batch foundation

Raw data processed with PySpark.

## M4 — Medallion MVP

Bronze/Silver/Gold working with Delta.

## M5 — Robust lakehouse

Data quality, SCD2, idempotency, optimization demonstrations.

## M6 — Object storage

Delta on local S3-compatible storage.

## M7 — Streaming

Redpanda + Spark Structured Streaming.

## M8 — CDC

PostgreSQL → Debezium → event broker → lakehouse.

## M9 — Orchestration

Airflow batch DAGs.

## M10 — Operations dashboard

Interactive analytics UI.

## M11 — ML platform

Three ML use cases, MLflow, predictions persisted.

## M12 — RAG

Internal knowledge retrieval.

## M13 — Agent

SQL + RAG + ML tool orchestration.

## M14 — Action workflow + API

FastAPI and approval actions.

## M15 — Engineering hardening

CI, monitoring, runbooks, final documentation.

---

# 19. Major risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Installing entire stack too early | High | Activate phase-specific profiles only |
| Synthetic data has no useful signal | High | Encode causal business relationships and test correlations |
| Spark used on tiny data without learning distributed concepts | Medium | Add deliberate scale/benchmark exercises after correctness |
| Version incompatibility | High | Pin validated Spark/Delta and infrastructure versions |
| Data leakage in ML | High | Time-aware splits and explicit leakage checklist |
| Agent hallucination | High | Tool grounding, evidence, bounded tools, evaluation |
| Agent unsafe writes | High | Proposal-only tools + human approval |
| RAG used for SQL questions | Medium | Intent routing and architecture tests |
| Too many frameworks | High | No new dependency without clear requirement |
| Local RAM pressure | Medium | Compose profiles and explicit resource limits |
| Network-dependent tests | Medium | fixtures/mocks/local sample data |
| Scope creep into frontend polish | Medium | Streamlit until core platform is done |

---

# 20. Definition of done

The project is complete when all acceptance gates in `07_TESTING_AND_ACCEPTANCE.md` pass and the end-to-end demonstration can be executed from documented commands without manual database editing.
