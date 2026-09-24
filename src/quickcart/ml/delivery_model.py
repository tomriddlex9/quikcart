"""Delivery-delay classification model (kit/02 Model A, kit/03 §11.3).

Baseline-first (MLR-001): logistic regression on a small interpretable
feature set, then a tree-based candidate. Time-aware split by placed date
(MLR-002): the test window is strictly after the train window — no random
split that leaks the future. Leakage review (MLR-003) lives in
`features.build_delivery_features`: realised timing facts are excluded from
features; only placement-time information is used.

Prediction contract (MLR-005): entity key, probability, predicted class,
prediction timestamp, model name/version — persisted to
`gold_delivery_predictions`.
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
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, log_loss, roc_auc_score
from xgboost import XGBClassifier

from quickcart.live.contracts import DELIVERY_FEATURES_JSON, DELIVERY_MODEL_JOBLIB
from quickcart.ml.features import build_delivery_features

MODEL_NAME = "delivery_delay_classifier"
CATEGORICAL = ["payment_method"]
NUMERIC = [
    "placed_hour",
    "placed_dow",
    "is_weekend",
    "basket_units",
    "item_count",
    "subtotal",
    "delivery_fee",
    "promised_lead_minutes",
    "promo_applied",
    "distance_km",
    "store_orders_last_7d_avg",
    "store_late_rate_before",
    "riders_on_shift",
    "same_hour_orders",
]


def _export_live_artifacts(model, feature_columns: list[str], root: Path) -> None:
    """Persist the selected model and its encoded input-column contract."""
    model_path = root / DELIVERY_MODEL_JOBLIB
    features_path = root / DELIVERY_FEATURES_JSON
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_path)
    features_path.write_text(
        json.dumps(feature_columns, indent=2) + "\n",
        encoding="utf-8",
    )


def _prepare(pdf: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    X = pdf[NUMERIC + CATEGORICAL].copy()
    X["promo_applied"] = X["promo_applied"].astype(int)
    X[CATEGORICAL] = X[CATEGORICAL].fillna("UNKNOWN").astype(str)
    X = pd.get_dummies(X, columns=CATEGORICAL, dtype=float)
    for col in X.columns:
        X[col] = pd.to_numeric(X[col], errors="coerce")
    X = X.fillna(X.median(numeric_only=True))
    return X, pdf["is_late"].astype(int)


def _metrics(y_true: pd.Series, probability: pd.Series) -> dict:
    return {
        "roc_auc": round(float(roc_auc_score(y_true, probability)), 4),
        "pr_auc": round(float(average_precision_score(y_true, probability)), 4),
        "log_loss": round(float(log_loss(y_true, probability)), 4),
    }


def train_delivery_model(
    spark: SparkSession,
    root: Path,
    tracking_uri: str | None = None,
    train_fraction: float = 0.7,
) -> dict:
    """Train baseline + candidate, log to MLflow, persist test predictions."""
    features = build_delivery_features(spark, root)
    pdf = features.toPandas()
    if pdf.empty:
        raise ValueError("no delivery feature rows — check silver inputs")

    cutoff = pdf["placed_date"].sort_values().quantile(train_fraction)
    train = pdf[pdf["placed_date"] <= cutoff]
    test = pdf[pdf["placed_date"] > cutoff]
    if train.empty or test.empty:
        raise ValueError("time split produced an empty window")
    X_train, y_train = _prepare(train)
    X_test, y_test = _prepare(test)

    if tracking_uri:
        mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment("quickcart-delivery-delay")

    results: dict[str, dict] = {}
    candidates = {
        "baseline_logistic": LogisticRegression(max_iter=1000),
        "xgboost": XGBClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.1, eval_metric="logloss"
        ),
    }
    for name, model in candidates.items():
        with mlflow.start_run(run_name=name) as run:
            mlflow.log_param("model", name)
            mlflow.log_param("split", "time-based by placed_date")
            mlflow.log_param("train_rows", len(train))
            mlflow.log_param("test_rows", len(test))
            mlflow.log_param("train_window_end", str(train["placed_date"].max()))
            mlflow.log_param("test_window_start", str(test["placed_date"].min()))
            mlflow.set_tag("baseline", str(name == "baseline_logistic"))
            mlflow.set_tag("leakage_review", "features exclude realised timing facts")
            model.fit(X_train, y_train)
            probability = model.predict_proba(X_test)[:, 1]
            metrics = _metrics(y_test, probability)
            mlflow.log_metrics(metrics)
            mlflow.sklearn.log_model(
                model,
                artifact_path="model",
                skops_trusted_types=["xgboost.core.Booster",
                                     "xgboost.sklearn.XGBClassifier",
                                     "xgboost.sklearn.XGBRegressor"],
            )
            results[name] = {"run_id": run.info.run_id, "metrics": metrics}

    best_name = max(results, key=lambda n: results[n]["metrics"]["pr_auc"])
    best = candidates[best_name].fit(X_train, y_train)
    _export_live_artifacts(best, X_train.columns.tolist(), root)
    probability = best.predict_proba(X_test)[:, 1]
    predicted = (probability >= 0.5).astype(int)
    predicted_at = datetime.now(UTC)

    predictions = test[["order_id", "store_id"]].copy()
    predictions["late_probability"] = probability
    predictions["predicted_class"] = predicted
    predictions["actual_class"] = test["is_late"].astype(int).values
    predictions["predicted_at"] = predicted_at
    predictions["model_name"] = MODEL_NAME
    predictions["model_version"] = results[best_name]["run_id"]

    out = (
        spark.createDataFrame(predictions)
        .withColumn("predicted_at", F.col("predicted_at").cast("timestamp"))
        .withColumn("late_probability", F.round("late_probability", 4))
    )
    out_path = root / "gold" / "gold_delivery_predictions"
    out.write.format("delta").mode("overwrite").save(str(out_path))

    return {
        "best_model": best_name,
        "best_run_id": results[best_name]["run_id"],
        "metrics": {n: r["metrics"] for n, r in results.items()},
        "predictions_path": str(out_path),
        "model_artifact": str(root / DELIVERY_MODEL_JOBLIB),
        "features_artifact": str(root / DELIVERY_FEATURES_JSON),
        "test_rows": len(test),
        "prediction_timestamp": predicted_at.isoformat(),
    }
