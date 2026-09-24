# Data Lineage — Order Data

How one order flows from generation to the UI, and where it can be quarantined.
Two paths exist — **batch** (full history) and **streaming/CDC** (live changes) —
and they converge in Bronze before the shared Silver → Gold lineage.

## Batch lineage (historical load)

```mermaid
sequenceDiagram
    autonumber
    participant SIM as Simulator (P1)
    participant PG as PostgreSQL (P1)
    participant RAW as data/raw CSV+JSONL (P3)
    participant BZ as Bronze Delta (P4)
    participant SV as Silver Delta (P4)
    participant GD as Gold marts (P4)
    participant ML as ML models (P11)
    participant API as FastAPI (P14)
    participant UI as Streamlit / Next.js (P10/P15)

    SIM->>PG: seed_reference + historical batch (seed 42)
    PG->>RAW: quickcart.ingestion.export (full table dumps)
    RAW->>BZ: run_bronze (typed load, raw preserved)
    BZ->>SV: run_silver (schema validation, dedup, FK checks)
    Note over SV: rows failing rules → data/quarantine<br/>with _error_codes / _failed_rules
    SV->>GD: run_gold (5 marts: KPI, trends, store,<br/>inventory-risk, predictions)
    GD->>ML: feature frames (time-aware splits)
    ML-->>GD: gold_delivery_predictions / forecasts / anomalies
    GD->>API: GoldReaders (delta reads)
    ML->>API: prediction tables
    API->>UI: /api/v1/overview|trends|stores|risks|anomalies
```

## Streaming lineage (live order events)

```mermaid
sequenceDiagram
    autonumber
    participant SIM as Simulator realtime (P7)
    participant RP as Redpanda (P7)
    participant SS as Spark Streaming consumer (P7)
    participant BZ as bronze_order_events
    participant SV as Silver (incremental merge)

    SIM->>RP: publish OrderEvent (key = order_id)
    SS->>RP: subscribe quickcart.order-events.v1
    SS->>BZ: append micro-batch (checkpointed, restart-safe)
    Note over SS: malformed JSON → isolated, counted, logged
    BZ->>SV: merge on order_id (idempotent replay)
```

## CDC lineage (operational change capture)

```mermaid
sequenceDiagram
    autonumber
    participant OPS as psql / ops action
    participant PG as PostgreSQL
    participant DBZ as Debezium connector (P8)
    participant RP as Redpanda (topics quickcart.public.*)
    participant CDC as cdc consume --once (P8)
    participant BZ as bronze_orders_cdc / inventory / payments
    participant SV as Silver (CDC MERGE)
    participant API as Proposal executor (P14)

    OPS->>PG: UPDATE orders SET status = 'CANCELLED'
    PG->>DBZ: WAL + logical decoding (publication quickcart)
    DBZ->>RP: Debezium envelope {before, after, op, source}
    CDC->>RP: read micro-batch
    CDC->>BZ: append normalised CDC rows
    BZ->>SV: apply_cdc_to_silver (MERGE on op c/u/d)
    Note over API: approved RESTOCK proposal also lands here<br/>as inventory UPDATE + inventory_movements row
    API->>PG: simulated action (single transaction, audited)
    PG->>DBZ: the action itself re-enters the CDC loop
```

## Quarantine lineage (explainable failure path)

```mermaid
flowchart LR
    BZ[Bronze rows] --> RULES{Silver validation rules}
    RULES -->|"valid"| SV[Silver]
    RULES -->|"invalid: nulls, type mismatch,<br/>unknown enum, dup key, bad FK,<br/>out-of-range, bad timestamp"| Q["data/quarantine/_delta<br/>+ quality_summary"]
    Q --> GATE["silver_quality_gate:<br/>pipeline stops on gate failure"]
    GATE --> SV
```

## Key lineage invariants

- **order_id is the merge key** end-to-end: batch loads, streaming merges, and CDC
  `op`-aware MERGEs all resolve to the same Silver entity.
- **Bronze is never destructive** — raw payloads stay replayable, so any downstream
  layer can be rebuilt.
- **Every rejected row is explainable**: quarantined records carry
  `_error_codes`, `_error_messages`, `_failed_rules`, `_quarantined_at`.
- **Silver quality gate blocks Gold**: if quarantine stats exceed thresholds, the
  pipeline fails visibly instead of publishing dirty marts (no silent fallback).
- **The serving lineage is read-only** except for the single audited path:
  human-approved proposals executing a simulated inventory write (Phase 14), which
  itself re-enters the CDC loop, closing the circle.
