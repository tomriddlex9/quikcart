import type {
  ActivityLogEntry,
  AnomalyRow,
  DemandForecastRow,
  DeliveryPrediction,
  InventoryRiskRow,
  Kpis,
  OrderTrendRow,
  Proposal,
  StoreRow,
  SystemStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Demo data — shown ONLY when the API is unreachable, and always under a
// clearly visible "API offline — demo data" banner. Values are synthetic but
// shaped exactly like the real contract so the console stays explorable.
// ---------------------------------------------------------------------------

export const DEMO_KPIS: Kpis = {
  gmv: 48231500,
  orders_placed: 102347,
  cancellation_rate: 0.0412,
  late_delivery_rate: 0.0725,
  products_below_reorder: 137,
  active_customers: 18420,
};

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function buildDemoTrend(days = 30): OrderTrendRow[] {
  const rnd = seeded(42);
  const rows: OrderTrendRow[] = [];
  const today = new Date("2026-09-22T00:00:00Z");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const weekday = d.getUTCDay();
    const weekendBoost = weekday === 0 || weekday === 6 ? 1.28 : 1;
    const orders = Math.round((3050 + Math.sin(i / 4.2) * 260 + rnd() * 180) * weekendBoost);
    const gmv = Math.round(orders * (465 + rnd() * 22));
    const cancelled = Math.round(orders * (0.035 + rnd() * 0.018));
    rows.push({
      day: d.toISOString().slice(0, 10),
      orders,
      gmv,
      cancelled,
    });
  }
  return rows;
}

export const DEMO_TREND: OrderTrendRow[] = buildDemoTrend();

export const DEMO_STORES: StoreRow[] = [
  { store_id: 1, orders: 14230, gmv: 6910200, cancel_rate: 0.038, late_rate: 0.061 },
  { store_id: 2, orders: 12810, gmv: 6044110, cancel_rate: 0.044, late_rate: 0.083 },
  { store_id: 3, orders: 11940, gmv: 5883200, cancel_rate: 0.041, late_rate: 0.072 },
  { store_id: 4, orders: 10520, gmv: 5012400, cancel_rate: 0.052, late_rate: 0.094 },
  { store_id: 5, orders: 9875, gmv: 4733550, cancel_rate: 0.036, late_rate: 0.058 },
  { store_id: 6, orders: 9030, gmv: 4320090, cancel_rate: 0.047, late_rate: 0.088 },
  { store_id: 7, orders: 8410, gmv: 3994700, cancel_rate: 0.039, late_rate: 0.066 },
  { store_id: 8, orders: 7620, gmv: 3628320, cancel_rate: 0.055, late_rate: 0.102 },
  { store_id: 9, orders: 6980, gmv: 3275620, cancel_rate: 0.043, late_rate: 0.071 },
  { store_id: 10, orders: 5930, gmv: 2918610, cancel_rate: 0.049, late_rate: 0.079 },
];

export const DEMO_INVENTORY_RISKS: InventoryRiskRow[] = [
  {
    store_id: 3, sku: "SKU-01042", name: "Whole Milk 1L", category: "dairy",
    on_hand_qty: 14, reorder_point: 60, avg_hourly_sales_7d: 9.2, stock_cover_hours: 1.5,
    is_below_reorder_point: true,
  },
  {
    store_id: 1, sku: "SKU-01877", name: "Sourdough Loaf 400g", category: "bakery",
    on_hand_qty: 9, reorder_point: 40, avg_hourly_sales_7d: 6.8, stock_cover_hours: 1.3,
    is_below_reorder_point: true,
  },
  {
    store_id: 7, sku: "SKU-00415", name: "Free-Range Eggs 12pk", category: "dairy",
    on_hand_qty: 22, reorder_point: 55, avg_hourly_sales_7d: 7.1, stock_cover_hours: 3.1,
    is_below_reorder_point: true,
  },
  {
    store_id: 5, sku: "SKU-02230", name: "Basmati Rice 5kg", category: "pantry",
    on_hand_qty: 6, reorder_point: 25, avg_hourly_sales_7d: 2.4, stock_cover_hours: 2.5,
    is_below_reorder_point: true,
  },
  {
    store_id: 2, sku: "SKU-03108", name: "Cold Brew 250ml", category: "beverages",
    on_hand_qty: 31, reorder_point: 48, avg_hourly_sales_7d: 11.5, stock_cover_hours: 2.7,
    is_below_reorder_point: true,
  },
  {
    store_id: 8, sku: "SKU-02755", name: "Greek Yogurt 500g", category: "dairy",
    on_hand_qty: 40, reorder_point: 45, avg_hourly_sales_7d: 4.9, stock_cover_hours: 8.2,
    is_below_reorder_point: true,
  },
];

export const DEMO_ANOMALIES: AnomalyRow[] = [
  {
    anomaly_type: "PAYMENT_FAILURE_SPIKE", store_id: 4, observed_on: "2026-09-22T18:00:00Z",
    severity: "HIGH", metric: "payment_failure_rate", observed_value: 0.118, expected_value: 0.032,
    detector: "isolation_forest",
  },
  {
    anomaly_type: "CANCELLATION_SPIKE", store_id: 8, observed_on: "2026-09-22T14:00:00Z",
    severity: "MEDIUM", metric: "cancellation_rate", observed_value: 0.094, expected_value: 0.048,
    detector: "isolation_forest",
  },
  {
    anomaly_type: "DEMAND_SPIKE", store_id: 1, observed_on: "2026-09-21T20:00:00Z",
    severity: "LOW", metric: "orders_per_hour", observed_value: 412, expected_value: 310,
    detector: "zscore",
  },
  {
    anomaly_type: "DELIVERY_DURATION_SPIKE", store_id: 6, observed_on: "2026-09-21T19:00:00Z",
    severity: "MEDIUM", metric: "avg_delivery_minutes", observed_value: 47.2, expected_value: 31.4,
    detector: "isolation_forest",
  },
  {
    anomaly_type: "INVENTORY_MOVEMENT_OUTLIER", store_id: 5, observed_on: "2026-09-20T09:00:00Z",
    severity: "LOW", metric: "adjustment_count", observed_value: 38, expected_value: 9,
    detector: "zscore",
  },
];

export const DEMO_DELIVERY_PREDICTION: DeliveryPrediction = {
  order_id: 88041,
  store_id: 3,
  late_probability: 0.73,
  predicted_class: 1,
  actual_class: 1,
  predicted_at: "2026-09-22T18:30:00Z",
  model_name: "delivery_delay_classifier",
  model_version: "demo-run-3f9c1a (illustrative)",
};

export const DEMO_DEMAND_FORECASTS: DemandForecastRow[] = [
  { store_id: 1, category: "dairy", day: "2026-09-22", forecast_date: "2026-09-23", expected_units: 342, actual_units: 351, predicted_at: "2026-09-22T23:05:00Z", model_name: "demand_forecast_daily", model_version: "demo-run-88b2c0 (illustrative)" },
  { store_id: 1, category: "bakery", day: "2026-09-22", forecast_date: "2026-09-23", expected_units: 121, actual_units: 118, predicted_at: "2026-09-22T23:05:00Z", model_name: "demand_forecast_daily", model_version: "demo-run-88b2c0 (illustrative)" },
  { store_id: 2, category: "dairy", day: "2026-09-22", forecast_date: "2026-09-23", expected_units: 296, actual_units: 289, predicted_at: "2026-09-22T23:05:00Z", model_name: "demand_forecast_daily", model_version: "demo-run-88b2c0 (illustrative)" },
  { store_id: 3, category: "beverages", day: "2026-09-22", forecast_date: "2026-09-23", expected_units: 188, actual_units: null, predicted_at: "2026-09-22T23:05:00Z", model_name: "demand_forecast_daily", model_version: "demo-run-88b2c0 (illustrative)" },
];

export const DEMO_PROPOSALS: Proposal[] = [
  {
    proposal_id: 101,
    proposal_type: "RESTOCK",
    entity_scope: { store_id: 3, product_id: 1042, quantity: 120 },
    recommended_action: "Restock SKU-01042 (Whole Milk 1L) at store 3: +120 units",
    reason:
      "Stock cover is 1.5 hours against a 60-unit reorder point. Weekend demand uplift " +
      "predicted by the demand model raises stockout risk above threshold.",
    evidence: [
      "gold_inventory_health: on_hand=14, reorder_point=60, cover=1.5h",
      "forecast_demand store=3 product=1042 next 6h: ~55 units",
      "avg_hourly_sales_7d=9.2 (p95 of category)",
    ],
    validation_status: "VALID",
    status: "PENDING",
    created_at: "2026-09-22T16:42:11Z",
    updated_at: "2026-09-22T16:42:11Z",
  },
  {
    proposal_id: 102,
    proposal_type: "INCIDENT",
    entity_scope: { store_id: 4 },
    recommended_action: "Open an incident for the payment-failure spike at store 4",
    reason:
      "Payment failure rate 11.8% vs expected 3.2% (HIGH severity anomaly at 18:00). " +
      "Suggest checking the store's POS gateway configuration.",
    evidence: [
      "gold_anomalies: PAYMENT_FAILURE_SPIKE severity=HIGH observed=0.118 expected=0.032",
      "Detector: isolation_forest (model_version mlflow run #41)",
    ],
    validation_status: "VALID",
    status: "APPROVED",
    created_at: "2026-09-22T17:05:02Z",
    updated_at: "2026-09-22T17:30:44Z",
    approved_at: "2026-09-22T17:30:44Z",
    approved_by: "ops.demo",
  },
  {
    proposal_id: 100,
    proposal_type: "RESTOCK",
    entity_scope: { store_id: 8, product_id: 2755, quantity: 80 },
    recommended_action: "Restock SKU-02755 (Greek Yogurt 500g) at store 8: +80 units",
    reason: "Cover dropped below reorder point after the cold-chain audit removed 60 expired units.",
    evidence: ["gold_inventory_health: on_hand=40 reorder_point=45", "inventory_movements: AUDIT_REMOVAL qty=-60"],
    validation_status: "VALID",
    status: "EXECUTED",
    created_at: "2026-09-20T11:12:00Z",
    updated_at: "2026-09-20T11:40:19Z",
    approved_at: "2026-09-20T11:40:02Z",
    executed_at: "2026-09-20T11:40:19Z",
    approved_by: "ops.demo",
  },
];

export const DEMO_SYSTEM_STATUS: SystemStatus = {
  phases: [
    { phase: 0, name: "Repository and developer environment", status: "complete" },
    { phase: 1, name: "PostgreSQL + deterministic simulator", status: "complete" },
    { phase: 2, name: "SQL analytics foundation", status: "complete" },
    { phase: 3, name: "PySpark fundamentals", status: "complete" },
    { phase: 4, name: "Delta Lake and Medallion MVP", status: "complete" },
    { phase: 5, name: "Data quality, CDC merges, SCD2, optimization", status: "complete" },
    { phase: 6, name: "S3-compatible object storage", status: "complete" },
    { phase: 7, name: "Streaming with Redpanda", status: "complete" },
    { phase: 8, name: "PostgreSQL CDC with Debezium", status: "complete" },
    { phase: 9, name: "Airflow orchestration", status: "complete" },
    { phase: 10, name: "Analytics dashboard", status: "complete" },
    { phase: 11, name: "Classic ML + MLflow", status: "complete" },
    { phase: 12, name: "RAG", status: "pending" },
    { phase: 13, name: "LangGraph agent", status: "pending" },
    { phase: 14, name: "FastAPI and human-approved action flow", status: "pending" },
    { phase: 15, name: "Engineering hardening and final demo", status: "pending" },
  ],
  services: { postgres: "down", redpanda: "down", qdrant: "down", mlflow: "down" },
  data_root_tables: {
    gold_store_hourly_metrics: false,
    gold_customer_360: false,
    gold_inventory_health: false,
    gold_delivery_performance: false,
    gold_product_performance: false,
  },
};

// ---------------------------------------------------------------------------
// Home command center — illustrative figures with no backend metric yet.
// Surfaced as "demo" values everywhere they render, never claimed as live.
// ---------------------------------------------------------------------------

/** Open support tickets — illustrative; no ticketing system is wired up yet. */
export const DEMO_OPEN_TICKETS = 14;

/** Shown in the KPI wall when the live stream has never answered. */
export const DEMO_ACTIVE_DELIVERIES = 112;

/** Shown in the KPI wall when the live stream has never answered. */
export const DEMO_PAYMENT_FAILURE_RATE = 0.032;

/** Forecast MAPE (mean absolute % error) for the daily demand model — illustrative. */
export const DEMO_FORECAST_MAPE = 0.086;

/** Fallback activity-log entries shown when live/pipeline/proposal/anomaly feeds are all offline. */
export const DEMO_ACTIVITY_LOG: ActivityLogEntry[] = [
  {
    id: "demo-1",
    ts: "2026-09-22T18:42:11Z",
    level: "info",
    source: "live",
    message: "orders_1m=38 gmv_15m=₹4.9L active_deliveries=112",
  },
  {
    id: "demo-2",
    ts: "2026-09-22T18:41:00Z",
    level: "warn",
    source: "anomaly",
    message: "PAYMENT_FAILURE_SPIKE store=4 observed=11.8% expected=3.2% severity=HIGH",
  },
  {
    id: "demo-3",
    ts: "2026-09-22T18:40:19Z",
    level: "info",
    source: "pipeline",
    message: "gold_refresh rows_out=48213 lag=42s",
  },
  {
    id: "demo-4",
    ts: "2026-09-22T18:39:02Z",
    level: "info",
    source: "proposal",
    message: "#101 RESTOCK store=3 sku=SKU-01042 status=PENDING",
  },
  {
    id: "demo-5",
    ts: "2026-09-22T18:37:44Z",
    level: "info",
    source: "pipeline",
    message: "cdc_silver rows_in=1204 rows_out=1204 lag=6s",
  },
  {
    id: "demo-6",
    ts: "2026-09-22T18:35:30Z",
    level: "warn",
    source: "anomaly",
    message: "CANCELLATION_SPIKE store=8 observed=9.4% expected=4.8% severity=MEDIUM",
  },
  {
    id: "demo-7",
    ts: "2026-09-22T18:30:44Z",
    level: "info",
    source: "proposal",
    message: "#102 INCIDENT store=4 status=APPROVED by=ops.demo",
  },
  {
    id: "demo-8",
    ts: "2026-09-22T18:28:00Z",
    level: "info",
    source: "live",
    message: "orders_1m=34 gmv_15m=₹4.6L active_deliveries=104",
  },
];
