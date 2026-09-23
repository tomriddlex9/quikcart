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

- [ ] Bad-data injection framework
- [ ] Rule catalog
- [ ] Quality metrics
- [ ] Delta MERGE
- [ ] SCD2
- [ ] partition-pruning experiment
- [ ] broadcast-join experiment
- [ ] shuffle experiment
- [ ] skew experiment
- [ ] small-file experiment

## Phase 6 — Object storage

- [ ] SeaweedFS profile
- [ ] S3 bucket bootstrap
- [ ] Spark S3A config
- [ ] storage-backend abstraction
- [ ] S3 Delta smoke test

## Phase 7 — Streaming

- [ ] Redpanda profile
- [ ] topic bootstrap
- [ ] event schema/contracts
- [ ] live simulator producer
- [ ] Structured Streaming consumer
- [ ] checkpoints
- [ ] malformed-event handling
- [ ] event-time/watermark exercise
- [ ] restart/replay test

## Phase 8 — CDC

- [ ] PostgreSQL logical replication config
- [ ] Debezium connector
- [ ] orders CDC
- [ ] inventory CDC
- [ ] payments CDC
- [ ] CDC Bronze adapter
- [ ] Silver MERGE from CDC
- [ ] insert/update/delete demo

## Phase 9 — Airflow

- [ ] Airflow profile
- [ ] supplier ingestion DAG
- [ ] Bronze→Silver DAG
- [ ] Silver→Gold DAG
- [ ] quality gate task
- [ ] weather DAG
- [ ] backfill/retry documentation

## Phase 10 — Dashboard

- [ ] Streamlit shell
- [ ] Overview page
- [ ] Stores page
- [ ] Inventory page
- [ ] Delivery page
- [ ] Customers page
- [ ] Products page
- [ ] Pipeline quality page

## Phase 11 — ML

- [ ] MLflow profile
- [ ] delivery feature table
- [ ] delivery baseline
- [ ] delivery model
- [ ] demand feature table
- [ ] demand baseline
- [ ] demand model
- [ ] anomaly baseline
- [ ] anomaly model/rules
- [ ] write predictions to Gold
- [ ] dashboard predictions

## Phase 12 — RAG

- [ ] Qdrant profile
- [ ] internal docs fixtures
- [ ] chunking
- [ ] local embeddings
- [ ] index/upsert
- [ ] retriever
- [ ] retrieval evaluation set
- [ ] grounded answer function

## Phase 13 — Agent

- [ ] Ollama config
- [ ] typed tool interfaces
- [ ] SQL analytics tool
- [ ] inventory/store tools
- [ ] ML tools
- [ ] RAG tool
- [ ] LangGraph state
- [ ] routing
- [ ] bounded loop
- [ ] agent traces
- [ ] agent evaluation suite

## Phase 14 — FastAPI + actions

- [ ] FastAPI app
- [ ] health route
- [ ] analytics routes
- [ ] prediction routes
- [ ] agent route
- [ ] proposal model
- [ ] proposal validation
- [ ] approve/reject routes
- [ ] simulated action executor
- [ ] audit trail
- [ ] approval UI

## Phase 15 — Hardening

- [ ] GitHub Actions
- [ ] integration test profile
- [ ] structured logs
- [ ] correlation IDs
- [ ] Prometheus metrics
- [ ] Grafana profile/dashboards
- [ ] final architecture diagrams
- [ ] model cards
- [ ] RAG evaluation report
- [ ] agent evaluation report
- [ ] final end-to-end demo script
- [ ] final clean-clone validation
