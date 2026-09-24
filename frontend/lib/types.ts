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
