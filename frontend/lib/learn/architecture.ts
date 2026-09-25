export const ARCHITECTURE_INTRO = {
  title: "System architecture",
  description:
    "QuickCart is a local-first learning platform that simulates a quick-commerce business and carries that data from PostgreSQL through a Delta medallion lakehouse into analytics, three ML models, document retrieval, and a bounded agent. Nothing here calls a paid API.",
};

export const LAYERS = [
  {
    name: "Simulated business",
    phase: "1",
    summary:
      "A deterministic Python simulator writes stores, customers, catalog, inventory, orders, payments, deliveries, and support tickets. Seed 42 reproduces the same history.",
  },
  {
    name: "Operational source",
    phase: "1",
    summary:
      "PostgreSQL 17.11 is the only system of record. Silver and Gold are derived. The agent does not keep a second copy of the business tables.",
  },
  {
    name: "Event path",
    phase: "7–8",
    summary:
      "The live simulator publishes order, app, and rider events to Redpanda. Debezium reads the Postgres WAL and publishes orders, inventory, and payments changes onto the same broker.",
  },
  {
    name: "Batch path",
    phase: "3–4",
    summary:
      "quickcart.ingestion.export dumps CSV and JSONL into data/raw. PySpark loads typed Bronze Delta tables, validates Silver, and publishes Gold marts. Invalid rows go to quarantine with error codes.",
  },
  {
    name: "Intelligence",
    phase: "11–13",
    summary:
      "Three models write predictions back into Gold. Qdrant holds embeddings of internal policy documents only. The LangGraph agent may read Gold, ML tables, and those documents, and may only create a pending proposal.",
  },
  {
    name: "Serving",
    phase: "10–14",
    summary:
      "FastAPI is the service boundary. Streamlit reads Delta directly for operations charts. This Next.js console reads the API and falls back to labeled demo data when the API is unreachable.",
  },
];

export const TRUST_STEPS = [
  "An analyst asks the agent a question.",
  "The graph calls a fixed set of typed tools. SQL is read-only and limited to silver_* and gold_* tables.",
  "If a restock looks warranted, the agent creates a PENDING proposal. It cannot approve it.",
  "A person reviews the evidence and types a name. That name is an audit label, not a login.",
  "On approve, the API re-checks the stored row against the live database, then updates inventory and writes a movement in one transaction.",
  "That Postgres change can re-enter the platform through Debezium.",
];

export const COMPONENTS: {
  name: string;
  tech: string;
  role: string;
  phase: string;
}[] = [
  { name: "Business simulator", tech: "Python, Faker, NumPy", role: "Historical and live operational data", phase: "1" },
  { name: "Operational database", tech: "PostgreSQL 17.11", role: "OLTP source of truth", phase: "1" },
  { name: "SQL exercises", tech: "30 queries in sql/exercises", role: "Analytics on the operational schema", phase: "2" },
  { name: "Raw export", tech: "CSV + JSONL", role: "Batch extract into data/raw", phase: "3" },
  { name: "Lakehouse compute", tech: "PySpark 4.2.0, Java 17", role: "Batch and streaming transforms", phase: "3–5" },
  { name: "Lakehouse storage", tech: "Delta Lake 4.4.0", role: "Bronze, Silver, Gold ACID tables", phase: "4" },
  { name: "Object storage", tech: "SeaweedFS 3.85", role: "Optional S3 backend for the lakehouse", phase: "6" },
  { name: "Broker", tech: "Redpanda v24.3.6", role: "Kafka-compatible event log", phase: "7" },
  { name: "CDC", tech: "Debezium 3.6.3.Final", role: "Postgres WAL to Redpanda", phase: "8" },
  { name: "Orchestration", tech: "Airflow 3.3.2", role: "Batch DAGs, not the live stream", phase: "9" },
  { name: "Operations UI", tech: "Streamlit", role: "Gold charts and the quality summary", phase: "10" },
  { name: "Models", tech: "scikit-learn, XGBoost", role: "Delay, demand, anomalies", phase: "11" },
  { name: "Tracking", tech: "MLflow 3.16.0", role: "Runs, metrics, artifacts", phase: "11" },
  { name: "Embeddings", tech: "all-MiniLM-L6-v2", role: "Local vectors for policy docs", phase: "12" },
  { name: "Vector store", tech: "Qdrant v1.13.2", role: "Retrieval, not analytical tables", phase: "12" },
  { name: "LLM", tech: "Ollama, qwen3:4b", role: "Local generation", phase: "12–13" },
  { name: "Agent", tech: "LangGraph", role: "Bounded tools and proposals", phase: "13" },
  { name: "API", tech: "FastAPI", role: "Reads, chat, human approval", phase: "14" },
  { name: "Console", tech: "Next.js", role: "This showcase", phase: "14–15" },
];
