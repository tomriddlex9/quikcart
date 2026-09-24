export interface TreeNode {
  path: string;
  kind: "source" | "spec" | "runtime" | "docs" | "tests";
  summary: string;
  children?: { path: string; summary: string }[];
}

export const TREE: TreeNode[] = [
  {
    path: "kit/",
    kind: "spec",
    summary: "Specification package. The PRD outranks the other docs. TASKS.md is the checkbox tracker.",
    children: [
      { path: "01_ARCHITECTURE_AND_TECH_STACK.md", summary: "Versions, ports, and the intended shape." },
      { path: "02_PRD.md", summary: "Product requirements. Highest authority." },
      { path: "03_IMPLEMENTATION_PLAN.md", summary: "Phase order. Do not skip ahead." },
      { path: "04_DATA_MODEL_AND_EVENTS.md", summary: "Table and event contracts." },
      { path: "TASKS.md", summary: "Check a box only after its tests pass." },
    ],
  },
  {
    path: "src/quickcart/",
    kind: "source",
    summary: "All implementation code. Notebooks are not a second source of logic.",
    children: [
      { path: "config/", summary: "pydantic-settings. Ollama defaults to qwen3:4b on port 11434." },
      { path: "db/", summary: "Migrations, load, validate, reset." },
      { path: "simulator/", summary: "Reference data, historical generator, realtime producer." },
      { path: "ingestion/", summary: "Export, streaming consumer, CDC, weather." },
      { path: "lakehouse/", summary: "Bronze, Silver (including SCD2), Gold marts, readers, Spark session." },
      { path: "ml/", summary: "Feature builders and the three models." },
      { path: "rag/", summary: "Chunking, embeddings, Qdrant index, retrieval, fixtures, eval questions." },
      { path: "agents/", summary: "LangGraph, nine tools, SQL guard, prompts, CLI, eval suite." },
      { path: "api/", summary: "FastAPI routes, proposal service, system status." },
      { path: "dashboard_pages.py", summary: "Streamlit page functions. The entry point is dashboard/app.py." },
    ],
  },
  {
    path: "infrastructure/",
    kind: "source",
    summary: "Compose-adjacent config: Postgres DDL, Airflow image, Debezium registration, SeaweedFS bootstrap, Prometheus config.",
  },
  {
    path: "orchestration/dags/",
    kind: "source",
    summary: "quickcart_daily_lakehouse.py and quickcart_weather_ingestion.py. Airflow schedules batch work only.",
  },
  {
    path: "sql/",
    kind: "source",
    summary: "DDL notes plus 30 exercises under beginner, intermediate, and advanced. Each file states assumptions and edge cases.",
  },
  {
    path: "dashboard/",
    kind: "source",
    summary: "Streamlit shell. Eight pages: Overview, Stores, Inventory, Delivery, Customers, Products, Pipeline & Quality, Approvals.",
  },
  {
    path: "frontend/",
    kind: "source",
    summary: "This Next.js console. Live data comes from FastAPI. Static explainers live in lib/ and lib/learn/.",
  },
  {
    path: "docs/",
    kind: "docs",
    summary: "Learning notes per phase, architecture diagrams in Markdown, and the data dictionary. docs/decisions/ has no ADRs yet.",
    children: [
      { path: "architecture/", summary: "system-map.md and data-lineage.md. The pages in this console restate those flows." },
      { path: "learning/", summary: "phase-0 through phase-15, except there is no phase-4.md." },
      { path: "data_dictionary/", summary: "Metric definitions and source tables." },
    ],
  },
  {
    path: "tests/",
    kind: "tests",
    summary: "unit, integration, contracts, and data_quality. Integration tests expect the core profile.",
  },
  {
    path: "scripts/",
    kind: "source",
    summary: "demo.sh is the end-to-end scenario. It was audited step by step and not executed as one uninterrupted run.",
  },
  {
    path: "data/",
    kind: "runtime",
    summary: "Gitignored lakehouse: raw, bronze, silver, gold, quarantine, checkpoints, artifacts. Agent traces are written under data/artifacts/agent_traces.",
  },
  {
    path: "mlruns/ and mlflow.db",
    kind: "runtime",
    summary: "Local MLflow state when tracking is pointed at the working tree. The Compose MLflow service uses its own volume.",
  },
];

export const LAYOUT_NOTE =
  "kit/01 sketches flatter top-level folders (simulator/, lakehouse/, ai/). The repository actually keeps that code under src/quickcart/, which is what README.md describes.";
