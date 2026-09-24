// Static model documentation for the /ml page.
//
// Mirrors the Phase 11 training code (src/quickcart/ml/*.py) and kit/03 §11.
// Metric VALUES are placeholders on purpose: real per-run numbers live in
// MLflow (experiment quickcart-delivery-delay / -demand-forecast /
// -anomaly-detection) and are re-measured on every training run, so they are
// never hard-coded here. The UI labels them "illustrative" unless it fetched
// a live prediction row that carries a real model_version (MLflow run id).

export interface ModelMetricPlaceholder {
  name: string;
  unit?: string;
  whatItMeans: string;
}

export interface ModelCard {
  id: string;
  title: string;
  kind: "classifier" | "regressor" | "detector";
  status: "trained" | "detector";
  target: string;
  featuresSummary: string;
  featuresDetail: string[];
  baselines: { name: string; note: string }[];
  candidate: { name: string; note: string };
  splitStrategy: string;
  metrics: ModelMetricPlaceholder[];
  leakageNotes: string[];
  outputs: { table: string; how: string };
}

export const MODEL_CARDS: ModelCard[] = [
  {
    id: "delivery-delay",
    title: "Delivery-delay classifier",
    kind: "classifier",
    status: "trained",
    target:
      "is_late — whether an order's delivery breached its promised lead time (binary, from silver_orders + silver_deliveries).",
    featuresSummary:
      "Placement-time facts only: when the order was placed, basket economics, promised lead time, distance, store load and rider availability.",
    featuresDetail: [
      "placed_hour, placed_dow, is_weekend",
      "basket_units, item_count, subtotal, delivery_fee, promo_applied, payment_method",
      "promised_lead_minutes, distance_km",
      "store_orders_last_7d_avg, store_late_rate_before, riders_on_shift, same_hour_orders",
    ],
    baselines: [
      {
        name: "baseline_logistic",
        note: "LogisticRegression(max_iter=1000) on the same feature matrix — the interpretable bar any candidate must beat.",
      },
    ],
    candidate: {
      name: "xgboost",
      note: "XGBClassifier(n_estimators=200, max_depth=5, lr=0.1, eval_metric=logloss). Best model is picked by PR-AUC on the held-out tail, refit on train, then persisted.",
    },
    splitStrategy:
      "Time-aware split by placed_date: rows up to the 70% quantile train, everything after is the test window. No random split — the test window is strictly in the future (MLR-002).",
    metrics: [
      { name: "roc_auc", whatItMeans: "probability the model ranks a late order above an on-time one" },
      { name: "pr_auc", whatItMeans: "area under the precision-recall curve — the headline metric for a ~7% base-rate event" },
      { name: "log_loss", whatItMeans: "calibration of the predicted late_probability; used to read the probability bar honestly" },
    ],
    leakageNotes: [
      "Leakage review (MLR-003) lives in features.build_delivery_features: realised timing facts (pick minutes, actual delivery duration) are excluded.",
      "Only information available at placement time is used — store_late_rate_before is computed over orders placed strictly earlier.",
    ],
    outputs: {
      table: "gold_delivery_predictions",
      how: "Test-window predictions with order_id, late_probability, predicted_class, actual_class, predicted_at, model_name and model_version (MLflow run id) — served by GET /api/v1/predictions/delivery/{order_id}.",
    },
  },
  {
    id: "demand-forecast",
    title: "Demand forecast",
    kind: "regressor",
    status: "trained",
    target:
      "next_day_units — units sold tomorrow for a store × category × day grain, from gold_store_hourly_metrics aggregates.",
    featuresSummary:
      "Purely autoregressive lag/rolling features: yesterday's units, same weekday last week, trailing 7-day mean, weekend flag.",
    featuresDetail: [
      "units_lag_1d",
      "units_lag_7d",
      "units_ma_7d",
      "is_weekend",
    ],
    baselines: [
      {
        name: "baseline_persistence",
        note: "Tomorrow = today's units. The naive bar for any demand model.",
      },
      {
        name: "baseline_ma_7d",
        note: "Trailing 7-day moving average — smooths day-of-week noise.",
      },
    ],
    candidate: {
      name: "xgboost_regressor",
      note: "XGBRegressor(n_estimators=200, max_depth=5, lr=0.1). The winner is the candidate with the lowest MAE on the held-out tail — the baseline wins if it is genuinely better.",
    },
    splitStrategy:
      "Split by calendar time: days up to the 70% quantile train, later days test (train_fraction=0.7). All lag/rolling windows use shift(1) so a day never sees its own outcome.",
    metrics: [
      { name: "mae", unit: "units", whatItMeans: "mean absolute error in units — the model-selection metric" },
      { name: "rmse", unit: "units", whatItMeans: "punishes large misses; read together with MAE to spot spike blindness" },
    ],
    leakageNotes: [
      "Every rolling feature is shifted one day before the window is applied — the model can only look backwards.",
      "Promotions and weather are deliberately NOT features here; they are documented as known limitations, not silently omitted.",
    ],
    outputs: {
      table: "gold_demand_forecasts",
      how: "Forecast rows with store_id, category, forecast_date, expected_units, actual_units (once the day lands), predicted_at, model_name, model_version — served by GET /api/v1/predictions/demand.",
    },
  },
  {
    id: "anomaly-detection",
    title: "Operational anomaly detection",
    kind: "detector",
    status: "detector",
    target:
      "Per-store daily operating envelopes across five metrics: orders, gmv, cancel_rate, payment_failure_rate, avg_delivery_minutes.",
    featuresSummary:
      "The five-metric daily feature vector per store, built from gold_store_hourly_metrics — one row per store × day.",
    featuresDetail: [
      "orders, gmv",
      "cancel_rate, payment_failure_rate",
      "avg_delivery_minutes",
    ],
    baselines: [
      {
        name: "baseline_zscore",
        note: "Trailing 30-day z-score per store per metric (min 7 days warmup, shifted 1 day), flagging |z| ≥ 3.0. Robust and fully interpretable: every hit reports observed vs expected.",
      },
    ],
    candidate: {
      name: "isolation_forest",
      note: "IsolationForest(n_estimators=200, contamination=0.02, seed=42) over the multivariate vector — catches joint deviations no single z-score can see.",
    },
    splitStrategy:
      "Detection, not prediction — no train/test split. The z-score window is shifted one day so a spike does not contaminate its own baseline; IsolationForest scores the full history.",
    metrics: [
      { name: "anomalies_detected", whatItMeans: "hit count per detector, logged to MLflow — precision is judged by the ops review in the proposals queue, not a synthetic label" },
    ],
    leakageNotes: [
      "Rolling mean/std for z-scores use .shift(1) — a day is compared only against days before it.",
      "IsolationForest expected_value is null by construction (no point estimate); the UI shows the outlier score instead.",
    ],
    outputs: {
      table: "gold_anomalies",
      how: "Typed hits (zscore_* / isolation_forest_outlier) with store, observed_on, severity, metric, observed vs expected, detector and model_version — served by GET /api/v1/anomalies and consumed by the agent.",
    },
  },
];
