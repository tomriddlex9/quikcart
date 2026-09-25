// Pinned technology inventory for /tech — sourced from kit/01 §4,
// pyproject.toml, docker-compose.yml, and frontend/package.json.

export interface TechEntry {
  name: string;
  version: string;
  role: string;
  phase: string;
  layer: string;
  presence: "required" | "optional" | "host";
  port: string;
  profile: string;
}

export const TECH_STACK: TechEntry[] = [
  { name: "Python", version: "3.12", role: "Main implementation language", phase: "0", layer: "Language", presence: "required", port: "—", profile: "host" },
  { name: "uv", version: "lockfile", role: "Environments and dependency locking", phase: "0", layer: "Tooling", presence: "required", port: "—", profile: "host" },
  { name: "Ruff", version: ">=0.6", role: "Lint and format gate", phase: "0", layer: "Tooling", presence: "required", port: "—", profile: "dev group" },
  { name: "Pytest", version: ">=8.2", role: "Unit, integration, contract, and data-quality tests", phase: "0", layer: "Testing", presence: "required", port: "—", profile: "dev group" },
  { name: "Docker Compose", version: "v2 plugin", role: "Local services via profiles. Nothing starts by default.", phase: "0", layer: "Infrastructure", presence: "required", port: "—", profile: "host" },
  { name: "GitHub Actions", version: "hosted runners", role: "CI: Ruff, Pytest, and compose validation", phase: "15", layer: "Infrastructure", presence: "required", port: "—", profile: ".github/workflows/ci.yml" },
  { name: "Java", version: "17", role: "Spark runtime prerequisite", phase: "0", layer: "Runtime", presence: "required", port: "—", profile: "host" },
  { name: "PostgreSQL", version: "17.11", role: "Operational source of truth", phase: "1", layer: "Source", presence: "required", port: "127.0.0.1:5434", profile: "core" },
  { name: "psql / DBeaver", version: "optional client", role: "SQL exploration", phase: "1", layer: "Tooling", presence: "optional", port: "—", profile: "host" },
  { name: "Faker", version: ">=30.0", role: "Deterministic business simulator", phase: "1", layer: "Source", presence: "required", port: "—", profile: "runtime dep" },
  { name: "NumPy", version: ">=2.1", role: "Simulator numerics", phase: "1", layer: "Source", presence: "required", port: "—", profile: "runtime dep" },
  { name: "PySpark", version: "4.2.0", role: "Batch and Structured Streaming transforms", phase: "3", layer: "Compute", presence: "required", port: "—", profile: "spark group" },
  { name: "Delta Lake", version: "4.4.0", role: "ACID medallion tables, MERGE, time travel", phase: "4", layer: "Storage", presence: "required", port: "—", profile: "spark group" },
  { name: "Local filesystem", version: "default backend", role: "Lake storage before the S3 profile", phase: "4", layer: "Storage", presence: "required", port: "—", profile: "data/" },
  { name: "SeaweedFS", version: "3.85", role: "S3-compatible local object storage", phase: "6", layer: "Storage", presence: "optional", port: "8333 / 9333", profile: "storage" },
  { name: "Redpanda", version: "v24.3.6", role: "Kafka-compatible streaming broker", phase: "7", layer: "Streaming", presence: "optional", port: "127.0.0.1:9092", profile: "streaming" },
  { name: "Redpanda Console", version: "v2.8.0", role: "Topic browser", phase: "7", layer: "Streaming", presence: "optional", port: "127.0.0.1:8080", profile: "streaming" },
  { name: "Debezium", version: "3.6.3.Final", role: "PostgreSQL CDC from the WAL", phase: "8", layer: "Streaming", presence: "optional", port: "127.0.0.1:8083", profile: "streaming" },
  { name: "Airflow", version: "3.3.2", role: "Batch workflow orchestration", phase: "9", layer: "Orchestration", presence: "optional", port: "127.0.0.1:8090", profile: "orchestration" },
  { name: "Plotly", version: ">=5.24", role: "Streamlit charts", phase: "10", layer: "Analytics", presence: "required", port: "—", profile: "dashboard group" },
  { name: "Matplotlib", version: ">=3.9", role: "Analysis charts", phase: "10", layer: "Analytics", presence: "required", port: "—", profile: "dashboard group" },
  { name: "Streamlit", version: ">=1.40", role: "Operations dashboard", phase: "10", layer: "UI", presence: "host", port: "127.0.0.1:8501", profile: "host process" },
  { name: "scikit-learn", version: ">=1.5", role: "Baselines and anomaly detection", phase: "11", layer: "ML", presence: "required", port: "—", profile: "ml group" },
  { name: "XGBoost", version: ">=2.1", role: "Delivery-delay and demand models", phase: "11", layer: "ML", presence: "required", port: "—", profile: "ml group" },
  { name: "Spark MLlib", version: "4.2.0", role: "Spark-native ML exercises", phase: "11", layer: "ML", presence: "optional", port: "—", profile: "spark group" },
  { name: "MLflow", version: "3.16.0", role: "Experiment and model tracking", phase: "11", layer: "ML", presence: "optional", port: "127.0.0.1:5000", profile: "ml" },
  { name: "Ollama", version: "native", role: "Zero-cost local LLM serving", phase: "12", layer: "AI", presence: "optional", port: "127.0.0.1:11434", profile: "not Compose" },
  { name: "Qwen3", version: "qwen3:4b", role: "Default local model in settings.py", phase: "13", layer: "AI", presence: "optional", port: "11434", profile: "Ollama" },
  { name: "sentence-transformers", version: ">=3.0", role: "Local embeddings, default all-MiniLM-L6-v2", phase: "12", layer: "AI", presence: "required", port: "—", profile: "ai group" },
  { name: "Qdrant", version: "v1.13.2", role: "Vector database for internal documents", phase: "12", layer: "AI", presence: "optional", port: "127.0.0.1:6333", profile: "ai" },
  { name: "LangGraph", version: ">=0.6", role: "Bounded agent graph", phase: "13", layer: "AI", presence: "required", port: "—", profile: "ai group" },
  { name: "FastAPI", version: ">=0.115", role: "Service boundary", phase: "14", layer: "API", presence: "host", port: "127.0.0.1:8000", profile: "host process" },
  { name: "Uvicorn", version: ">=0.30", role: "ASGI server", phase: "14", layer: "API", presence: "host", port: "8000", profile: "ai group" },
  { name: "structlog", version: ">=24.1", role: "Structured logs and correlation IDs", phase: "14–15", layer: "Observability", presence: "required", port: "—", profile: "runtime dep" },
  { name: "Prometheus", version: "v2.55.1", role: "Metrics scrape config exists; app metrics are not wired", phase: "15", layer: "Observability", presence: "optional", port: "127.0.0.1:9090", profile: "monitoring" },
  { name: "Grafana", version: "11.4.0", role: "Dashboards. Binds port 3000, so it clashes with this console.", phase: "15", layer: "Observability", presence: "optional", port: "127.0.0.1:3000", profile: "monitoring" },
  { name: "Next.js", version: "^15.3.3", role: "This showcase console", phase: "Showcase", layer: "UI", presence: "host", port: "127.0.0.1:3000", profile: "frontend" },
  { name: "React", version: "^19.1.0", role: "Console UI", phase: "Showcase", layer: "UI", presence: "host", port: "—", profile: "frontend" },
  { name: "Tailwind CSS", version: "^4.1.8", role: "Design tokens and styling", phase: "Showcase", layer: "UI", presence: "host", port: "—", profile: "frontend" },
  { name: "recharts", version: "^3.1.0", role: "Overview charts", phase: "Showcase", layer: "UI", presence: "host", port: "—", profile: "frontend" },
  { name: "TypeScript", version: "^5.8.3", role: "Typed pages and API client", phase: "Showcase", layer: "UI", presence: "host", port: "—", profile: "frontend" },
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
