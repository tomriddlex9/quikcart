# AGENTS.md — Repository Rules for AI Coding Agents

## Purpose

This repository is a staged learning project. Correct sequencing and explainability matter as much as implementation speed.

## Before coding

Read:

1. `02_PRD.md`
2. `03_IMPLEMENTATION_PLAN.md`
3. `07_TESTING_AND_ACCEPTANCE.md`
4. `TASKS.md`

Then determine the active phase. Do not implement unrelated later-phase infrastructure.

## Non-negotiable constraints

- Local-first and zero-cost by default.
- Python 3.12.
- Java 17.
- PySpark/Delta version compatibility must remain valid.
- PostgreSQL is the operational source.
- Delta Medallion architecture is the analytical storage model.
- Redpanda is the initial Kafka-compatible broker.
- Debezium performs CDC.
- Airflow orchestrates batch workflows, not the continuous stream.
- ML outputs are persisted for downstream use.
- Qdrant is for unstructured document retrieval, not analytical tables.
- Agent tools are bounded.
- Agent cannot execute arbitrary SQL writes or shell commands.
- High-impact actions require human approval.

## Coding style

- Use type hints.
- Use Pydantic/dataclasses for explicit contracts/config where appropriate.
- Favor small composable functions.
- Keep I/O adapters separate from business/transformation logic.
- Avoid global mutable state.
- Use structured logging.
- Use UTC internally.
- Use Decimal/NUMERIC semantics for money.

## Testing

Every task requires relevant tests.

Run at least:

```bash
uv run ruff check .
uv run pytest
```

If Docker/integration services are touched, run the relevant smoke/integration test too.

## Documentation

When introducing a concept, document why it exists and how to observe it.

Never claim a performance improvement without measurements from the local test/benchmark.

## Dependency policy

Do not add a new framework when the standard library or current stack can solve the requirement cleanly.

Any substantial new infrastructure dependency requires an ADR under `docs/decisions/`.

## Completion reporting

Report implemented files, commands, test results, known limitations, and next task.
