export interface Flow {
  id: string;
  title: string;
  summary: string;
  steps: { label: string; detail: string }[];
}

export const FLOWS: Flow[] = [
  {
    id: "batch",
    title: "Batch export",
    summary:
      "The historical simulator fills PostgreSQL. A later export is the batch door into the lakehouse. Re-running the pipeline merges on keys instead of appending duplicates.",
    steps: [
      { label: "Simulator", detail: "seed 42 writes orders, customers, inventory, payments, and deliveries into Postgres." },
      { label: "export-raw", detail: "quickcart.ingestion.export writes CSV table dumps, a supplier catalog, and JSONL events under data/raw." },
      { label: "Bronze", detail: "Typed Delta loads: bronze_orders, bronze_customers, bronze_products, bronze_inventory, bronze_deliveries, and the related tables." },
      { label: "Silver", detail: "Clean, dedupe, and normalize. Failures land in data/quarantine with _error_codes. A quality gate stops dirty marts." },
      { label: "Gold", detail: "Five marts: store hourly metrics, customer 360, inventory health, delivery performance, product performance." },
    ],
  },
  {
    id: "stream",
    title: "Live events",
    summary:
      "The realtime simulator does not wait for the nightly export. It publishes events that Spark Structured Streaming appends to Bronze, then merges into Silver on order_id.",
    steps: [
      { label: "Realtime simulator", detail: "Publishes keyed events to quickcart.order-events.v1, quickcart.app-events.v1, and quickcart.rider-events.v1." },
      { label: "Redpanda", detail: "Single broker on 127.0.0.1:9092. Console is on 127.0.0.1:8080." },
      { label: "Structured Streaming", detail: "quickcart.ingestion.streaming appends micro-batches to bronze_order_events and checkpoints the progress." },
      { label: "Malformed split", detail: "Bad JSON is isolated in bronze_order_events_malformed. It is not dropped quietly." },
      { label: "Silver merge", detail: "Idempotent merge on order_id. Exactly-once is claimed at Silver and Gold, not at the Bronze append." },
    ],
  },
  {
    id: "cdc",
    title: "Change data capture",
    summary:
      "Postgres runs with wal_level=logical. Debezium tails the WAL for orders, inventory, and payments. Deletes on Silver are hard deletes; Delta time travel is the recovery path.",
    steps: [
      { label: "PostgreSQL WAL", detail: "The app user is the local superuser so the publication and slot can be created without extra grants." },
      { label: "Debezium 3.6.3", detail: "Connect listens on 127.0.0.1:8083 and writes quickcart.public.* topics." },
      { label: "CDC Bronze", detail: "quickcart.ingestion.cdc consume appends bronze_orders_cdc, bronze_inventory_cdc, and bronze_payments_cdc." },
      { label: "Op-aware merge", detail: "apply_cdc_to_silver treats create, update, and delete. Only those three tables are captured." },
    ],
  },
  {
    id: "quarantine",
    title: "Quarantine",
    summary:
      "Invalid rows are a first-class output. The Silver quality gate refuses to publish Gold when the checks fail.",
    steps: [
      { label: "Rule catalog", detail: "Checks run during Silver. Each failed row keeps structured error fields." },
      { label: "Per-table files", detail: "data/quarantine/<table>_quarantine stores _error_codes, _error_messages, and _quarantined_at." },
      { label: "quality_summary", detail: "A unioned Delta table. Streamlit Pipeline & Quality reads it. The API does not stream log lines." },
      { label: "Gate", detail: "silver_quality_gate stops the pipeline instead of building marts from rejected data." },
    ],
  },
  {
    id: "writeback",
    title: "Proposal write-back",
    summary:
      "The only mutation from the assistant back into PostgreSQL is an approved restock. That update is an ordinary inventory change, so CDC can pick it up again.",
    steps: [
      { label: "Pending proposal", detail: "create_restock_proposal inserts a PENDING row. Quantity must be 1–500. Store and product must exist. Inventory must be fresher than 48 hours. No open duplicate." },
      { label: "Human approve", detail: "POST /api/v1/proposals/{id}/approve. The approver string is recorded. It is not authenticated." },
      { label: "Re-validate", detail: "Rules run again on the stored row. A changed world returns 409 and marks the proposal invalid." },
      { label: "One transaction", detail: "UPDATE inventory and INSERT an inventory_movements RECEIPT referenced as AUTO_PROPOSAL:<id>. Failure marks the proposal FAILED and rolls back." },
      { label: "Back into CDC", detail: "The inventory update is visible to Debezium like any other write." },
    ],
  },
];

export const GOLD_MARTS = [
  "gold_store_hourly_metrics",
  "gold_customer_360",
  "gold_inventory_health",
  "gold_delivery_performance",
  "gold_product_performance",
  "gold_delivery_predictions",
  "gold_demand_forecasts",
  "gold_anomalies",
];
