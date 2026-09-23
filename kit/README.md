# QuickCart Intelligence Platform — Implementation Handoff

This package is the implementation specification for a local-first learning project that combines:

- Python
- SQL and PostgreSQL
- Apache Spark / PySpark
- Delta Lake and Medallion Architecture
- Batch + streaming ingestion
- CDC with Debezium
- Redpanda/Kafka-compatible event streaming
- Airflow orchestration
- Classical machine learning + MLflow
- RAG with Qdrant
- Agentic AI with LangGraph
- FastAPI
- Streamlit
- Local LLM inference with Ollama
- Testing, CI, observability, and reproducible Docker-based infrastructure

The project simulates a quick-commerce company similar to Blinkit/Zepto. The same operational data flows through a lakehouse and then powers analytics, machine learning, and an AI operations assistant.

## Recommended reading order

1. `01_ARCHITECTURE_AND_TECH_STACK.md`
2. `02_PRD.md`
3. `03_IMPLEMENTATION_PLAN.md`
4. `04_DATA_MODEL_AND_EVENTS.md`
5. `05_AI_EDITOR_HANDOFF.md`
6. `06_SETUP_AND_RUNBOOK.md`
7. `07_TESTING_AND_ACCEPTANCE.md`
8. `TASKS.md`
9. `AGENTS.md`

For Cursor, also load `.cursor/rules/quickcart-project.mdc`.

## Core execution rule

Do not build the entire final stack at once.

The repository must remain runnable at every milestone:

```text
PostgreSQL
    ↓
SQL + Python simulator
    ↓
PySpark batch processing
    ↓
Bronze → Silver → Gold
    ↓
Streaming
    ↓
CDC
    ↓
Orchestration
    ↓
ML
    ↓
RAG
    ↓
Agentic AI
    ↓
Actions + observability
```

The first implementation target is intentionally small:

```text
Python simulator
      ↓
PostgreSQL
      ↓
CSV / JSON export
      ↓
PySpark
      ↓
Delta Lake
      ↓
Bronze → Silver → Gold
```

Only after this works should the implementation proceed to streaming and the later phases.

## Version baseline

Version baseline verified for the planning date **2026-09-23**:

- Python: 3.12
- Java: 17
- Apache Spark / PySpark: 4.2.0
- Delta Lake: 4.4.0
- PostgreSQL: 17.11 recommended for this project
- Debezium: 3.6.3.Final
- Apache Airflow: 3.3.2
- MLflow: 3.16.0

Prefer exact pins in lockfiles or Docker image tags once each phase is activated. Do not upgrade core infrastructure casually during implementation.

## Cost target

The default development environment must require no paid cloud infrastructure or paid LLM API.

Expected direct infrastructure cost: **₹0**, excluding the developer's existing hardware, electricity, and internet connection.

## Important constraint

This is a learning project. The architecture should demonstrate production concepts, but should not imitate production complexity where that complexity does not teach a concrete concept.
