# Phase 11 — ML + MLflow

## What was built

- `ml` dependency group: scikit-learn, xgboost, mlflow 3.16.0 (pinned). Host
  prerequisite: `brew install libomp` (xgboost's OpenMP runtime on macOS).
- `ml` compose profile: MLflow 3.16.0 server (ghcr.io/mlflow/mlflow:v3.16.0),
  sqlite backend store + local artifacts under a named volume.
- `src/quickcart/ml/features.py` (Spark, leakage-disciplined):
  - `build_delivery_features` — placement-time features only (hour/dow,
    basket, subtotal, promised lead, distance, same-hour orders, trailing-7d
    store volume, strictly-prior store late rate, riders on shift);
    realised timing facts are excluded and used only as the target `is_late`.
  - `build_demand_features` — store × category × day units with lag-1d,
    lag-7d, 7-day MA and next-day target.
  - `build_anomaly_features` — daily store aggregates (orders, gmv,
    cancel/payment-failure rates, delivery minutes, late rate).
- Models (baseline-first, time-aware splits, MLflow tracking, skops trusted
  types for xgboost/sklearn logging):
  - `delivery_model.py` — LogisticRegression baseline vs XGBClassifier;
    ROC-AUC/PR-AUC/log-loss; predictions → `gold_delivery_predictions`.
  - `demand_model.py` — persistence + 7-day-MA baselines vs XGBRegressor;
    MAE/RMSE; forecasts → `gold_demand_forecasts`.
  - `anomaly_model.py` — trailing-30d z-scores (baseline) + IsolationForest;
    hits → `gold_anomalies` with detector, severity, observed vs expected.
- Every prediction row carries the MLR-005 contract: entity key, prediction
  (probability/expected units), timestamp, model name, model version (MLflow
  run id).

## Verification executed (kit/07 Phase 11)

5 unit tests on a deterministic 40-day fixture: leakage columns absent from
features; two MLflow runs per model with the baseline tagged; prediction and
forecast tables match test-row counts with the contract columns; the split is
strictly chronological; the injected store-2 demand spike is detected by both
detectors. **All gates PASS.**

## What was learned

- MLflow 3.16 put the file store into maintenance mode (sqlite is the happy
  path — same choice as the container) and validates logged models via skops
  (xgboost/sklearn types must be declared trusted).
- Spark 4 needs `F.lit(0)` inside `F.nullif` (no implicit int→Column), and
  pandas Decimal columns must be converted before XGBoost (`pd.to_numeric`).
- Test fixtures must guarantee both classes in EVERY time window — a modulo
  pattern over a monotonically increasing id does that by construction.

## Known limitations

- Weather features are not in v1 (the signal isn't persisted until Phase 9's
  weather feed is wired back — documented follow-up).
- Demand grain is store × category × day (SKU-day is a scale exercise, not a
  correctness one, at 100k orders).
