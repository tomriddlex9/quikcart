// Static documentation for the eight Gold marts, rendered by /data.
//
// Presence (and row counts when the API reports them) come live from
// GET /api/v1/system/status → data_root_tables. The API tracks the five
// pipeline marts on disk; the three ML write-back tables are built by the
// Phase 11 model runs and are shown as "built by model run" when the API
// does not report them.

export interface GoldMart {
  name: string;
  family: "pipeline" | "ml";
  grain: string;
  keyColumns: string[];
  columnsNote: string;
  howBuilt: string;
  builtBy: string;
  consumers: string[];
}

export const GOLD_MARTS: GoldMart[] = [
  {
    name: "gold_store_hourly_metrics",
    family: "pipeline",
    grain: "one row per store × hour",
    keyColumns: ["metric_hour", "store_id"],
    columnsNote:
      "orders_placed/delivered/cancelled, gmv, net_revenue, avg_order_value, cancel_rate, pick & delivery minutes, late_delivery_rate, payment_failure_rate, active_riders_estimate",
    howBuilt:
      "Silver orders truncated to the hour, joined to deliveries, payments and a rider shift-hour estimate — the widest fact table in the platform.",
    builtBy: "Silver→Gold batch job (orchestrated by Airflow in Phase 9)",
    consumers: ["/api/v1/overview/kpis", "/api/v1/trends/orders", "demand + anomaly features"],
  },
  {
    name: "gold_customer_360",
    family: "pipeline",
    grain: "one row per customer (as-of snapshot)",
    keyColumns: ["customer_id"],
    columnsNote:
      "first/last order, lifetime_orders, lifetime_spend, avg_order_value, cancel_rate, promo_order_share, days_since_last_order, preferred_store_id, preferred_category",
    howBuilt:
      "Orders aggregated per customer with a windowed favourite-store and favourite-category pick at the dataset as-of timestamp.",
    builtBy: "Silver→Gold batch job",
    consumers: ["customer analytics", "agent customer lookups"],
  },
  {
    name: "gold_inventory_health",
    family: "pipeline",
    grain: "one row per store × product (snapshot)",
    keyColumns: ["store_id", "product_id", "snapshot_at"],
    columnsNote:
      "on_hand/reserved/available qty, reorder_point, sales_last_1h/24h, avg_hourly_sales_7d, stock_cover_hours, is_below_reorder_point",
    howBuilt:
      "Current inventory joined to trailing movement-window sales; cover hours = available ÷ average hourly sales over 7 days.",
    builtBy: "Silver→Gold batch job",
    consumers: ["/api/v1/inventory/risks", "restock proposals"],
  },
  {
    name: "gold_delivery_performance",
    family: "pipeline",
    grain: "one row per delivery (order grain)",
    keyColumns: ["order_id", "delivery_id"],
    columnsNote:
      "store_id, rider_id, promised_by, pick/delivery/total_fulfillment minutes, is_late, estimated_distance_km, weather_condition (NULL until weather lands)",
    howBuilt:
      "Silver deliveries decorated with order placement timestamps and promise-breach flag; weather column is intentionally NULL-padded, never faked.",
    builtBy: "Silver→Gold batch job",
    consumers: ["delivery analytics", "Phase 11 delivery-model training labels"],
  },
  {
    name: "gold_product_performance",
    family: "pipeline",
    grain: "one row per product",
    keyColumns: ["product_id"],
    columnsNote:
      "sku, name, category, units_sold, revenue, orders_with_product, stores_selling, revenue_share, avg_unit_price",
    howBuilt:
      "Non-cancelled order items aggregated per product, revenue_share computed as a fraction of the whole catalogue.",
    builtBy: "Silver→Gold batch job",
    consumers: ["catalogue analytics", "demand forecasting grain"],
  },
  {
    name: "gold_delivery_predictions",
    family: "ml",
    grain: "one row per test-window order",
    keyColumns: ["order_id"],
    columnsNote:
      "store_id, late_probability, predicted_class, actual_class, predicted_at, model_name, model_version (MLflow run id)",
    howBuilt:
      "Written by train_delivery_model: baseline logistic vs XGBoost on placement-time features, time-aware split, best-by-PR-AUC refit, test-window scores persisted (MLR-005 contract).",
    builtBy: "Phase 11 delivery-delay model run",
    consumers: ["/api/v1/predictions/delivery/{order_id}", "agent tool: predict_delivery_delay"],
  },
  {
    name: "gold_demand_forecasts",
    family: "ml",
    grain: "one row per store × category × forecast day",
    keyColumns: ["store_id", "category", "forecast_date"],
    columnsNote:
      "day (feature date), expected_units, actual_units (backfilled once the day lands), predicted_at, model_name, model_version",
    howBuilt:
      "Written by train_demand_model: persistence and 7-day-MA baselines vs XGBoost on shifted lag/rolling features; the lowest-MAE forecaster's scores persist (MLR-005 contract).",
    builtBy: "Phase 11 demand-forecast model run",
    consumers: ["/api/v1/predictions/demand", "agent tool: forecast_demand"],
  },
  {
    name: "gold_anomalies",
    family: "ml",
    grain: "one row per detected hit",
    keyColumns: ["anomaly_type", "store_id", "observed_on"],
    columnsNote:
      "severity, metric, observed_value, expected_value (null for IsolationForest), detector, model_name, model_version, detected_at",
    howBuilt:
      "Written by detect_anomalies: trailing-30-day z-scores (|z| ≥ 3) plus IsolationForest multivariate outliers over the five-metric daily vector, both with MLflow run ids.",
    builtBy: "Phase 11 anomaly-detection run",
    consumers: ["/api/v1/anomalies", "/ml anomaly panel", "agent anomaly tool", "incident proposals"],
  },
];
