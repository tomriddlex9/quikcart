# QuickCart Intelligence Platform — Architecture and Tech Stack

## 1. Project purpose

Build an end-to-end quick-commerce data and AI platform in which realistic operational data is generated, ingested, transformed through a Medallion Lakehouse, analyzed with SQL, modeled with machine learning, and exposed to an AI operations assistant that can retrieve information and propose actions.

The project is intentionally designed so that Python, SQL, PySpark, ML, RAG, and agentic AI are not isolated demos. They are layers of one coherent system.

---

## 2. High-level architecture

```text
                        QUICKCART SIMULATED BUSINESS
                                  │
               ┌──────────────────┼──────────────────┐
               │                  │                  │
          PostgreSQL         Event Stream      Files / APIs
      Orders, Customers,      App + Ops        Supplier CSV,
      Inventory, Payments      Events           Weather, SOPs
               │                  │                  │
             CDC              Redpanda           Python jobs
          Debezium          Kafka-compatible       / batch
               │                  │                  │
               └──────────────────┼──────────────────┘
                                  ▼
                           INGESTION LAYER
                                  │
                                  ▼
                         ┌────────────────┐
                         │     BRONZE     │
                         │ Raw Delta Data │
                         └───────┬────────┘
                                 │
                              PySpark
                                 │
                validation / dedup / normalization
                      CDC merge / quarantine
                                 │
                                 ▼
                         ┌────────────────┐
                         │     SILVER     │
                         │ Trusted Data   │
                         └───────┬────────┘
                                 │
                           PySpark + SQL
                                 │
                                 ▼
                         ┌────────────────┐
                         │      GOLD      │
                         │ Business Data  │
                         └───────┬────────┘
                                 │
                  ┌──────────────┼──────────────┐
                  │              │              │
                  ▼              ▼              ▼
              Analytics          ML          AI / Agents
              SQL / BI       MLflow       LangGraph
                  │              │          /   |    \
                  │        predictions    SQL  RAG   ML tools
                  │              │          │    │      │
                  └──────────────┼──────────┴────┴──────┘
                                 ▼
                              FastAPI
                                 │
                                 ▼
                       Streamlit Operations UI
                                 │
                                 ▼
                         Human-approved actions
```

---

## 3. Architectural principles

### 3.1 Local-first

The project must run locally without AWS, Azure, GCP, Databricks, Snowflake, Confluent Cloud, Pinecone, or a paid LLM API.

### 3.2 Progressive complexity

Infrastructure is introduced only when the previous layer is working and understood.

### 3.3 One source of business truth

Silver and Gold datasets become the trusted inputs for analytics, ML, and agents. The agent must not create an independent hidden copy of structured business truth in a vector database.

### 3.4 Structured data stays structured

Use SQL for operational and analytical tables.

Use RAG for unstructured documents such as SOPs, policies, manuals, and support text.

Use ML for prediction.

Use an LLM/agent to route, interpret, summarize, and coordinate tools.

### 3.5 No unrestricted agent writes

The LLM may propose actions. High-impact writes require deterministic validation and human approval.

### 3.6 Reproducibility

A new developer should be able to clone the repository, follow documented setup, seed data, and reproduce each completed phase.

---

## 4. Technology stack

| Layer | Technology | Role | Activated |
|---|---|---|---|
| Language | Python 3.12 | Main implementation language | Phase 0 |
| Python package management | uv | Environments, dependency locking | Phase 0 |
| JVM | Java 17 | Spark runtime prerequisite | Phase 0 |
| OLTP / source DB | PostgreSQL 17.11 | Transactional business system | Phase 1 |
| SQL client | DBeaver or psql | SQL exploration | Phase 1 |
| Synthetic data | Faker, NumPy | Business simulator | Phase 1 |
| Distributed compute | PySpark 4.2.0 | Batch and streaming transforms | Phase 3 |
| Lakehouse | Delta Lake 4.4.0 | ACID tables, MERGE, time travel | Phase 4 |
| Local lake storage | Local filesystem | Simplify early learning | Phase 4 |
| Object storage | SeaweedFS S3 API | S3-compatible local storage | Phase 6 |
| Streaming broker | Redpanda | Kafka-compatible event streaming | Phase 7 |
| CDC | Debezium 3.6.3.Final | PostgreSQL change capture | Phase 8 |
| Orchestration | Airflow 3.3.2 | Batch workflow scheduling | Phase 9 |
| ML libraries | scikit-learn, XGBoost | Classical ML | Phase 11 |
| Distributed ML | Spark MLlib | Learn Spark-native ML | Phase 11 |
| Experiment tracking | MLflow 3.16.0 | Runs, metrics, artifacts, models | Phase 11 |
| Visualization | Plotly, Matplotlib | Analysis and charts | Phase 10 |
| UI | Streamlit | Operations dashboard | Phase 10 |
| Local model serving | Ollama | Zero-cost local LLM inference | Phase 12 |
| Initial local LLM | Qwen3 4B/8B class model | Tool-capable LLM | Phase 13 |
| Embeddings | sentence-transformers | Local vector embeddings | Phase 12 |
| Vector DB | Qdrant | RAG retrieval | Phase 12 |
| Agent framework | LangGraph | Stateful controlled agent flows | Phase 13 |
| API | FastAPI | Unified application interface | Phase 14 |
| Testing | Pytest | Unit and integration tests | Phase 0 onward |
| Lint / format | Ruff | Python quality gates | Phase 0 |
| Containers | Docker Compose | Local services | Phase 0 onward |
| CI | GitHub Actions | Automated quality checks | Phase 15 |
| Metrics | Prometheus | System metrics | Phase 15 |
| Dashboards | Grafana | Observability | Phase 15 |

---

## 5. Why this stack

### Python

Used for simulation, ETL logic, PySpark, ML, APIs, RAG, agents, and tests. This avoids context switching between many languages while still teaching JVM-backed Spark.

### PostgreSQL

Represents the operational source system. It teaches relational modeling, transactions, indexing, query planning, and later CDC.

### PySpark

Provides distributed transformations and forces the project to deal with partitions, shuffles, joins, data skew, and execution plans.

### Delta Lake

Turns file-based storage into reliable tables with transactional behavior, versioning, MERGE, and batch/stream compatibility.

### Redpanda

Provides Kafka-compatible APIs while keeping local setup lighter. Kafka concepts remain transferable.

### Debezium

Captures row-level PostgreSQL inserts, updates, and deletes from the transaction log instead of repeatedly rescanning source tables.

### Airflow

Coordinates batch workflows, dependencies, retries, and schedules. It is not used as the streaming engine.

### MLflow

Tracks experiments and models, and later can also support tracing of GenAI workflows.

### Qdrant

Stores embeddings for company documents. It does not replace SQL for transactional data.

### LangGraph

Defines explicit, testable agent state and workflow rather than allowing an unconstrained LLM loop.

### FastAPI

Separates UI from domain logic and makes analytics, predictions, agent queries, and actions available through explicit contracts.

---

## 6. Business simulation

The fictional business should begin with approximately:

- 10 stores
- 2,000 products
- 20,000 customers
- 100 riders
- 100,000 historical orders
- 300,000–500,000 order-item rows
- 1–5 live events per second during initial streaming exercises

Scale only after correctness is proven.

### Required causal relationships

Synthetic data must contain real patterns so ML has something to learn.

Examples:

```text
Rain + peak hour + rider shortage
    → increased delivery duration
    → increased cancellation probability
```

```text
Weekend + promotion + popular category
    → demand spike
    → lower stock cover
    → increased stockout probability
```

```text
High picking queue + large basket
    → longer pick time
```

Do not generate independent random labels for ML targets.

---

## 7. Source systems

### 7.1 PostgreSQL operational tables

Core tables:

- customers
- customer_addresses
- stores
- products
- product_prices
- inventory
- inventory_movements
- orders
- order_items
- payments
- deliveries
- riders
- promotions
- promotion_usage
- support_tickets

### 7.2 Event stream

Core event topics/events:

- PRODUCT_VIEWED
- PRODUCT_SEARCHED
- ADD_TO_CART
- REMOVE_FROM_CART
- CHECKOUT_STARTED
- ORDER_PLACED
- PAYMENT_COMPLETED
- ORDER_ACCEPTED
- PICKING_STARTED
- RIDER_ASSIGNED
- ORDER_OUT_FOR_DELIVERY
- ORDER_DELIVERED
- ORDER_CANCELLED
- INVENTORY_ADJUSTED
- PAYMENT_FAILED

### 7.3 Batch files

- supplier_catalog.csv
- supplier_prices.csv
- warehouse_inventory.csv
- product_master.json

### 7.4 External API

Weather enrichment can use a free public weather API. The system should cache responses and support a local fixture so tests do not depend on the network.

### 7.5 Documents for RAG

Create fictional internal documents:

- Refund Policy
- Inventory SOP
- Delivery Incident SOP
- Store Operations Manual
- Customer Complaint Policy
- Promotion Policy

---

## 8. Medallion architecture

### Bronze

Purpose: preserve raw inputs for replay and audit.

Rules:

- Minimal transformation.
- Never silently discard malformed input.
- Add ingestion metadata.
- Preserve source payload.

Recommended metadata:

- `_ingested_at`
- `_source_system`
- `_source_file`
- `_topic`
- `_partition`
- `_offset`
- `_event_id`
- `_schema_version`
- `_ingestion_date`

### Silver

Purpose: trusted, cleaned, conformed entities.

Responsibilities:

- explicit schemas
- type conversion
- timestamp normalization
- deduplication
- null rules
- referential validation
- business rule validation
- CDC application
- SCD Type 2 where required
- bad-row quarantine
- deterministic idempotency

### Gold

Purpose: analysis-ready and ML-ready business products.

Initial Gold products:

- `gold_store_hourly_metrics`
- `gold_customer_360`
- `gold_product_performance`
- `gold_inventory_health`
- `gold_delivery_performance`
- `gold_customer_funnel`
- `gold_revenue_daily`
- `gold_demand_features`
- `gold_delivery_features`
- `gold_anomalies`
- `gold_delivery_predictions`
- `gold_demand_forecasts`

---

## 9. Spark concepts that must be demonstrated

The project is incomplete if it merely uses Spark syntax. It must deliberately demonstrate:

- DataFrames
- explicit schemas
- transformations vs actions
- lazy evaluation
- Spark SQL
- partitions
- repartition/coalesce
- shuffle
- narrow vs wide transformations
- joins
- broadcast joins
- data skew
- caching only when justified
- execution plans / `explain`
- partition pruning
- predicate pushdown where available
- small-file problem
- compaction / maintenance strategy
- Structured Streaming
- checkpoints
- event time
- processing time
- watermarks
- late data

Each optimization should be accompanied by before/after evidence in a learning note or benchmark.

---

## 10. Analytics branch

Create at least 30 SQL analyses spanning:

- store performance
- revenue
- retention
- customer cohorts
- product performance
- promotion effectiveness
- delivery SLA
- inventory health
- rider utilization
- funnel conversion
- time-series trends

The SQL exercise set must require:

- joins
- CTEs
- subqueries
- window functions
- `ROW_NUMBER`
- `RANK`
- `LAG`
- `LEAD`
- rolling metrics
- cohort logic
- funnel logic
- conditional aggregation

---

## 11. Machine-learning branch

### Model A — Delivery delay prediction

Type: binary classification.

Candidate features:

- store workload
- active orders
- available riders
- distance
- weather
- basket size
- hour/day
- historical pick duration
- recent delivery SLA

Output:

- late probability
- predicted class
- prediction timestamp
- model version

### Model B — Demand forecasting

Type: forecasting/regression.

Candidate features:

- historical SKU/store demand
- hour/day/weekend
- recent lag values
- rolling averages
- weather
- promotions
- stock availability

Output:

- expected demand for configured horizons
- confidence/uncertainty where supported
- model version

### Model C — Operational anomaly detection

Detect unusual:

- payment failures
- cancellations
- inventory movements
- demand spikes
- delivery durations

Outputs must be written back into Gold so analytics and agents can consume them.

---

## 12. RAG branch

Pipeline:

```text
Documents
   ↓
Parser
   ↓
Section-aware chunking
   ↓
Local embeddings
   ↓
Qdrant
   ↓
Retriever
   ↓
LLM
```

Requirements:

- keep document metadata
- include document title, section, version, effective date
- return citations/metadata with retrieved chunks
- support deterministic local fixtures in tests
- evaluate retrieval separately from generation

Do not embed massive transactional tables into Qdrant.

---

## 13. Agentic AI branch

Initial tools:

- `query_gold`
- `get_store_metrics`
- `get_inventory`
- `get_order`
- `get_customer_summary`
- `forecast_demand`
- `predict_delivery_delay`
- `list_active_anomalies`
- `search_company_docs`

Action proposal tools introduced later:

- `create_restock_proposal`
- `create_incident_proposal`
- `create_ops_notification_proposal`

Agent workflow:

```text
START
  ↓
Classify intent
  ↓
Create bounded plan
  ↓
Choose approved tool
  ↓
Execute
  ↓
Validate result
  ↓
Need another tool?
  ├─ Yes → loop with max-step limit
  └─ No
       ↓
Generate grounded answer
       ↓
Action requested?
  ├─ No → END
  └─ Yes
       ↓
Create proposal
       ↓
Human approval
       ↓
Deterministic action service
       ↓
Audit log
```

### Agent safety rules

- SQL agent defaults to read-only.
- Disallow arbitrary DDL/DML through the LLM path.
- Limit result sizes.
- Enforce timeout.
- Validate every tool argument.
- Cap tool-call steps.
- Never let the model execute shell commands.
- Never expose raw secrets to prompts.
- Action proposals are validated independently of LLM text.
- Store agent trace and final action decision.

---

## 14. API architecture

FastAPI becomes the stable service boundary.

Initial route groups:

```text
/health
/api/v1/stores
/api/v1/orders
/api/v1/inventory
/api/v1/analytics
/api/v1/predictions
/api/v1/agent/chat
/api/v1/proposals
/api/v1/proposals/{id}/approve
/api/v1/proposals/{id}/reject
/api/v1/incidents
```

Domain services should not depend on Streamlit.

---

## 15. UI architecture

Streamlit should provide:

1. Executive overview
2. Orders
3. Stores
4. Inventory
5. Delivery
6. Customers
7. ML predictions
8. Anomalies
9. AI assistant
10. Action approval queue
11. Data-pipeline status

UI is not the source of business logic.

---

## 16. Docker strategy

Use Compose profiles rather than launching every service.

Suggested profiles:

```text
core
  postgres

lakehouse
  spark

streaming
  redpanda
  redpanda-console
  debezium

orchestration
  airflow

ml
  mlflow

ai
  qdrant

monitoring
  prometheus
  grafana
```

Ollama may run natively or in a container depending on GPU support and host OS.

---

## 17. Repository structure

```text
quickcart-intelligence/
│
├── README.md
├── AGENTS.md
├── pyproject.toml
├── uv.lock
├── .python-version
├── .env.example
├── Makefile
├── docker-compose.yml
│
├── docs/
│   ├── architecture/
│   ├── learning/
│   ├── data_dictionary/
│   └── decisions/
│
├── infrastructure/
│   ├── postgres/
│   ├── spark/
│   ├── redpanda/
│   ├── debezium/
│   ├── airflow/
│   ├── mlflow/
│   ├── qdrant/
│   └── monitoring/
│
├── simulator/
│   ├── generators/
│   ├── historical/
│   └── realtime/
│
├── ingestion/
│   ├── batch/
│   ├── api/
│   ├── streaming/
│   └── cdc/
│
├── lakehouse/
│   ├── bronze/
│   ├── silver/
│   ├── gold/
│   └── common/
│
├── sql/
│   ├── ddl/
│   ├── exploration/
│   ├── marts/
│   └── exercises/
│
├── ml/
│   ├── features/
│   ├── delivery_delay/
│   ├── demand_forecast/
│   └── anomaly_detection/
│
├── ai/
│   ├── rag/
│   ├── agents/
│   ├── tools/
│   ├── prompts/
│   └── evaluation/
│
├── orchestration/
│   └── dags/
│
├── api/
├── dashboard/
├── notebooks/
├── data/
│   ├── raw/
│   ├── bronze/
│   ├── silver/
│   └── gold/
│
└── tests/
    ├── unit/
    ├── integration/
    ├── contracts/
    └── data_quality/
```

Generated datasets, databases, model artifacts, logs, and secrets must not be committed.

---

## 18. Technologies deliberately excluded from the initial project

Do not introduce these without an ADR and a concrete learning reason:

- Kubernetes
- paid cloud infrastructure
- Databricks
- Snowflake
- managed Kafka
- Pinecone
- Terraform
- Elasticsearch
- a full feature store
- microservices for every domain
- multiple frontend frameworks

The goal is to learn architecture, not maximize the number of logos in the README.

---

## 19. Cost model

All default components are local/open-source.

Direct infrastructure cost target: ₹0.

Potential non-monetary costs:

- RAM
- CPU/GPU usage
- storage
- electricity
- developer time

Resource-heavy profiles must be started only when needed.

---

## 20. Current-version references

Version decisions were checked against official project sources on 2026-09-23.

- Apache Spark news/downloads: https://spark.apache.org/news/ and https://spark.apache.org/downloads/
- Delta Lake releases: https://delta.io/ and https://docs.delta.io/releases/
- PostgreSQL releases: https://www.postgresql.org/docs/release/
- Debezium 3.6 release notes: https://debezium.io/releases/3.6/release-notes
- Airflow announcements: https://airflow.apache.org/announcements/
- MLflow releases: https://mlflow.org/releases/

Treat exact versions as an implementation baseline, not a reason to upgrade mid-phase.
