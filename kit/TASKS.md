# QuickCart Implementation Checklist

Use this file as the execution tracker. Check items only after tests/acceptance criteria pass.

## Phase 0 — Environment

- [x] Initialize `uv` project
- [x] Create `pyproject.toml`
- [x] Pin Python 3.12
- [x] Configure Ruff
- [x] Configure Pytest
- [x] Add `.gitignore`
- [x] Add `.env.example`
- [x] Add Makefile/task commands
- [x] Create initial package structure
- [x] Add Docker Compose skeleton
- [x] Add smoke test
- [x] Confirm lint/test commands pass

## Phase 1 — PostgreSQL + simulator

- [x] Add PostgreSQL Compose `core` profile
- [x] Add health check
- [x] Create DDL/migration layout
- [x] Implement stores
- [x] Implement customers/addresses
- [x] Implement products/prices
- [x] Implement inventory/movements
- [x] Implement riders
- [x] Implement promotions
- [x] Implement orders/items
- [x] Implement payments
- [x] Implement deliveries
- [x] Implement support tickets
- [x] Build deterministic reference-data generator
- [x] Build deterministic historical simulator
- [x] Encode demand seasonality
- [x] Encode promotion uplift
- [x] Encode workload/rider/distance delay behavior
- [x] Implement DB load/reset/validate commands
- [x] Add integrity tests

## Phase 2 — SQL

- [x] Define metric dictionary
- [x] Add 10 beginner queries
- [x] Add 10 intermediate queries
- [x] Add 10 advanced queries
- [x] Document edge cases

## Phase 3 — PySpark fundamentals

- [x] Raw export layer
- [x] Spark session builder
- [x] CSV explicit-schema example
- [x] JSON nested example
- [x] Parquet example
- [x] joins/groupBy/window jobs
- [x] explain-plan examples
- [x] Spark test fixture

## Phase 4 — Medallion MVP

- [ ] Configure Delta
- [ ] Bronze orders
- [ ] Bronze customers
- [ ] Bronze products
- [ ] Bronze inventory
- [ ] Bronze deliveries
- [ ] Silver orders
- [ ] Silver customers
- [ ] Silver products
- [ ] Silver inventory
- [ ] Silver deliveries
- [ ] quarantine output
- [ ] Gold store hourly metrics
- [ ] Gold customer 360
- [ ] Gold inventory health
- [ ] Gold delivery performance
- [ ] Gold product performance
- [ ] idempotent pipeline test

## Phase 5 — Quality + optimization

- [x] Bad-data injection framework
- [x] Rule catalog
- [x] Quality metrics
- [x] Delta MERGE
- [x] SCD2
- [x] partition-pruning experiment
- [x] broadcast-join experiment
- [x] shuffle experiment
- [x] skew experiment
- [x] small-file experiment

## Phase 6 — Object storage

- [x] SeaweedFS profile
- [x] S3 bucket bootstrap
- [x] Spark S3A config
- [x] storage-backend abstraction
- [x] S3 Delta smoke test

## Phase 7 — Streaming

- [x] Redpanda profile
- [x] topic bootstrap
- [x] event schema/contracts
- [x] live simulator producer
- [x] Structured Streaming consumer
- [x] checkpoints
- [x] malformed-event handling
- [x] event-time/watermark exercise
- [x] restart/replay test

## Phase 8 — CDC

- [x] PostgreSQL logical replication config
- [x] Debezium connector
- [x] orders CDC
- [x] inventory CDC
- [x] payments CDC
- [x] CDC Bronze adapter
- [x] Silver MERGE from CDC
- [x] insert/update/delete demo

## Phase 9 — Airflow

- [x] Airflow profile
- [x] supplier ingestion DAG
- [x] Bronze→Silver DAG
- [x] Silver→Gold DAG
- [x] quality gate task
- [x] weather DAG
- [x] backfill/retry documentation

## Phase 10 — Dashboard

- [x] Streamlit shell
- [x] Overview page
- [x] Stores page
- [x] Inventory page
- [x] Delivery page
- [x] Customers page
- [x] Products page
- [x] Pipeline quality page

## Phase 11 — ML

- [x] MLflow profile
- [x] delivery feature table
- [x] delivery baseline
- [x] delivery model
- [x] demand feature table
- [x] demand baseline
- [x] demand model
- [x] anomaly baseline
- [x] anomaly model/rules
- [x] write predictions to Gold
- [x] dashboard predictions

## Phase 12 — RAG

- [x] Qdrant profile
- [x] internal docs fixtures
- [x] chunking
- [x] local embeddings
- [x] index/upsert
- [x] retriever
- [x] retrieval evaluation set
- [x] grounded answer function

## Phase 13 — Agent

- [x] Ollama config
- [x] typed tool interfaces
- [x] SQL analytics tool
- [x] inventory/store tools
- [x] ML tools
- [x] RAG tool
- [x] LangGraph state
- [x] routing
- [x] bounded loop
- [x] agent traces
- [x] agent evaluation suite

## Phase 14 — FastAPI + actions

- [x] FastAPI app
- [x] health route
- [x] analytics routes
- [x] prediction routes
- [x] agent route
- [x] proposal model
- [x] proposal validation
- [x] approve/reject routes
- [x] simulated action executor
- [x] audit trail
- [x] approval UI

## Phase 15 — Hardening

- [x] GitHub Actions
- [x] integration test profile
- [x] structured logs
- [x] correlation IDs
- [ ] Prometheus metrics
- [ ] Grafana profile/dashboards
- [x] final architecture diagrams
- [ ] model cards
- [ ] RAG evaluation report
- [ ] agent evaluation report
- [x] final end-to-end demo script
- [ ] final clean-clone validation
