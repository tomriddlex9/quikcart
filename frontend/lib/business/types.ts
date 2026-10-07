// Response contracts for /api/v1/b/* (mirrors src/quickcart/api/business/schemas.py).

export type Status = "good" | "watch" | "bad" | "unknown";
export type MetricUnit = "inr" | "pct" | "count" | "minutes";

export interface Meta {
  as_of_day: string | null;
  is_today: boolean;
  source: "serving" | "live_sql" | "unavailable";
  snapshot_run_id?: number | null;
  snapshot_finished_at?: string | null;
  generated_at: string;
  compare_label: string;
  note: string | null;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number | null;
  display: string;
  unit: MetricUnit;
  status: Status;
  direction: "higher_better" | "lower_better";
  baseline_value: number | null;
  baseline_display: string | null;
  delta_pct: number | null;
  compare_to: string;
  compare_label: string;
  explanation: string;
  plain_description: string;
  is_partial: boolean;
  as_of?: string | null;
}

export interface AttentionItem {
  id: string;
  severity: "watch" | "bad";
  title: string;
  detail: string;
  metric_key: string | null;
  store_id: number | null;
  store_name: string | null;
}

export interface TodayResponse {
  meta: Meta;
  summary: string;
  headline: MetricValue[];
  more: MetricValue[];
  attention: AttentionItem[];
}

export interface StoreScorecard {
  store_id: number;
  store_name: string;
  city: string | null;
  status: Status;
  metrics: Record<string, MetricValue>;
  attention: string[];
}

export interface StoreScorecardsResponse {
  meta: Meta;
  stores: StoreScorecard[];
}

export interface TrendPoint {
  at: string;
  sales: number | null;
  orders: number | null;
}

export type ProductTab = "running_low" | "bestsellers" | "slow";

export interface ProductRow {
  product_id: number;
  sku: string;
  name: string;
  category: string;
  store_id: number | null;
  store_name: string | null;
  on_hand_qty: number | null;
  reorder_point: number | null;
  units_sold: number | null;
  revenue: number | null;
  revenue_display: string | null;
  stock_cover_hours: number | null;
  status: Status;
  note: string;
}

export interface ProductsResponse {
  meta: Meta;
  tab: ProductTab;
  title: string;
  description: string;
  items: ProductRow[];
}

export interface StoreDetail {
  meta: Meta;
  scorecard: StoreScorecard;
  hourly_trend: TrendPoint[];
  daily_trend: TrendPoint[];
  running_low: ProductRow[];
}

export interface DeliveryStoreRow {
  store_id: number;
  store_name: string;
  status: Status;
  on_time_rate: MetricValue;
  avg_delivery_minutes: MetricValue;
}

export interface DeliveryHealthResponse {
  meta: Meta;
  metrics: MetricValue[];
  by_store: DeliveryStoreRow[];
  in_progress: Record<string, number>;
  riders: Record<string, number>;
}

export interface CustomerRow {
  customer_code: string;
  orders: number;
  spend: number;
  spend_display: string;
  last_order_at: string | null;
}

export interface CustomersHealthResponse {
  meta: Meta;
  metrics: MetricValue[];
  new_customers: number | null;
  total_customers: number | null;
  top_customers: CustomerRow[];
}

export interface CategoryMoney {
  category: string;
  sales: number;
  sales_display: string;
  share_pct: number | null;
  units: number;
}

export interface MoneyResponse {
  meta: Meta;
  sales: MetricValue;
  average_basket: MetricValue;
  discounts: number | null;
  discounts_display: string;
  discount_share_pct: number | null;
  refunds: number | null;
  refunds_display: string;
  net_sales: number | null;
  net_sales_display: string;
  cogs?: number | null;
  cogs_display?: string | null;
  contribution_margin?: number | null;
  contribution_margin_display?: string | null;
  margin_pct?: number | null;
  by_category: CategoryMoney[];
  daily_trend: TrendPoint[];
}

export interface TargetRow {
  scope_type: string;
  scope_value: string;
  scope_label: string;
  metric_key: string;
  metric_label: string;
  period_type: string;
  period_start: string;
  target_value: number;
  target_display: string;
  actual_value: number | null;
  actual_display: string | null;
  pace_pct: number | null;
  status: Status;
  set_by: string;
}

export interface TargetsResponse {
  meta: Meta;
  period_start: string | null;
  period_label: string;
  items: TargetRow[];
  note: string | null;
}

export interface ReportRow {
  report_id: number;
  title: string;
  created_at: string | null;
  schedule: string | null;
}

export interface ReportsResponse {
  meta: Meta;
  items: ReportRow[];
  note: string | null;
}

export interface AlertsResponse {
  meta: Meta;
  items: AttentionItem[];
  note: string;
}

export interface MetricDefinition {
  key: string;
  label: string;
  plain_description: string;
  formula_text: string;
  unit: string;
  direction: string;
  gold_source: string;
  synonyms: string[];
  compare_default: string;
  watch_at: number | null;
  bad_at: number | null;
  is_partial: boolean;
  partial_note: string | null;
}

export interface MetricsCatalogResponse {
  metrics: MetricDefinition[];
}

export interface JourneySummary {
  id: string;
  title: string;
  audience: string;
  summary: string;
  step_count: number;
}

export interface JourneyStep {
  journey_id: string;
  n: number;
  total: number;
  title: string;
  body: string;
  link: string | null;
  metric_keys: string[];
  next_n: number | null;
  prev_n: number | null;
}

export type BusinessPersona =
  | "business_exec"
  | "city_manager"
  | "store_manager"
  | "category_manager"
  | "leadership";

export interface BusinessScope {
  scope_type: string;
  scope_value: string;
}
