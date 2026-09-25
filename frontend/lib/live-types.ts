// Frozen live-demo contracts. Mirror src/quickcart/live/contracts.py.
// A4/A5 code against these; do not invent alternate field names.

export type PipelineStage =
  | "order_events_bronze"
  | "cdc_bronze"
  | "cdc_silver"
  | "gold_refresh"
  | "ml_scoring"
  | "anomaly_detect"
  | "worker";

export interface LiveOrderRow {
  order_id: number;
  store_id: number;
  status: string;
  total_amount: number;
  placed_at: string;
  customer_id?: number | null;
}

export interface LiveStoreCount {
  store_id: number;
  orders_1m: number;
  orders_15m: number;
  gmv_15m: number;
}

export interface LiveMinuteBucket {
  minute: string;
  orders: number;
  gmv: number;
}

export interface LiveSnapshot {
  generated_at: string;
  orders_1m: number;
  orders_15m: number;
  orders_60m: number;
  gmv_1m: number;
  gmv_15m: number;
  gmv_60m: number;
  orders_per_minute: LiveMinuteBucket[];
  status_mix: Record<string, number>;
  per_store: LiveStoreCount[];
  recent_orders: LiveOrderRow[];
  payment_failure_rate_15m: number;
  active_deliveries: number;
}

export interface StageHeartbeat {
  stage: PipelineStage;
  last_run_at?: string | null;
  rows_in: number;
  rows_out: number;
  lag_seconds?: number | null;
  error?: string | null;
  detail?: Record<string, unknown>;
  updated_at?: string | null;
}

export interface LayerCounts {
  postgres: Record<string, number>;
  redpanda: Record<string, number>;
  bronze: Record<string, number>;
  silver: Record<string, number>;
  gold: Record<string, number>;
  quarantine: Record<string, number>;
}

export interface LivePipeline {
  generated_at: string;
  counts: LayerCounts;
  heartbeats: StageHeartbeat[];
  end_to_end_lag_seconds?: number | null;
  gold_refreshed_at?: string | null;
}

export type LineageLayer = "raw" | "bronze" | "silver" | "quarantine" | "gold";

export interface LineageNode {
  id: string;
  layer: LineageLayer;
  name: string;
  columns: string[];
  row_count?: number | null;
}

export interface LineageEdge {
  source: string;
  target: string;
  kind: "batch" | "cdc" | "stream" | "ml";
}

export interface CatalogLineage {
  generated_at: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/** Demo fallback when the live API has never answered. */
export const DEMO_LIVE_SNAPSHOT: LiveSnapshot = {
  generated_at: new Date(0).toISOString(),
  orders_1m: 0,
  orders_15m: 0,
  orders_60m: 0,
  gmv_1m: 0,
  gmv_15m: 0,
  gmv_60m: 0,
  orders_per_minute: [],
  status_mix: {},
  per_store: [],
  recent_orders: [],
  payment_failure_rate_15m: 0,
  active_deliveries: 0,
};

export const DEMO_LIVE_PIPELINE: LivePipeline = {
  generated_at: new Date(0).toISOString(),
  counts: {
    postgres: {},
    redpanda: {},
    bronze: {},
    silver: {},
    gold: {},
    quarantine: {},
  },
  heartbeats: [],
  end_to_end_lag_seconds: null,
  gold_refreshed_at: null,
};
