# AGENTS.md — Repository Rules for AI Coding Agents

The authoritative, full copy of the project rules lives in [`kit/AGENTS.md`](kit/AGENTS.md) — read it before coding. This root file exists so the same rules apply outside `kit/`.

## Summary of non-negotiable constraints

- Local-first and zero-cost by default. Python 3.12. Java 17. PySpark/Delta version compatibility must remain valid.
- PostgreSQL is the operational source. Delta Medallion architecture is the analytical storage model.
- Redpanda is the initial Kafka-compatible broker. Debezium performs CDC. Airflow orchestrates batch workflows, not the continuous stream.
- ML outputs are persisted for downstream use. Qdrant is for unstructured document retrieval, not analytical tables.
- Agent tools are bounded. The agent cannot execute arbitrary SQL writes or shell commands. High-impact actions require human approval.

## Working agreements

- Determine the active phase from `kit/03_IMPLEMENTATION_PLAN.md` and `kit/TASKS.md`; do not implement later-phase infrastructure early.
- All implementation code lives under `src/quickcart/`. Reusable logic lives in Python modules, never only in notebooks.
- Type hints, Pydantic/dataclasses for contracts, small composable pure functions, I/O separated from domain logic, UTC internally, Decimal/NUMERIC for money, structured logging.
- Never silently discard invalid data. No placeholder implementations pretending a phase exists. No silent exception swallowing.
- Every task requires relevant tests. Run at least:

  ```bash
  uv run ruff check .
  uv run pytest
  ```

- Do not add a new framework without a concrete unmet requirement; substantial new infrastructure needs an ADR in `docs/decisions/`.
- Never claim a performance improvement without local measurements, and never report a task complete if tests were not run.

## Documentation map (specification package lives in `kit/`)

| Document | Role |
|---|---|
| `kit/02_PRD.md` | Product behavior and requirements (highest authority) |
| `kit/03_IMPLEMENTATION_PLAN.md` | Build order and phase definitions |
| `kit/04_DATA_MODEL_AND_EVENTS.md` | Data contracts |
| `kit/05_AI_EDITOR_HANDOFF.md` | AI-editor working rules and phase workflow |
| `kit/06_SETUP_AND_RUNBOOK.md` | Target setup/run commands |
| `kit/07_TESTING_AND_ACCEPTANCE.md` | Acceptance gates |
| `kit/TASKS.md` | Execution tracker (check boxes only when tests pass) |
