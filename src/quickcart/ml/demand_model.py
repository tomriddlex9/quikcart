"""Demand forecasting (kit/02 Model B, kit/03 §11.4).

Grain: store x category x day. Baselines: previous-day persistence and a
7-day moving average — both time-aware. Candidate: XGBoost regression on
lag/rolling features. Split by calendar time; metrics MAE/RMSE on the held
out tail. Forecasts persist to `gold_demand_forecasts` with the MLR-005
prediction contract.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

import joblib
import mlflow
import mlflow.sklearn
import pandas as pd
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from sklearn.metrics import mean_absolute_error, mean_squared_error
from xgboost import XGBRegressor

from quickcart.live.contracts import DEMAND_FEATURES_JSON, DEMAND_MODEL_JOBLIB
from quickcart.ml.features import build_demand_features

MODEL_NAME = "demand_forecast_daily"
FEATURES = ["units_lag_1d", "units_lag_7d", "units_ma_7d", "is_weekend"]


class _ColumnBaselineRegressor:
    """Serializable predictor for a selected persistence/rolling baseline."""

    def __init__(self, feature: str) -> None:
        self.feature = feature

    def predict(self, features: pd.DataFrame):
        return features[self.feature].to_numpy()


def _export_live_artifacts(model, feature_columns: list[str], root: Path) -> None:
    """Persist the selected model and its input-column contract."""
    model_path = root / DEMAND_MODEL_JOBLIB
    features_path = root / DEMAND_FEATURES_JSON
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_path)
    features_path.write_text(
        json.dumps(feature_columns, indent=2) + "\n",
        encoding="utf-8",
    )


def _mae(y_true, y_pred) -> float:
    return round(float(mean_absolute_error(y_true, y_pred)), 4)


def _rmse(y_true, y_pred) -> float:
    return round(float(mean_squared_error(y_true, y_pred) ** 0.5), 4)


def train_demand_model(
    spark: SparkSession,
    root: Path,
    tracking_uri: str | None = None,
    train_fraction: float = 0.7,
) -> dict:
    features = build_demand_features(spark, root)
    pdf = features.toPandas()
    if pdf.empty:
        raise ValueError("no demand feature rows — check silver inputs")

    cutoff = pdf["day"].sort_values().quantile(train_fraction)
    train = pdf[pdf["day"] <= cutoff].dropna(subset=FEATURES)
    test = pdf[pdf["day"] > cutoff].dropna(subset=FEATURES)
    if train.empty or test.empty:
        raise ValueError("time split produced an empty window")
    X_train, y_train = train[FEATURES], train["next_day_units"].astype(float)
    X_test, y_test = test[FEATURES], test["next_day_units"].astype(float)

    if tracking_uri:
        mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment("quickcart-demand-forecast")

    results: dict[str, dict] = {}
    baselines = {
        "baseline_persistence": X_test["units_lag_1d"],
        "baseline_ma_7d": X_test["units_ma_7d"],
    }
    for name, preds in baselines.items():
        with mlflow.start_run(run_name=name) as run:
            mlflow.log_param("model", name)
            mlflow.set_tag("baseline", "true")
            mlflow.log_param("train_window_end", str(train["day"].max()))
            mlflow.log_param("test_window_start", str(test["day"].min()))
            metrics = {"mae": _mae(y_test, preds), "rmse": _rmse(y_test, preds)}
            mlflow.log_metrics(metrics)
            results[name] = {"run_id": run.info.run_id, "metrics": metrics}

    model = XGBRegressor(n_estimators=200, max_depth=5, learning_rate=0.1)
    with mlflow.start_run(run_name="xgboost_regressor") as run:
        mlflow.log_param("model", "xgboost_regressor")
        mlflow.log_param("features", ",".join(FEATURES))
        mlflow.log_param("split", "time-based by day")
        mlflow.set_tag("baseline", "false")
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        metrics = {"mae": _mae(y_test, preds), "rmse": _rmse(y_test, preds)}
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(
                model,
                artifact_path="model",
                skops_trusted_types=["xgboost.core.Booster",
                                     "xgboost.sklearn.XGBClassifier",
                                     "xgboost.sklearn.XGBRegressor"],
            )
        results["xgboost_regressor"] = {"run_id": run.info.run_id, "metrics": metrics}

    best_name = min(results, key=lambda n: results[n]["metrics"]["mae"])
    if best_name == "xgboost_regressor":
        best_model = model
    elif best_name == "baseline_persistence":
        best_model = _ColumnBaselineRegressor("units_lag_1d")
    else:
        best_model = _ColumnBaselineRegressor("units_ma_7d")
    _export_live_artifacts(best_model, FEATURES, root)
    predicted_at = datetime.now(UTC)

    forecast = test[["store_id", "category", "day"]].copy()
    forecast["forecast_date"] = forecast["day"] + pd.Timedelta(days=1)
    forecast["expected_units"] = best_model.predict(X_test)
    forecast["actual_units"] = y_test.values
    forecast["predicted_at"] = predicted_at
    forecast["model_name"] = MODEL_NAME
    forecast["model_version"] = results[best_name]["run_id"]

    out = spark.createDataFrame(forecast).withColumn(
        "predicted_at", F.col("predicted_at").cast("timestamp")
    )
    out_path = root / "gold" / "gold_demand_forecasts"
    out.write.format("delta").mode("overwrite").save(str(out_path))

    return {
        "best_model": best_name,
        "metrics": {n: r["metrics"] for n, r in results.items()},
        "forecasts_path": str(out_path),
        "model_artifact": str(root / DEMAND_MODEL_JOBLIB),
        "features_artifact": str(root / DEMAND_FEATURES_JSON),
        "test_rows": len(test),
        "prediction_timestamp": predicted_at.isoformat(),
    }
