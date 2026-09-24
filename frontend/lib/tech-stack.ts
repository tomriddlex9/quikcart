// Pinned technology inventory for /tech — sourced from
// kit/01_ARCHITECTURE_AND_TECH_STACK.md §4 plus the showcase additions.

export interface TechEntry {
  name: string;
  version: string;
  role: string;
  phase: string;
  layer: string;
}

export const TECH_STACK: TechEntry[] = [
  { name: "Python", version: "3.12", role: "Main implementation language", phase: "0", layer: "Language" },
  { name: "uv", version: "pinned lockfile", role: "Environments + dependency locking", phase: "0", layer: "Tooling" },
  { name: "Ruff", version: "pinned", role: "Lint + format quality gate", phase: "0", layer: "Tooling" },
  { name: "Pytest", version: "pinned", role: "Unit, integration, contract + data-quality tests", phase: "0", layer: "Testing" },
  { name: "Docker Compose", version: "v2 plugin", role: "Local services via profiles", phase: "0", layer: "Infrastructure" },
  { name: "GitHub Actions", version: "hosted runners", role: "CI: lint + tests + compose validation", phase: "15", layer: "Infrastructure" },
  { name: "Java", version: "17", role: "Spark runtime prerequisite", phase: "0", layer: "Runtime" },
  { name: "PostgreSQL", version: "17.11", role: "Operational source of truth (OLTP)", phase: "1", layer: "Source" },
  { name: "psql / DBeaver", version: "17.x client", role: "SQL exploration", phase: "1", layer: "Tooling" },
  { name: "Faker + NumPy", version: "pinned", role: "Deterministic business simulator", phase: "1", layer: "Source" },
  { name: "PySpark", version: "4.2.0", role: "Batch + Structured Streaming transforms", phase: "3", layer: "Compute" },
  { name: "Delta Lake", version: "4.4.0", role: "ACID medallion tables, MERGE, time travel", phase: "4", layer: "Storage" },
  { name: "Local filesystem", version: "—", role: "Early lake storage mode", phase: "4", layer: "Storage" },
  { name: "SeaweedFS", version: "pinned image", role: "S3-compatible local object storage", phase: "6", layer: "Storage" },
  { name: "Redpanda", version: "pinned image", role: "Kafka-compatible streaming broker", phase: "7", layer: "Streaming" },
  { name: "Debezium", version: "3.6.3.Final", role: "PostgreSQL CDC from the WAL", phase: "8", layer: "Streaming" },
  { name: "Airflow", version: "3.3.2", role: "Batch workflow orchestration", phase: "9", layer: "Orchestration" },
  { name: "Plotly + Matplotlib", version: "pinned", role: "Analysis charts", phase: "10", layer: "Analytics" },
  { name: "Streamlit", version: "pinned", role: "Python operations dashboard (:8501)", phase: "10", layer: "UI" },
  { name: "scikit-learn", version: "pinned", role: "Baselines + anomaly detection", phase: "11", layer: "ML" },
  { name: "XGBoost", version: "pinned", role: "Delivery-delay + demand models", phase: "11", layer: "ML" },
  { name: "Spark MLlib", version: "4.2.0", role: "Spark-native ML exercises", phase: "11", layer: "ML" },
  { name: "MLflow", version: "3.16.0", role: "Experiment + model tracking", phase: "11", layer: "ML" },
  { name: "Ollama", version: "pinned", role: "Zero-cost local LLM serving", phase: "12", layer: "AI" },
  { name: "Qwen3", version: "4B/8B class", role: "Tool-capable local LLM", phase: "13", layer: "AI" },
  { name: "sentence-transformers", version: "pinned", role: "Local document embeddings", phase: "12", layer: "AI" },
  { name: "Qdrant", version: "pinned image", role: "Vector DB for internal documents", phase: "12", layer: "AI" },
  { name: "LangGraph", version: "pinned", role: "Stateful, bounded agent flows", phase: "13", layer: "AI" },
  { name: "FastAPI", version: "pinned", role: "Unified service boundary (:8000)", phase: "14", layer: "API" },
  { name: "structlog", version: "pinned", role: "Structured logs + correlation IDs", phase: "14–15", layer: "Observability" },
  { name: "Prometheus", version: "pinned image", role: "Metrics (optional monitoring profile)", phase: "15", layer: "Observability" },
  { name: "Grafana", version: "pinned image", role: "Dashboards (optional monitoring profile)", phase: "15", layer: "Observability" },
  { name: "Next.js + React", version: "15 / 19", role: "This showcase console (:3000)", phase: "Showcase", layer: "UI" },
  { name: "Tailwind CSS", version: "4", role: "Design tokens + styling", phase: "Showcase", layer: "UI" },
  { name: "recharts", version: "3", role: "Console charts (trend, GMV, rates)", phase: "Showcase", layer: "UI" },
  { name: "TypeScript", version: "5", role: "Typed contract alignment with the API", phase: "Showcase", layer: "UI" },
];

export const TECH_LAYERS = [
  "Language",
  "Runtime",
  "Tooling",
  "Testing",
  "Infrastructure",
  "Source",
  "Compute",
  "Storage",
  "Streaming",
  "Orchestration",
  "Analytics",
  "ML",
  "AI",
  "API",
  "UI",
  "Observability",
];
