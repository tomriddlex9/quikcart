export interface PhaseRow {
  phase: string;
  name: string;
  state: "done" | "code-without-boxes" | "partial";
  working: string;
  open: string;
}

export const PHASES: PhaseRow[] = [
  { phase: "0", name: "Repository", state: "done", working: "uv, Ruff, Pytest, Compose skeleton, smoke test.", open: "" },
  { phase: "1", name: "PostgreSQL + simulator", state: "done", working: "Schema, deterministic history, integrity checks.", open: "" },
  { phase: "2", name: "SQL", state: "done", working: "Metric dictionary and 30 exercises.", open: "" },
  { phase: "3", name: "PySpark fundamentals", state: "done", working: "Raw export, session builder, learning jobs.", open: "" },
  {
    phase: "4",
    name: "Medallion MVP",
    state: "code-without-boxes",
    working: "Bronze, Silver, Gold, quarantine, and make lakehouse exist and later phases depend on them.",
    open: "Every Phase 4 checkbox in kit/TASKS.md is still empty, and there is no docs/learning/phase-4.md. README marks the phase complete. /api/v1/system/status follows the checkboxes, so it reports Phase 4 incomplete.",
  },
  { phase: "5", name: "Quality + optimization", state: "done", working: "Bad-data injection, MERGE, SCD2, and the Spark experiments.", open: "" },
  { phase: "6", name: "Object storage", state: "done", working: "SeaweedFS profile and an S3 Delta smoke path.", open: "Raw files stay local. S3 existence checks are skipped." },
  { phase: "7", name: "Streaming", state: "done", working: "Redpanda, contracts, consumer, checkpoints, malformed split.", open: "The watermark exercise is a documented mirror of Spark's native watermark." },
  { phase: "8", name: "CDC", state: "done", working: "Debezium plus Bronze adapters and Silver MERGE for orders, inventory, payments.", open: "Other tables are not captured. Silver deletes are hard deletes." },
  { phase: "9", name: "Airflow", state: "done", working: "Daily lakehouse DAG and weather DAG.", open: "Standalone LocalExecutor. The container runs as root." },
  { phase: "10", name: "Streamlit", state: "done", working: "Eight operations pages over Gold, plus Approvals from Postgres.", open: "No ML page inside Streamlit. Charts are not server-cached beyond the Spark session." },
  { phase: "11", name: "ML", state: "done", working: "Delivery classifier, demand forecaster, anomaly detectors, predictions written to Gold.", open: "Weather is not a v1 feature. Demand grain is store × category × day, not SKU." },
  { phase: "12", name: "RAG", state: "done", working: "Fixtures, chunking, local embeddings, Qdrant, retriever, 20-question eval set.", open: "Natural-language answers from the retriever itself are out of scope. The score floor is specific to this corpus and model." },
  { phase: "13", name: "Agent", state: "done", working: "Nine tools, routing, a five-step cap, traces, and an eval suite with a fake LLM.", open: "The fake LLM proves routing, not real-model classification. Sessions are stateless." },
  { phase: "14", name: "FastAPI + actions", state: "done", working: "Analytics, predictions, chat, proposal create/approve/reject, audit trail.", open: "INCIDENT and OPS_NOTIFICATION proposals have no executor. Analytics routes assume the local storage backend." },
  {
    phase: "15",
    name: "Hardening",
    state: "partial",
    working: "GitHub Actions, structured logs, correlation IDs, architecture diagrams in docs, and scripts/demo.sh.",
    open: "Still unchecked: Prometheus metrics, Grafana dashboards, formal model cards, RAG evaluation report, agent evaluation report, clean-clone validation. README calls Phase 15 complete anyway.",
  },
];

export const DRIFTS = [
  {
    title: "Phase 4 checkboxes vs the code",
    body: "The lakehouse is implemented and Phases 5–14 are checked, but Phase 4's eighteen boxes are empty. Status parsing in src/quickcart/api/status.py trusts those boxes. This page does not flip them: boxes change only after their own acceptance tests are recorded as passing.",
  },
  {
    title: "Phase 15 README vs TASKS.md",
    body: "README's status table says Phase 15 is complete. TASKS.md still has six open items. docs/learning/phase-15.md agrees with TASKS. The monitoring Compose profile exists; application metrics and Grafana dashboards do not.",
  },
  {
    title: "Spec names vs code names",
    body: "kit/01 lists Gold tables and agent tools that were renamed during implementation. The running marts are the five pipeline tables plus three ML write-backs. The agent tools are get_store_metrics, get_kpi_summary, get_inventory_risk, get_delivery_prediction, get_demand_forecast, list_active_anomalies, search_company_docs, create_restock_proposal, and run_readonly_sql.",
  },
];
