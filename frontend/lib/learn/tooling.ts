export interface ServiceRow {
  name: string;
  profile: string;
  port: string;
  start: string;
  notes: string;
}

export const SERVICES: ServiceRow[] = [
  {
    name: "PostgreSQL 17.11",
    profile: "core",
    port: "127.0.0.1:5434",
    start: "make core-up",
    notes: "Host port comes from POSTGRES_PORT. This machine uses 5434 because 5432 and 5433 are taken. wal_level=logical is set for CDC.",
  },
  {
    name: "SeaweedFS 3.85",
    profile: "storage",
    port: "8333 S3, 9333 admin",
    start: "make storage-up",
    notes: "Optional. Raw exports stay on the local disk. Only the lakehouse can move to S3.",
  },
  {
    name: "Redpanda v24.3.6",
    profile: "streaming",
    port: "127.0.0.1:9092",
    start: "make streaming-up",
    notes: "Also starts Redpanda Console on 8080 and Debezium. Debezium needs the core profile too, because it waits for Postgres.",
  },
  {
    name: "Debezium Connect",
    profile: "streaming",
    port: "127.0.0.1:8083",
    start: "with streaming, after core",
    notes: "Unauthenticated Connect API, bound to loopback. Register with infrastructure/debezium/register_connector.py.",
  },
  {
    name: "Airflow 3.3.2",
    profile: "orchestration",
    port: "127.0.0.1:8090",
    start: "docker compose --profile orchestration up -d",
    notes: "Not a Make target. Runs as root so it can write the mounted lakehouse. LocalExecutor only. DAGs live in orchestration/dags.",
  },
  {
    name: "MLflow 3.16.0",
    profile: "ml",
    port: "127.0.0.1:5000",
    start: "docker compose --profile ml up -d",
    notes: "SQLite backend inside the mlflowdata volume. Not a Make target.",
  },
  {
    name: "Qdrant v1.13.2",
    profile: "ai",
    port: "127.0.0.1:6333",
    start: "docker compose --profile ai up -d",
    notes: "No API key. The Python client is newer than this server and prints a compatibility warning.",
  },
  {
    name: "Prometheus + Grafana",
    profile: "monitoring",
    port: "9090 and 3000",
    start: "docker compose --profile monitoring up -d",
    notes: "Leave this profile down while this console is on port 3000. Grafana binds 127.0.0.1:3000. The Phase 15 metrics boxes are still open: the containers exist, the app is not instrumented.",
  },
  {
    name: "FastAPI",
    profile: "host process",
    port: "127.0.0.1:8000",
    start: "uv run python -m quickcart.api",
    notes: "OpenAPI at /docs. Defaults to loopback in src/quickcart/api/__main__.py.",
  },
  {
    name: "Streamlit",
    profile: "host process",
    port: "127.0.0.1:8501",
    start: "uv run streamlit run dashboard/app.py",
    notes: "There is no make dashboard-up target. Streamlit sends X-Frame-Options: DENY, so this console opens it in a new tab.",
  },
  {
    name: "Next.js console",
    profile: "host process",
    port: "127.0.0.1:3000",
    start: "cd frontend && npm run dev",
    notes: "NEXT_PUBLIC_API_BASE defaults to http://localhost:8000.",
  },
  {
    name: "Ollama",
    profile: "native, not Compose",
    port: "127.0.0.1:11434",
    start: "ollama serve, model qwen3:4b",
    notes: "First calls can return empty content while Spark and the embedding model contend for CPU. The agent retries once, then uses a deterministic grounded fallback.",
  },
];

export const MAKE_TARGETS = [
  { target: "setup", does: "uv sync --all-groups and create .env from .env.example" },
  { target: "lint / format / test", does: "Ruff and Pytest" },
  { target: "core-up / core-down", does: "PostgreSQL profile" },
  { target: "db-init / db-reset / db-check", does: "Migrations, destructive reset, integrity checks" },
  { target: "seed / seed-smoke", does: "Full historical simulation, or a tiny deterministic set" },
  { target: "export-raw", does: "Postgres to data/raw" },
  { target: "spark-demo", does: "Learning jobs over the raw files" },
  { target: "bronze / silver / gold / lakehouse", does: "Medallion pipeline. These targets are not listed in .PHONY." },
  { target: "storage-up / storage-down", does: "SeaweedFS" },
  { target: "streaming-up / streaming-down", does: "Redpanda, console, topics, Debezium image" },
  { target: "stream-consumer / simulator-live", does: "Structured Streaming consumer and the live producer" },
];

export const NOT_IN_MAKE = [
  "Airflow, MLflow, Qdrant, Prometheus, and Grafana are raw docker compose --profile commands.",
  "Model training is invoked from scripts/demo.sh, not a Make target.",
  "The API, Streamlit, and this frontend are uv run / npm commands.",
  "The agent CLI is uv run python -m quickcart.agents.cli.",
];
