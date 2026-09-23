# QuickCart — Setup and Local Runbook

This is the target runbook the implementation should progressively satisfy. Commands may evolve, but the final repository should keep an equally simple interface.

---

# 1. Host recommendation

For the complete stack, prefer a machine with substantial RAM. The full set of services should not be run simultaneously unless needed.

For Windows development, WSL2 + Docker Desktop is a practical target.

For macOS/Linux, native Docker/Desktop equivalents are acceptable.

---

# 2. Required Phase 0 host tools

Install:

- Git
- Python 3.12 or use `uv` managed Python
- `uv`
- Java 17
- Docker + Docker Compose
- optional DBeaver
- editor: Cursor/Kimi/VS Code/etc.

Verify:

```bash
git --version
uv --version
java -version
docker --version
docker compose version
```

---

# 3. Expected repository bootstrap

Target commands:

```bash
uv sync --all-groups
cp .env.example .env
uv run pytest
uv run ruff check .
```

If dependency groups become large, the default command may install only current-phase requirements and separate commands may install later extras.

---

# 4. Docker profiles

Target profile design:

```text
core            PostgreSQL
lakehouse       optional Spark service if containerized
storage         SeaweedFS
streaming       Redpanda + console + Debezium
orchestration   Airflow
ml              MLflow
ai              Qdrant
monitoring      Prometheus + Grafana
```

Example target commands:

```bash
docker compose --profile core up -d

docker compose --profile core --profile streaming up -d

docker compose --profile core --profile ml up -d
```

Do not make every profile a dependency of every other profile.

---

# 5. Environment variables

The final `.env.example` should document fields such as:

```text
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD

QUICKCART_DATA_ROOT
QUICKCART_STORAGE_BACKEND

REDPANDA_BOOTSTRAP_SERVERS

S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
S3_BUCKET

MLFLOW_TRACKING_URI

QDRANT_URL
OLLAMA_BASE_URL
OLLAMA_MODEL

APP_ENV
LOG_LEVEL
```

Values should default to safe local development behavior where possible.

---

# 6. Phase 1 run sequence

Target:

```bash
docker compose --profile core up -d

# initialize schema
uv run python -m quickcart.db.init

# seed reference + historical data
uv run python -m quickcart.simulator.historical --seed 42 --orders 100000

# validate
uv run python -m quickcart.db.validate
```

Equivalent Make targets are encouraged:

```bash
make core-up
make db-init
make seed
make db-check
```

---

# 7. Phase 3/4 lakehouse run sequence

Target:

```bash
make export-raw
make bronze
make silver
make gold
make data-quality
```

Or:

```bash
make lakehouse
```

The combined target must stop if a critical quality gate fails.

---

# 8. Local data layout

Before S3-compatible storage:

```text
data/
  raw/
  bronze/
  silver/
  gold/
  quarantine/
  checkpoints/
  artifacts/
```

These directories should be ignored by Git except small deterministic fixtures explicitly stored under `tests/fixtures/`.

---

# 9. Storage backend switch

When Phase 6 exists, configuration should allow:

```text
QUICKCART_STORAGE_BACKEND=local
```

or:

```text
QUICKCART_STORAGE_BACKEND=s3
```

Business transformation code should not need editing when switching.

---

# 10. Streaming run sequence

Target:

```bash
docker compose --profile core --profile streaming up -d

make stream-consumer
make simulator-live
```

Prefer separate terminals/processes for long-running jobs in learning mode so logs remain understandable.

Provide commands to:

- create/list topics
- inspect recent events
- stop simulator gracefully
- reset local topics/checkpoints for an exercise

---

# 11. CDC demo sequence

Target demo:

```text
1. Start PostgreSQL + Redpanda + Debezium.
2. Register/verify connector.
3. Start CDC Spark consumer.
4. Update an order in PostgreSQL.
5. Inspect broker event.
6. Inspect Bronze CDC row.
7. Run/observe Silver MERGE.
8. Query updated Gold metric.
```

Document exact commands when implemented.

---

# 12. Airflow run sequence

The implementation should expose the Airflow UI URL and credentials through local development documentation, not hard-coded in source.

Provide:

```bash
make airflow-up
make airflow-check
```

DAGs should import without side effects or expensive work at parse time.

---

# 13. ML run sequence

Target:

```bash
make mlflow-up
make features
make train-delivery-model
make train-demand-model
make detect-anomalies
make predict
```

The runbook must state where:

- MLflow UI is available
- model artifacts are stored
- prediction tables are written

---

# 14. RAG run sequence

Target:

```bash
make ai-infra-up
make rag-index
make rag-eval
```

Then test a local query.

Index build should be repeatable without creating duplicate logical chunks.

---

# 15. Agent run sequence

Target:

```bash
make ollama-check
make agent-eval
make api-up
```

Provide a small CLI before requiring the dashboard:

```bash
uv run python -m quickcart.agents.cli "Why are deliveries late at Store 8 today?"
```

This makes the agent testable independently from Streamlit.

---

# 16. Reset strategy

The project must have clearly separated reset scopes.

Examples:

```text
make reset-db
make reset-lakehouse
make reset-streaming
make reset-ml
make reset-ai-index
make reset-all
```

`reset-all` must be clearly marked destructive.

---

# 17. Troubleshooting sections the final repo should contain

At minimum document:

- Java not found
- Spark/Delta dependency mismatch
- Docker port conflict
- PostgreSQL connection refused
- logical replication not enabled
- Debezium connector unhealthy
- Redpanda topic missing
- Spark checkpoint corruption during intentional reset
- S3 endpoint/credential error
- Airflow DAG import error
- Ollama model not available
- Qdrant index empty
- local machine memory pressure

---

# 18. Resource management

The implementation should place sensible Docker resource limits where useful and document recommended profile combinations.

Avoid running all of these at once just because they exist:

```text
Spark
Airflow
Redpanda
Debezium
MLflow
Qdrant
Ollama
Grafana
```

Learning mode should favor clarity over "production-like" density.
