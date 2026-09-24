// Static model of the implemented platform, rendered by /system.
// Coordinates are in a 1280x660 design space; nodes are absolutely positioned
// as percentages so the SVG edge layer and the HTML node layer stay aligned.

export type EdgeKind =
  | "batch"
  | "stream"
  | "cdc"
  | "rag"
  | "serve"
  | "ops";

export interface MapNode {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  phase: number;
  phaseLabel: string;
  layer: string;
  role: string;
  facts: string[];
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
}

export const EDGE_KIND_META: Record<EdgeKind, { label: string; color: string }> = {
  batch: { label: "batch", color: "#8b94a3" },
  stream: { label: "streaming", color: "#5cc0b0" },
  cdc: { label: "CDC", color: "#f2a93b" },
  rag: { label: "RAG", color: "#b48ede" },
  serve: { label: "serving", color: "#e9e2d2" },
  ops: { label: "ops / storage", color: "#6f7d92" },
};

export const MAP_W = 1280;
export const MAP_H = 660;

export const MAP_NODES: MapNode[] = [
  {
    id: "simulator",
    label: "Business simulator",
    sub: "Faker + NumPy · seed 42",
    x: 100, y: 90, w: 168, h: 58,
    phase: 1, phaseLabel: "Phase 1", layer: "Source",
    role: "Deterministic quick-commerce world: 10 stores, 2,000 products, 20,000 customers and 100k historical orders with encoded demand, weather, rider and promotion causality.",
    facts: [
      "Demand = base × hour × weekday × store × popularity × promotion × weather",
      "Late deliveries derived from pick time + queue + distance + rider shortage",
      "Everything reproducible from seed 42 — no IID random labels",
    ],
  },
  {
    id: "docs",
    label: "Internal documents",
    sub: "6 SOPs & policies",
    x: 100, y: 540, w: 168, h: 58,
    phase: 12, phaseLabel: "Phase 12", layer: "Source",
    role: "Fictional but realistic company knowledge: refund policy, inventory SOP, delivery incident SOP, store operations manual, complaint policy, promotion policy.",
    facts: [
      "Markdown with YAML-ish frontmatter: title, doc_id, version, effective_date",
      "Section-aware chunks keep headings with their text",
      "Evaluated with a 15–20 question retrieval eval set before any LLM answer work",
    ],
  },
  {
    id: "postgres",
    label: "PostgreSQL 17.11",
    sub: "operational source + WAL",
    x: 100, y: 300, w: 168, h: 58,
    phase: 1, phaseLabel: "Phase 1", layer: "Source",
    role: "The transactional business system of record: orders, customers, inventory, payments, deliveries, riders, promotions, support tickets.",
    facts: [
      "16 core tables behind versioned migrations (V001…)",
      "wal_level=logical so Debezium can read the write-ahead log",
      "Inventory movements + restock proposals stay transactional here",
    ],
  },
  {
    id: "debezium",
    label: "Debezium 3.6",
    sub: "change data capture",
    x: 310, y: 200, w: 160, h: 58,
    phase: 8, phaseLabel: "Phase 8", layer: "Ingest",
    role: "Captures row-level inserts, updates and deletes from the Postgres WAL instead of rescanning tables — the honest way to feed downstream systems.",
    facts: [
      "Connectors for orders, inventory and payments",
      "Emits to Redpanda topics consumed by the lakehouse",
      "Insert/update/delete behaviour demonstrated end-to-end",
    ],
  },
  {
    id: "redpanda",
    label: "Redpanda",
    sub: "Kafka-compatible broker",
    x: 310, y: 430, w: 160, h: 58,
    phase: 7, phaseLabel: "Phase 7", layer: "Ingest",
    role: "The event backbone for app and ops events — Kafka API without a JVM or ZooKeeper, keeping the local footprint small.",
    facts: [
      "17 event topics from PRODUCT_VIEWED to ORDER_CANCELLED",
      "Live simulator produces 1–5 events/sec during streaming runs",
      "Redpanda Console for browsing topics",
    ],
  },
  {
    id: "spark-stream",
    label: "Spark Structured Streaming",
    sub: "event-time · watermarks",
    x: 520, y: 80, w: 168, h: 58,
    phase: 7, phaseLabel: "Phase 7", layer: "Lakehouse",
    role: "Micro-batch consumer for the Redpanda topics: parses, validates and lands stream events into Bronze with exactly the Bronze metadata contract.",
    facts: [
      "Persistent checkpoints under data/checkpoints",
      "Event time separated from ingest time; watermark exercises included",
      "Malformed events isolated, never silently dropped",
    ],
  },
  {
    id: "pyspark",
    label: "PySpark 4.2 · batch",
    sub: "bronze → silver → gold",
    x: 520, y: 240, w: 168, h: 58,
    phase: 3, phaseLabel: "Phases 3–5", layer: "Lakehouse",
    role: "The batch engine of the medallion pipeline: explicit schemas, validation, dedup, MERGE, SCD2 and the Gold marts — with explain-plans captured before and after every optimization.",
    facts: [
      "DataFrames + Spark SQL; no Pandas shortcuts on the main path",
      "Bad rows quarantined with structured error codes, never filtered away",
      "Partition-pruning, broadcast-join, skew and small-file experiments on record",
    ],
  },
  {
    id: "airflow",
    label: "Airflow 3.3.2",
    sub: "batch orchestration",
    x: 520, y: 400, w: 168, h: 58,
    phase: 9, phaseLabel: "Phase 9", layer: "Lakehouse",
    role: "Schedules and retries the batch workflows — supplier ingestion, Bronze→Silver, Silver→Gold, quality gates and weather — explicitly not the streaming engine.",
    facts: [
      "DAGs under orchestration/dags with documented backfill/retry policy",
      "Quality-gate task fails the run instead of hiding bad data",
      "Streams keep running when Airflow is down",
    ],
  },
  {
    id: "seaweedfs",
    label: "SeaweedFS",
    sub: "S3-compatible object store",
    x: 520, y: 560, w: 168, h: 58,
    phase: 6, phaseLabel: "Phase 6", layer: "Lakehouse",
    role: "Local S3-compatible object storage so the lakehouse exercises real S3A semantics instead of pretending the local disk is a cloud bucket.",
    facts: [
      "Spark S3A connector configured against the SeaweedFS endpoint",
      "Storage-backend abstraction keeps local disk mode working",
      "Zero-cost stand-in for S3 in exercises",
    ],
  },
  {
    id: "delta",
    label: "Delta Lake 4.4",
    sub: "bronze · silver · gold",
    x: 730, y: 250, w: 170, h: 66,
    phase: 4, phaseLabel: "Phases 4–6", layer: "Storage",
    role: "ACID table layer over Parquet: MERGE for CDC and SCD2, time travel for audits, and a quarantine path that explains every rejected row.",
    facts: [
      "Bronze preserves raw payloads + ingestion metadata for replay",
      "Silver = trusted, conformed entities; Gold = 12 analysis-ready marts",
      "gold_anomalies, gold_delivery_predictions, gold_demand_forecasts feed the API",
    ],
  },
  {
    id: "ml",
    label: "sklearn · XGBoost",
    sub: "MLflow 3.16 tracking",
    x: 950, y: 80, w: 168, h: 58,
    phase: 11, phaseLabel: "Phase 11", layer: "Intelligence",
    role: "Three classical models with baselines, leakage review and MLflow-tracked metrics: delivery-delay classifier, demand forecaster, operational anomaly detectors.",
    facts: [
      "Predictions written back into Gold for analytics and agents",
      "Every model: target, baseline, features, split, metrics, model version",
      "Interpretable first models before any tuning",
    ],
  },
  {
    id: "qdrant",
    label: "Qdrant",
    sub: "vector retrieval",
    x: 950, y: 230, w: 168, h: 58,
    phase: 12, phaseLabel: "Phase 12", layer: "Intelligence",
    role: "Vector store for the six internal documents only — unstructured knowledge, never a hidden copy of structured business tables.",
    facts: [
      "Collection quickcart_docs, cosine distance, deterministic point IDs",
      "Rebuilding the index from the same chunks yields the same point count",
      "Out-of-scope questions return low scores instead of invented answers",
    ],
  },
  {
    id: "embed",
    label: "sentence-transformers",
    sub: "local embeddings",
    x: 950, y: 370, w: 168, h: 58,
    phase: 12, phaseLabel: "Phase 12", layer: "Intelligence",
    role: "Local embedding model (all-MiniLM-L6-v2 by default) — retrieval quality without a single external API call or rupee spent.",
    facts: [
      "Model name configurable via QUICKCART_EMBEDDING_MODEL",
      "Embedder accepts an injectable callable so unit tests never download weights",
      "Evaluated separately from answer generation",
    ],
  },
  {
    id: "ollama",
    label: "Ollama · qwen3 + LangGraph",
    sub: "bounded agent",
    x: 950, y: 540, w: 176, h: 58,
    phase: 13, phaseLabel: "Phase 13", layer: "Intelligence",
    role: "A stateful but bounded operations assistant: typed tool allow-list, read-only SQL, capped tool-call loop, and proposals instead of writes.",
    facts: [
      "Tools: query_gold, inventory/store/order lookups, forecasts, RAG search",
      "SQL tool is SELECT-only, allow-listed, size-limited and timed out",
      "High-impact actions become proposals pending human approval",
    ],
  },
  {
    id: "fastapi",
    label: "FastAPI",
    sub: "service boundary :8000",
    x: 1160, y: 140, w: 168, h: 58,
    phase: 14, phaseLabel: "Phase 14", layer: "Serving",
    role: "The stable contract between UI and platform: KPIs, trends, stores, inventory risk, anomalies, predictions, agent chat and the proposal lifecycle.",
    facts: [
      "Versioned /api/v1 routes with Pydantic contracts",
      "Proposal approval re-validates from the DB row, never client payloads",
      "Executor runs in one transaction: inventory update + movement + audit",
    ],
  },
  {
    id: "streamlit",
    label: "Streamlit",
    sub: "ops dashboard :8501",
    x: 1160, y: 290, w: 168, h: 58,
    phase: 10, phaseLabel: "Phase 10", layer: "Serving",
    role: "The original operations dashboard — 8 pages from executive overview to the action approval queue, embedded in this console at /streamlit.",
    facts: [
      "Reads Gold marts through the same readers as the API",
      "ML predictions and anomaly pages consume Gold write-backs",
      "Zero frontend build step — pure Python",
    ],
  },
  {
    id: "nextjs",
    label: "Next.js console",
    sub: "this showcase",
    x: 1160, y: 430, w: 168, h: 58,
    phase: 15, phaseLabel: "Showcase", layer: "Serving",
    role: "The page you are looking at: a typed operations console over the FastAPI contracts with labeled demo-data fallback and a live system map.",
    facts: [
      "App Router + TypeScript + Tailwind, charts via recharts",
      "Polls the API every 30s; every fetch failure is labeled, never faked",
      "System map and tech grid generated from static repo-derived data",
    ],
  },
  {
    id: "prom",
    label: "Prometheus + Grafana",
    sub: "metrics & dashboards",
    x: 1160, y: 580, w: 168, h: 58,
    phase: 15, phaseLabel: "Phase 15", layer: "Serving",
    role: "Optional observability profile: Prometheus scrapes service metrics, Grafana dashboards make them legible.",
    facts: [
      "docker compose --profile monitoring up -d",
      "Prometheus :9090 · Grafana :3000 (admin / quickcart_grafana_dev)",
      "Config-validated; the platform runs fully without it",
    ],
  },
];

export const MAP_EDGES: MapEdge[] = [
  { id: "e1", from: "simulator", to: "postgres", label: "seed + ops writes", kind: "batch" },
  { id: "e2", from: "postgres", to: "debezium", label: "WAL", kind: "cdc" },
  { id: "e3", from: "debezium", to: "redpanda", label: "change events", kind: "cdc" },
  { id: "e4", from: "simulator", to: "redpanda", label: "app events", kind: "stream" },
  { id: "e5", from: "redpanda", to: "spark-stream", label: "consume", kind: "stream" },
  { id: "e6", from: "spark-stream", to: "delta", label: "micro-batches", kind: "stream" },
  { id: "e7", from: "postgres", to: "pyspark", label: "export-raw", kind: "batch" },
  { id: "e8", from: "pyspark", to: "delta", label: "validate + transform", kind: "batch" },
  { id: "e9", from: "airflow", to: "pyspark", label: "orchestrates", kind: "ops" },
  { id: "e10", from: "seaweedfs", to: "delta", label: "S3A objects", kind: "ops" },
  { id: "e11", from: "delta", to: "ml", label: "feature tables", kind: "batch" },
  { id: "e12", from: "ml", to: "delta", label: "predictions → gold", kind: "batch" },
  { id: "e13", from: "delta", to: "fastapi", label: "gold readers", kind: "serve" },
  { id: "e14", from: "docs", to: "embed", label: "chunk + embed", kind: "rag" },
  { id: "e15", from: "embed", to: "qdrant", label: "upsert", kind: "rag" },
  { id: "e16", from: "qdrant", to: "ollama", label: "retrieve", kind: "rag" },
  { id: "e17", from: "delta", to: "ollama", label: "SQL + ML tools", kind: "serve" },
  { id: "e18", from: "ollama", to: "fastapi", label: "chat + proposals", kind: "serve" },
  { id: "e19", from: "fastapi", to: "streamlit", label: "serves", kind: "serve" },
  { id: "e20", from: "fastapi", to: "nextjs", label: "serves", kind: "serve" },
  { id: "e21", from: "fastapi", to: "prom", label: "scrapes", kind: "ops" },
];
