# ADR-001 — Local-first staged architecture

## Status

Accepted.

## Context

The purpose of QuickCart Intelligence Platform is learning. Introducing managed cloud platforms at the beginning would add billing, IAM, networking, and vendor-specific complexity before the core data-engineering concepts are understood.

## Decision

Use local/open-source infrastructure by default:

- PostgreSQL
- PySpark
- Delta Lake
- SeaweedFS S3 compatibility
- Redpanda
- Debezium
- Airflow
- MLflow
- Qdrant
- Ollama
- LangGraph
- FastAPI
- Streamlit

Activate components in phases rather than all at once.

## Consequences

### Positive

- near-zero monetary cost
- reproducible learning environment
- infrastructure concepts remain visible
- easier to reset experiments

### Negative

- local behavior is not identical to distributed production clusters
- limited capacity
- some Docker networking/configuration work remains

## Follow-up

A future optional cloud deployment may be added as a separate extension after the local project is complete. It must not replace the local path.
