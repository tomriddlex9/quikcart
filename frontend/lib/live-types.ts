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

/** Bundled live-stream fixture. Shown only when the header toggle is Demo. */
export const DEMO_LIVE_SNAPSHOT: LiveSnapshot = {
  generated_at: "2026-09-22T18:42:11Z",
  orders_1m: 38,
  orders_15m: 540,
  orders_60m: 1860,
  gmv_1m: 32_400,
  gmv_15m: 490_000,
  gmv_60m: 1_820_000,
  orders_per_minute: [
    { minute: "2026-09-22T18:38:00Z", orders: 31, gmv: 28_100 },
    { minute: "2026-09-22T18:39:00Z", orders: 36, gmv: 31_400 },
    { minute: "2026-09-22T18:40:00Z", orders: 42, gmv: 36_800 },
    { minute: "2026-09-22T18:41:00Z", orders: 34, gmv: 29_600 },
    { minute: "2026-09-22T18:42:00Z", orders: 38, gmv: 32_400 },
  ],
  status_mix: { PLACED: 18, PICKING: 9, OUT_FOR_DELIVERY: 7, DELIVERED: 4 },
  per_store: [
    { store_id: 1, orders_1m: 8, orders_15m: 120, gmv_15m: 108_000 },
    { store_id: 3, orders_1m: 11, orders_15m: 146, gmv_15m: 132_000 },
    { store_id: 4, orders_1m: 9, orders_15m: 98, gmv_15m: 86_000 },
  ],
  recent_orders: [
    { order_id: 88041, store_id: 3, status: "PLACED", total_amount: 412.5, placed_at: "2026-09-22T18:42:04Z" },
    { order_id: 88038, store_id: 4, status: "OUT_FOR_DELIVERY", total_amount: 286, placed_at: "2026-09-22T18:41:40Z" },
    { order_id: 88033, store_id: 1, status: "DELIVERED", total_amount: 154.75, placed_at: "2026-09-22T18:40:12Z" },
  ],
  payment_failure_rate_15m: 0.032,
  active_deliveries: 112,
};

export const DEMO_LIVE_PIPELINE: LivePipeline = {
  generated_at: "2026-09-22T18:40:19Z",
  counts: {
    postgres: { orders: 264_000 },
    redpanda: { order_events: 1_200 },
    bronze: { orders: 258_400 },
    silver: { orders: 231_900 },
    gold: { store_hourly: 41_760 },
    quarantine: { orders: 4_120 },
  },
  heartbeats: [
    {
      stage: "gold_refresh",
      last_run_at: "2026-09-22T18:40:19Z",
      rows_in: 48_213,
      rows_out: 48_213,
      lag_seconds: 42,
    },
  ],
  end_to_end_lag_seconds: 42,
  gold_refreshed_at: "2026-09-22T18:40:19Z",
};
