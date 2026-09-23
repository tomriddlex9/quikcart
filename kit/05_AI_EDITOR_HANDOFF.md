# AI Code Editor Handoff — Cursor / Kimi / Similar Agents

Use this document as the top-level implementation instruction when handing the project to an AI code editor.

---

# 1. Mission

Implement the QuickCart Intelligence Platform defined in this specification as a staged, local-first learning project.

Do not treat this as a request to generate a large repository in one pass.

Implement exactly one phase/milestone at a time, validate it, and preserve a runnable repository before moving forward.

---

# 2. Required context files

Read in this order before changing code:

1. `README.md`
2. `01_ARCHITECTURE_AND_TECH_STACK.md`
3. `02_PRD.md`
4. `03_IMPLEMENTATION_PLAN.md`
5. `04_DATA_MODEL_AND_EVENTS.md`
6. `06_SETUP_AND_RUNBOOK.md`
7. `07_TESTING_AND_ACCEPTANCE.md`
8. `TASKS.md`
9. `AGENTS.md`

If any implementation instruction conflicts, prefer:

```text
PRD acceptance/safety requirements
    > implementation plan
    > architecture document
    > tasks
```

Ask the human only when the conflict cannot be resolved from those documents. Otherwise make the safest minimal assumption and record it in an ADR/decision note.

---

# 3. Current implementation target

Start with **Phase 0**, then **Phase 1**.

Do not install/configure Redpanda, Debezium, Airflow, MLflow, Qdrant, Ollama, LangGraph, Prometheus, or Grafana during Phase 0/1 unless necessary for repository placeholders/documentation.

The first working vertical slice is:

```text
Python simulator
      ↓
PostgreSQL
      ↓
SQL
      ↓
exported files
      ↓
PySpark
      ↓
Bronze → Silver → Gold
```

Streaming/AI comes later.

---

# 4. Engineering rules

## 4.1 No fake completeness

Never add placeholder functions that return hard-coded success and mark a phase complete.

TODO stubs are allowed only when:

- they clearly belong to a later phase,
- they are not invoked by the current phase,
- they are documented.

## 4.2 No silent fallback

Do not catch broad exceptions and return empty DataFrames, empty lists, or success.

Failures should be visible and actionable.

## 4.3 Domain logic separate from I/O

Prefer:

```text
pure transformation functions
+
adapters/readers/writers
```

Example:

```python
clean_orders(df) -> DataFrame
```

should not itself know Docker credentials or object-storage endpoints.

## 4.4 Configuration

All environment-specific values must come from configuration/environment variables.

Never commit:

- passwords
- tokens
- personal paths
- API keys

Provide `.env.example`.

## 4.5 Version discipline

Pin critical versions once activated.

Baseline:

```text
Python 3.12
Java 17
PySpark 4.2.0
Delta Lake 4.4.0
PostgreSQL 17.11
Debezium 3.6.3.Final
Airflow 3.3.2
MLflow 3.16.0
```

Before changing one of these, explain the compatibility reason in an ADR.

## 4.6 Notebooks are not production modules

A notebook may call reusable functions but should not contain the only implementation of a pipeline.

## 4.7 SQL ownership

Keep important SQL in `.sql` files where appropriate, with business question and assumptions documented.

## 4.8 Tests are part of implementation

Do not complete a task without relevant tests.

---

# 5. Phase workflow for the AI editor

For each phase:

## Step A — Inspect

Read current repository state and identify completed tasks.

## Step B — Plan

Create/update a small implementation checklist for only this phase.

## Step C — Implement minimum vertical functionality

Prefer a working thin slice over broad stubs.

## Step D — Test

Run:

```text
ruff
pytest
relevant smoke/integration command
```

## Step E — Verify acceptance criteria

Use `07_TESTING_AND_ACCEPTANCE.md`.

## Step F — Document

Update:

- README commands if changed
- data dictionary/contracts if changed
- phase learning note
- `TASKS.md` status

## Step G — Stop

Do not automatically begin the next major phase unless the human explicitly asks to continue or the editor is operating under a clearly scoped multi-phase command.

---

# 6. Code structure expectations

Suggested Python package root:

```text
src/quickcart/
```

Suggested modules over time:

```text
src/quickcart/config/
src/quickcart/db/
src/quickcart/simulator/
src/quickcart/ingestion/
src/quickcart/lakehouse/
src/quickcart/quality/
src/quickcart/ml/
src/quickcart/rag/
src/quickcart/agents/
src/quickcart/api/
```

Repository top-level folders may still include SQL, infrastructure, notebooks, docs, dashboard assets, etc.

Avoid duplicate implementation living both under top-level folders and `src/`.

---

# 7. Database implementation guidance

- Use migrations or ordered versioned DDL scripts.
- Keep seed generation separate from schema initialization.
- All test databases must be disposable.
- Use transactions for multi-table business writes.
- Add indexes after query evidence, except obvious PK/FK support.
- Avoid storing calculated analytical aggregates in the OLTP DB unless part of the simulation itself.

---

# 8. Synthetic data guidance

The simulator is critical. Do not generate meaningless IID random rows.

Implement behavior using explicit components such as:

```text
base demand
× hour multiplier
× weekday/weekend multiplier
× store multiplier
× product popularity
× promotion multiplier
× optional weather multiplier
```

Delivery time could derive from:

```text
base pick time
+ basket size effect
+ queue effect
+ distance effect
+ rider shortage effect
+ weather effect
+ noise
```

Then derive `is_late` from promised-vs-actual timing rather than randomly assigning it.

The resulting generated data should make intuitive exploratory analysis possible.

---

# 9. Spark guidance

## Required

- explicit schemas when possible
- avoid unnecessary `collect()`
- never use Pandas to process the main dataset just to avoid Spark
- use Spark SQL/DataFrame APIs for lakehouse transformations
- inspect plans before optimization
- partition intentionally

## Forbidden shortcuts

Do not:

- convert Spark DataFrames to Pandas for core transformations
- claim distributed scalability based only on local mode
- partition by high-cardinality IDs without justification
- cache everything
- broadcast large tables blindly

---

# 10. Data-quality guidance

Every invalid record path must be explainable.

Use structured fields such as:

```text
_error_codes
_error_messages
_failed_rules
_quarantined_at
```

Do not simply `filter` invalid rows out of existence.

---

# 11. Streaming guidance

When Phase 7 is activated:

- event ID must be stable
- event-time timestamp must be separate from ingest timestamp
- checkpoints must be persistent
- topic payloads versioned
- restart test required
- malformed messages isolated

Do not promise exactly-once business semantics without proving the entire sink/idempotency path.

---

# 12. ML guidance

Every model implementation must contain:

1. business prediction target
2. baseline
3. feature definition
4. split strategy
5. leakage review
6. metrics
7. MLflow tracking
8. persisted prediction contract

Do not optimize metrics before establishing a baseline.

Prefer interpretable initial models.

---

# 13. RAG guidance

RAG is for internal unstructured knowledge.

Do not vectorize orders/revenue tables to answer quantitative questions.

Implement retrieval evaluation before polishing answer generation.

Return source metadata with evidence.

---

# 14. Agent guidance

The agent is an orchestrator, not an unrestricted executor.

### Allowed

- call bounded analytics functions
- retrieve RAG chunks
- retrieve predictions
- summarize and compare
- create structured proposals

### Not allowed

- shell command execution
- arbitrary database write SQL
- reading secrets
- changing infrastructure
- auto-approving its own proposal

### SQL tool

SELECT-only, allow-listed, limited, timed out.

### Action tool

Proposal creation only until human approval.

---

# 15. Documentation style

Every non-trivial concept should be documented for a learner.

When adding Spark optimization, explain:

- what the original plan did
- why it was inefficient
- what changed
- observed effect
- trade-off

When adding ML, explain:

- target
- leakage risks
- baseline
- metric meaning

When adding agent flow, explain:

- tool choice
- evidence
- safety boundary

---

# 16. What not to add

Unless explicitly authorized, do not add:

- Kubernetes
- Terraform
- AWS/GCP/Azure deployment
- Databricks/Snowflake
- paid model providers
- Pinecone
- dbt
- Celery
- Redis
- Elasticsearch
- a second API framework
- a React/Next frontend
- microservices for each domain

A new tool needs a concrete unmet requirement.

---

# 17. Required completion response from an AI editor

After each phase/task, report:

```text
Implemented
- ...

Files changed
- ...

How to run
- ...

Tests run
- ...

Acceptance criteria
- PASS/FAIL ...

Known limitations
- ...

Next recommended task
- ...
```

Do not report a task as complete if tests were not run or if a required service could not be verified.
