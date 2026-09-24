"""Operational anomaly detection (kit/02 Model C, kit/03 §11.5).

Baseline first: per-store, per-metric z-scores over a trailing 30-day window
(robust, interpretable). Candidate: IsolationForest over the daily feature
vector. Both write into `gold_anomalies` with type, entity, observed time,
severity, observed vs expected, and model version — queryable by analytics
and the agent downstream (kit/02 FR-020).
"""

from datetime import UTC, datetime
from pathlib import Path

import mlflow
import mlflow.sklearn
import numpy as np
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from sklearn.ensemble import IsolationForest

from quickcart.ml.features import build_anomaly_features

MODEL_NAME = "operational_anomaly"
METRICS = ["orders", "gmv", "cancel_rate", "payment_failure_rate", "avg_delivery_minutes"]
Z_THRESHOLD = 3.0
TRAILING_DAYS = 30


def detect_anomalies(
    spark: SparkSession,
    root: Path,
    tracking_uri: str | None = None,
) -> dict:
    features = build_anomaly_features(spark, root)
    pdf = features.toPandas()
    if pdf.empty:
        raise ValueError("no anomaly feature rows — check gold inputs")

    if tracking_uri:
        mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment("quickcart-anomaly-detection")

    # --- baseline: trailing z-scores -----------------------------------------
    baseline_hits: list[dict] = []
    for store_id, group in pdf.sort_values("day").groupby("store_id"):
        for metric in METRICS:
            series = group[metric]
            rolling_mean = series.rolling(TRAILING_DAYS, min_periods=7).mean().shift(1)
            rolling_std = series.rolling(TRAILING_DAYS, min_periods=7).std().shift(1)
            z = (series - rolling_mean) / rolling_std
            for idx in z[z.abs() >= Z_THRESHOLD].index:
                baseline_hits.append(
                    {
                        "anomaly_type": f"zscore_{metric}",
                        "store_id": int(store_id),
                        "observed_on": group.loc[idx, "day"],
                        "severity": "high" if abs(z[idx]) >= 4 else "medium",
                        "metric": metric,
                        "observed_value": round(float(series[idx]), 4),
                        "expected_value": round(float(rolling_mean[idx]), 4),
                        "detector": "baseline_zscore",
                    }
                )

    with mlflow.start_run(run_name="baseline_zscore") as run:
        mlflow.log_param("detector", "trailing_zscore")
        mlflow.log_param("metrics", ",".join(METRICS))
        mlflow.log_param("z_threshold", Z_THRESHOLD)
        mlflow.log_param("trailing_days", TRAILING_DAYS)
        mlflow.set_tag("baseline", "true")
        mlflow.log_metric("anomalies_detected", len(baseline_hits))
        baseline_run_id = run.info.run_id

    # --- candidate: IsolationForest -------------------------------------------
    X = pdf[METRICS].fillna(pdf[METRICS].median())
    forest = IsolationForest(n_estimators=200, contamination=0.02, random_state=42)
    labels = forest.fit_predict(X)
    scores = -forest.decision_function(X)
    forest_hits = pdf[labels == -1]

    with mlflow.start_run(run_name="isolation_forest") as run:
        mlflow.log_param("detector", "isolation_forest")
        mlflow.log_param("contamination", 0.02)
        mlflow.set_tag("baseline", "false")
        mlflow.log_metric("anomalies_detected", int((labels == -1).sum()))
        mlflow.sklearn.log_model(
            forest,
            artifact_path="model",
            skops_trusted_types=["sklearn.tree._tree.Tree"],
        )
        forest_run_id = run.info.run_id

    detected_at = datetime.now(UTC)
    rows = []
    for hit in baseline_hits:
        rows.append(
            {
                **hit,
                "model_name": MODEL_NAME,
                "model_version": baseline_run_id,
                "detected_at": detected_at,
            }
        )
    for idx in forest_hits.index:
        outlier_scores = scores[labels == -1]
        severity_boundary = float(np.median(outlier_scores))
        rows.append(
            {
                "anomaly_type": "isolation_forest_outlier",
                "store_id": int(pdf.loc[idx, "store_id"]),
                "observed_on": pdf.loc[idx, "day"],
                "severity": "medium" if scores[idx] < severity_boundary else "high",
                "metric": "multivariate",
                "observed_value": round(float(scores[idx]), 4),
                "expected_value": None,
                "detector": "isolation_forest",
                "model_name": MODEL_NAME,
                "model_version": forest_run_id,
                "detected_at": detected_at,
            }
        )

    out = spark.createDataFrame(rows).withColumn(
        "detected_at", F.col("detected_at").cast("timestamp")
    )
    out_path = root / "gold" / "gold_anomalies"
    out.write.format("delta").mode("overwrite").save(str(out_path))
    return {
        "baseline_hits": len(baseline_hits),
        "forest_hits": int((labels == -1).sum()),
        "table": str(out_path),
    }
