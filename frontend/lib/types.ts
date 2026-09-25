// Contract types for the QuickCart FastAPI service boundary.
// Mirrors the Phase 14 API contract; every field is consumed defensively by the UI
// because the API may be older/newer than this console.

export interface Health {
  status: string;
  service: string;
  version: string;
}

export interface Kpis {
  gmv: number;
  orders_placed: number;
  cancellation_rate: number;
  late_delivery_rate: number;
  products_below_reorder: number;
  active_customers: number;
}

export interface OrderTrendRow {
  day: string;
  orders: number;
  gmv: number;
  cancelled: number;
}

export interface StoreRow {
  store_id: number;
  orders: number;
  gmv: number;
  cancel_rate: number;
  late_rate: number;
}

export interface InventoryRiskRow {
  store_id: number;
  sku: string;
  name: string;
  category: string;
  on_hand_qty: number;
  reorder_point: number;
  avg_hourly_sales_7d: number;
  stock_cover_hours: number;
  is_below_reorder_point: boolean;
}

export interface AnomalyRow {
  anomaly_type: string;
  store_id: number;
  observed_on: string;
  severity: string;
  metric: string;
  observed_value: number;
  expected_value: number;
  detector: string;
}

export type JsonObject = Record<string, unknown>;

export interface DeliveryPrediction {
  order_id?: number | string;
  store_id?: number;
  late_probability?: number;
  predicted_class?: number | boolean | string;
  actual_class?: number | boolean | string;
  predicted_at?: string;
  model_name?: string;
  model_version?: string;
  [key: string]: unknown;
}

export interface DemandForecastRow {
  store_id?: number;
  category?: string;
  day?: string;
  forecast_date?: string;
  expected_units?: number;
  actual_units?: number | null;
  predicted_at?: string;
  model_name?: string;
  model_version?: string;
  [key: string]: unknown;
}

export interface SystemStatus {
  phases: Array<{ phase: number | string; name: string; status: string }>;
  services: Record<string, string>;
  data_root_tables: JsonObject;
}

export interface ChatResponse {
  answer: string;
  evidence?: string[];
  tool_trace?: string[];
  [key: string]: unknown;
}

export type ProposalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "FAILED";

export type ProposalType = "RESTOCK" | "INCIDENT" | "OPS_NOTIFICATION";

export interface Proposal {
  proposal_id: number;
  proposal_type: ProposalType;
  entity_scope: JsonObject;
  recommended_action: string;
  reason: string;
  evidence: string[];
  source_request_id?: string | null;
  validation_status?: string;
  status: ProposalStatus;
  created_at?: string;
  updated_at?: string;
  approved_at?: string | null;
  executed_at?: string | null;
  approved_by?: string | null;
  [key: string]: unknown;
}

export interface AuditEntry {
  audit_id: number;
  proposal_id: number;
  from_status: string | null;
  to_status: string;
  actor: string;
  detail?: string | null;
  correlation_id?: string | null;
  created_at: string;
}

export type SqlSource = "postgres" | "lakehouse";

export interface SqlExecuteRequest {
  source: SqlSource;
  sql: string;
  limit?: number;
}

export interface SqlExecuteResponse {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
  source: SqlSource;
}

export interface SqlGenerateRequest {
  question: string;
  source: SqlSource;
}

export interface SqlGenerateResponse {
  source: SqlSource;
  sql: string;
  /** null when no local model could be constructed at all (e.g. Ollama not installed). */
  model: string | null;
  /** True once the candidate has passed the same read-only guard execute would use. */
  valid: boolean;
  /** True when the local model itself was unreachable; `sql` is a heuristic fallback. */
  degraded: boolean;
  notes: string[];
}

export type CatalogLayer = "raw" | "bronze" | "silver" | "gold";

export interface CatalogTable {
  name: string;
  layer: CatalogLayer;
  columns: Array<{ name: string; type: string; nullable?: boolean }>;
  row_count?: number | null;
  path?: string | null;
}

export interface CatalogTablesResponse {
  tables: CatalogTable[];
}

export interface CatalogPreviewResponse {
  table: string;
  layer: CatalogLayer;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface ErEdge {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface ErDiagramResponse {
  tables: Array<{ name: string; columns: string[] }>;
  edges: ErEdge[];
}

// ---------------------------------------------------------------------------
// Home command center — client-derived contracts. These are not part of the
// FastAPI boundary; they are computed in the browser from existing endpoints
// (kpis, live snapshot, anomalies, proposals, inventory risks) plus a small
// set of illustrative demo-only figures (forecast accuracy, ticket volume)
// for which no backend metric exists yet.
// ---------------------------------------------------------------------------

export type ActivityLogLevel = "info" | "warn" | "error";

export interface ActivityLogEntry {
  id: string;
  ts: string;
  level: ActivityLogLevel;
  source: string;
  message: string;
}
