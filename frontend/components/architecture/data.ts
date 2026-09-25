// Data model for the /architecture hero diagram. Self-contained: facts are
// copied from lib/learn/architecture.ts and docs/architecture/system-map.md
// rather than imported, so this stays a standalone, ownable module.
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Database,
  FileOutput,
  GitBranch,
  Radio,
  Layers,
  ShieldAlert,
  Gem,
  BrainCircuit,
  BookOpenText,
  Bot,
  Server,
  MonitorCog,
  LayoutDashboard,
} from "lucide-react";

export type EdgeKind = "batch" | "stream" | "cdc" | "quarantine" | "intel" | "serve" | "trust";

export interface FlowNode {
  id: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  x: number;
  y: number;
  w: number;
  h: number;
  phase: string;
  layer: string;
  tech: string;
  role: string;
  facts: string[];
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
}

export const CANVAS_W = 2180;
export const CANVAS_H = 520;

export const EDGE_KIND_META: Record<EdgeKind, { label: string; color: string }> = {
  batch: { label: "batch", color: "var(--chart-1)" },
  stream: { label: "streaming", color: "var(--chart-2)" },
  cdc: { label: "CDC", color: "var(--chart-3)" },
  quarantine: { label: "quarantine", color: "var(--destructive)" },
  intel: { label: "ML / RAG tools", color: "var(--chart-5)" },
  serve: { label: "serving", color: "var(--muted-foreground)" },
  trust: { label: "human approval", color: "var(--chart-4)" },
};

export const FLOW_NODES: FlowNode[] = [
  {
    id: "simulator",
    label: "Simulator",
    sub: "Faker + NumPy · seed 42",
    icon: Boxes,
    x: 100,
    y: 300,
    w: 160,
    h: 64,
    phase: "Phase 1",
    layer: "Source",
    tech: "Python, Faker, NumPy",
    role: "A deterministic quick-commerce world: 10 stores, 2,000 products, 20,000 customers, 100k historical orders, plus a live event generator.",
    facts: [
      "Demand = base × hour × weekday × store × popularity × promo × weather",
      "Everything reproducible from seed 42 — no IID random labels",
      "Also drives the live stream: 1–5 app/rider events per second",
    ],
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    sub: "17.11 · operational source",
    icon: Database,
    x: 330,
    y: 300,
    w: 160,
    h: 64,
    phase: "Phase 1",
    layer: "Source",
    tech: "PostgreSQL 17.11",
    role: "The one and only system of record. Silver and Gold are derived; the agent keeps no hidden second copy of the business tables.",
    facts: [
      "16 core tables behind versioned migrations (V001…)",
      "wal_level=logical so Debezium can read the write-ahead log",
      "Inventory movements + restock proposals stay transactional here",
    ],
  },
  {
    id: "export",
    label: "Batch export",
    sub: "CSV + JSONL",
    icon: FileOutput,
    x: 560,
    y: 190,
    w: 150,
    h: 58,
    phase: "Phase 3",
    layer: "Ingest",
    tech: "quickcart.ingestion.export",
    role: "Dumps a raw, replayable snapshot of the operational tables into data/raw before any Spark transform runs.",
    facts: [
      "Deterministic file layout under data/raw/<table>/",
      "No transformation — Bronze does the first typed read",
      "Re-runnable without touching the live database twice",
    ],
  },
  {
    id: "debezium",
    label: "Debezium",
    sub: "3.6.3 · CDC",
    icon: GitBranch,
    x: 560,
    y: 410,
    w: 150,
    h: 58,
    phase: "Phase 8",
    layer: "Ingest",
    tech: "Debezium 3.6.3.Final",
    role: "Captures row-level inserts, updates and deletes from the Postgres WAL — the honest way to feed downstream systems instead of rescanning tables.",
    facts: [
      "Connectors for orders, inventory and payments",
      "Emits change events onto Redpanda topics",
      "The same channel an approved restock re-enters on",
    ],
  },
  {
    id: "redpanda",
    label: "Redpanda",
    sub: "Kafka-compatible broker",
    icon: Radio,
    x: 770,
    y: 410,
    w: 150,
    h: 58,
    phase: "Phase 7",
    layer: "Ingest",
    tech: "Redpanda v24.3.6",
    role: "The event backbone for both app/rider events and CDC change events — Kafka API without a JVM or ZooKeeper.",
    facts: [
      "17 event topics from PRODUCT_VIEWED to ORDER_CANCELLED",
      "Consumed by Spark Structured Streaming into Bronze",
      "Redpanda Console for browsing topics locally",
    ],
  },
  {
    id: "bronze",
    label: "Bronze",
    sub: "Delta Lake 4.4",
    icon: Layers,
    x: 980,
    y: 300,
    w: 150,
    h: 60,
    phase: "Phase 4",
    layer: "Medallion",
    tech: "Delta Lake 4.4.0",
    role: "Raw, append/merge landing zone. Preserves original payloads plus ingestion metadata so any run is replayable.",
    facts: [
      "Fed by both the batch export and the streaming consumer",
      "No validation yet — that is Silver's job, explicitly",
      "Time travel available for audits from day one",
    ],
  },
  {
    id: "silver",
    label: "Silver",
    sub: "validated · deduped",
    icon: Layers,
    x: 1190,
    y: 230,
    w: 150,
    h: 60,
    phase: "Phases 4–5",
    layer: "Medallion",
    tech: "PySpark 4.2 + Delta 4.4",
    role: "Trusted, conformed entities: typed schemas, deduplication, SCD2 where needed. Every rejected row is explained, never dropped silently.",
    facts: [
      "Explicit schemas, no Pandas shortcuts on the main path",
      "MERGE for CDC-sourced updates",
      "Explain-plans captured before/after every optimization",
    ],
  },
  {
    id: "quarantine",
    label: "Quarantine",
    sub: "structured error codes",
    icon: ShieldAlert,
    x: 1190,
    y: 430,
    w: 150,
    h: 56,
    phase: "Phase 5",
    layer: "Medallion",
    tech: "data/quarantine + quality_summary",
    role: "Bad rows land here with a reason, not in a log line that scrolls away. Nothing invalid is ever silently discarded.",
    facts: [
      "Every rejected row carries a structured error code",
      "Feeds the quality_summary read on the Data page",
      "A quality gate can fail an Airflow run instead of hiding bad data",
    ],
  },
  {
    id: "gold",
    label: "Gold",
    sub: "12 analysis-ready marts",
    icon: Gem,
    x: 1400,
    y: 300,
    w: 150,
    h: 60,
    phase: "Phase 6",
    layer: "Medallion",
    tech: "Delta Lake 4.4.0",
    role: "The only surface ML, RAG-adjacent tools, the agent, FastAPI and Streamlit are allowed to read for analytics.",
    facts: [
      "gold_anomalies, gold_delivery_predictions, gold_demand_forecasts, …",
      "ML predictions are written back here, not into a side store",
      "Every reader — API, agent, Streamlit — uses the same tables",
    ],
  },
  {
    id: "ml",
    label: "ML models",
    sub: "sklearn · XGBoost",
    icon: BrainCircuit,
    x: 1610,
    y: 150,
    w: 150,
    h: 56,
    phase: "Phase 11",
    layer: "Intelligence",
    tech: "scikit-learn, XGBoost, MLflow 3.16",
    role: "Three classical models — delivery-delay classifier, demand forecaster, anomaly detector — with baselines and MLflow-tracked metrics.",
    facts: [
      "Predictions written back into Gold, never a hidden table",
      "Every model: target, baseline, features, split, metrics, version",
      "Interpretable first models before any tuning",
    ],
  },
  {
    id: "rag",
    label: "RAG",
    sub: "Qdrant + embeddings",
    icon: BookOpenText,
    x: 1610,
    y: 300,
    w: 150,
    h: 56,
    phase: "Phase 12",
    layer: "Intelligence",
    tech: "sentence-transformers, Qdrant v1.13.2",
    role: "Retrieval over six internal policy/SOP documents only — unstructured knowledge, never a second copy of structured business tables.",
    facts: [
      "all-MiniLM-L6-v2 embeddings, cosine distance, deterministic IDs",
      "Rebuilding the index from the same chunks yields the same count",
      "Out-of-scope questions return low scores, not invented answers",
    ],
  },
  {
    id: "agent",
    label: "Agent",
    sub: "LangGraph · bounded tools",
    icon: Bot,
    x: 1610,
    y: 450,
    w: 150,
    h: 56,
    phase: "Phase 13",
    layer: "Intelligence",
    tech: "LangGraph, Ollama (qwen3:4b)",
    role: "A stateful but bounded operations assistant: a typed tool allow-list, read-only SQL, a capped tool-call loop, and proposals instead of writes.",
    facts: [
      "Tools: query_gold, inventory/store/order lookups, forecasts, RAG search",
      "SQL tool is SELECT-only, allow-listed, size-limited and timed out",
      "High-impact actions become PENDING proposals, nothing else",
    ],
  },
  {
    id: "fastapi",
    label: "FastAPI",
    sub: "service boundary :8000",
    icon: Server,
    x: 1820,
    y: 300,
    w: 160,
    h: 64,
    phase: "Phase 14",
    layer: "Serving",
    tech: "FastAPI + uvicorn",
    role: "The stable contract between every UI and the platform: KPIs, trends, chat, and the human approval lifecycle for proposals.",
    facts: [
      "Versioned /api/v1 routes with Pydantic contracts",
      "Proposal approval re-validates from the DB row, never the request body",
      "Executor runs in one transaction: inventory update + movement + audit",
    ],
  },
  {
    id: "streamlit",
    label: "Streamlit",
    sub: "ops dashboard :8501",
    icon: MonitorCog,
    x: 2030,
    y: 210,
    w: 150,
    h: 56,
    phase: "Phase 10",
    layer: "Serving",
    tech: "Streamlit",
    role: "The original operations dashboard — 8 pages from executive overview to the action approval queue.",
    facts: [
      "Reads Gold marts through the same readers as the API",
      "Zero frontend build step — pure Python",
      "Embedded in this console at /streamlit",
    ],
  },
  {
    id: "nextjs",
    label: "Next.js",
    sub: "this console",
    icon: LayoutDashboard,
    x: 2030,
    y: 390,
    w: 150,
    h: 56,
    phase: "Phases 14–15",
    layer: "Serving",
    tech: "Next.js, TypeScript, Tailwind",
    role: "A typed operations console over the FastAPI contracts, with a labeled demo-data fallback whenever the API is unreachable.",
    facts: [
      "App Router + TypeScript; charts via recharts",
      "Polls the API on an interval; every failure is labeled, never faked",
      "This diagram and the system map are generated from repo-derived data",
    ],
  },
];

export const FLOW_EDGES: FlowEdge[] = [
  { id: "e1", from: "simulator", to: "postgres", label: "seed + live ops writes", kind: "batch" },
  { id: "e2", from: "simulator", to: "redpanda", label: "app + rider events", kind: "stream" },
  { id: "e3", from: "postgres", to: "export", label: "export-raw (batch)", kind: "batch" },
  { id: "e4", from: "postgres", to: "debezium", label: "logical WAL", kind: "cdc" },
  { id: "e5", from: "debezium", to: "redpanda", label: "change events", kind: "cdc" },
  { id: "e6", from: "export", to: "bronze", label: "CSV + JSONL", kind: "batch" },
  { id: "e7", from: "redpanda", to: "bronze", label: "structured streaming", kind: "stream" },
  { id: "e8", from: "bronze", to: "silver", label: "validate + dedup", kind: "batch" },
  { id: "e9", from: "silver", to: "quarantine", label: "invalid rows", kind: "quarantine" },
  { id: "e10", from: "silver", to: "gold", label: "PySpark SQL marts", kind: "batch" },
  { id: "e11", from: "gold", to: "ml", label: "feature tables", kind: "intel" },
  { id: "e12", from: "ml", to: "gold", label: "predictions back", kind: "intel" },
  { id: "e13", from: "gold", to: "agent", label: "read-only SQL tool", kind: "intel" },
  { id: "e14", from: "ml", to: "agent", label: "prediction tool", kind: "intel" },
  { id: "e15", from: "rag", to: "agent", label: "retrieval tool", kind: "intel" },
  { id: "e16", from: "gold", to: "fastapi", label: "gold readers", kind: "serve" },
  { id: "e17", from: "agent", to: "fastapi", label: "chat + proposals", kind: "serve" },
  { id: "e18", from: "fastapi", to: "streamlit", label: "serves", kind: "serve" },
  { id: "e19", from: "fastapi", to: "nextjs", label: "serves", kind: "serve" },
  { id: "e20", from: "fastapi", to: "postgres", label: "agent proposes → human approves → one transaction", kind: "trust" },
];

export const COLUMN_LABELS: Array<{ label: string; x: number }> = [
  { label: "source", x: 215 },
  { label: "ingest", x: 665 },
  { label: "medallion", x: 1190 },
  { label: "intelligence", x: 1610 },
  { label: "serving", x: 1925 },
];

/** Mermaid flowchart source for the printable/second-tab view. */
export const ARCHITECTURE_MERMAID_SOURCE = `flowchart LR
    SIM["Simulator<br/>Faker + NumPy, seed 42"] --> PG[("PostgreSQL 17.11<br/>operational source")]
    SIM -->|"app + rider events"| RP["Redpanda<br/>broker"]

    PG -->|"export-raw"| EXPORT["Batch export<br/>CSV + JSONL"]
    PG -->|"logical WAL"| DBZ["Debezium 3.6<br/>CDC"]
    DBZ -->|"change events"| RP

    EXPORT --> BRONZE[("Bronze<br/>Delta Lake 4.4")]
    RP -->|"structured streaming"| BRONZE

    BRONZE -->|"validate + dedup"| SILVER[("Silver<br/>trusted, conformed")]
    SILVER -->|"invalid rows"| QUAR["Quarantine<br/>structured error codes"]
    SILVER -->|"PySpark SQL marts"| GOLD[("Gold<br/>12 analysis-ready marts")]

    GOLD -->|"features"| ML["ML models<br/>sklearn + XGBoost"]
    ML -->|"predictions back"| GOLD
    DOCS["Internal policy docs"] --> RAG["RAG<br/>Qdrant + embeddings"]

    GOLD -->|"read-only SQL"| AGENT["Agent<br/>LangGraph, bounded tools"]
    ML -->|"prediction tool"| AGENT
    RAG -->|"retrieval tool"| AGENT

    GOLD --> API["FastAPI<br/>service boundary"]
    AGENT -->|"chat + PENDING proposals"| API
    API --> ST["Streamlit<br/>ops dashboard"]
    API --> FE["Next.js<br/>this console"]

    API -.->|"human approves → 1 Postgres transaction"| PG

    classDef trust stroke:#f2a93b,stroke-width:2px,stroke-dasharray:4 3;
    class API trust;
`;
