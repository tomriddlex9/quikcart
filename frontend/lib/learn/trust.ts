export interface Note {
  title: string;
  severity: "local-ok" | "watch" | "later";
  body: string;
}

export const SECURITY: Note[] = [
  {
    title: "No authentication on the API",
    severity: "watch",
    body: "Every route, including proposal approval, is open to whoever can reach port 8000. The approver field is a free-text name stored in the audit trail. The process defaults to 127.0.0.1, and Compose publishes dependency ports on 127.0.0.1 only. Do not bind the API to 0.0.0.0 or put it behind a tunnel.",
  },
  {
    title: "The model cannot execute a restock",
    severity: "local-ok",
    body: "Prompt injection can at most create a PENDING proposal. Quantity is capped at 500. Approval re-validates the database row, locks it, and writes inventory plus a movement in one transaction. INCIDENT and OPS_NOTIFICATION types have no executor.",
  },
  {
    title: "Read-only SQL guard",
    severity: "local-ok",
    body: "run_readonly_sql strips comments, rejects stacked statements, allows only SELECT/WITH, blocklists mutating keywords, and only registers silver_* and gold_* views. Results are capped at 500 rows with a 30 second cancel. Tests cover comment-splitting and keywords hidden inside strings.",
  },
  {
    title: "Loopback services without their own auth",
    severity: "local-ok",
    body: "Debezium Connect, Redpanda, Qdrant, and MLflow have no credentials. They are published on 127.0.0.1. Grafana's dev password is quickcart_grafana_dev and that profile is optional.",
  },
  {
    title: "Airflow runs as root",
    severity: "watch",
    body: "The orchestration profile sets user: root and bind-mounts the repo so DAGs can write the lakehouse. A compromised dependency inside that container can write the working tree. It is a local-dev shortcut, not a multi-tenant setup.",
  },
  {
    title: "The database user is the superuser",
    severity: "watch",
    body: "quickcart_app is the Postgres bootstrap user, which is why CDC publication works without extra grants. Application SQL uses parameters. There is no separate migration role.",
  },
  {
    title: "Chat text is stored",
    severity: "watch",
    body: "The agent logs the first 200 characters of a question and writes the full query into data/artifacts/agent_traces. That is intentional tracing over synthetic data. Do not paste real personal data into the console.",
  },
];

export const PERFORMANCE: Note[] = [
  {
    title: "KPI reads launch several Spark jobs",
    severity: "later",
    body: "GoldReaders.kpi_summary scans gold_store_hourly_metrics three times and gold_delivery_performance twice. One aggregation per table would do the same arithmetic. This shows up on GET /api/v1/overview/kpis and the Streamlit overview.",
  },
  {
    title: "Shuffle partitions stay at Spark's default",
    severity: "later",
    body: "Test sessions set spark.sql.shuffle.partitions to 4. API, dashboard, and pipeline sessions leave the default of 200 on local[*]. That is scheduling overhead on a laptop-sized 100k-order set. It is not changed here: a new number needs a local measurement before anyone calls it faster.",
  },
  {
    title: "Point lookups scan Delta",
    severity: "later",
    body: "GET /api/v1/orders/{id} and the prediction routes load the Delta table on each call. There is no order_id index and no cached DataFrame. Fine at demo size.",
  },
  {
    title: "Inventory health windows shuffle three times",
    severity: "later",
    body: "The 1 hour, 24 hour, and 7 day sales windows in gold_inventory_health are three group-bys. A single group-by with conditional sums would be one shuffle. It runs when Gold is rebuilt, not on every page view.",
  },
  {
    title: "Anomalies collect to the driver",
    severity: "later",
    body: "operational_anomaly converts the feature frame with toPandas and loops per store. It is a batch training step and will not outgrow one machine's memory.",
  },
];
