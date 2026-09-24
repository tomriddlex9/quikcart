"""Incremental delivery-delay inference for the live worker."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import joblib
import pandas as pd
from delta import DeltaTable
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from quickcart.live.contracts import DELIVERY_FEATURES_JSON, DELIVERY_MODEL_JOBLIB
from quickcart.ml.delivery_model import MODEL_NAME
from quickcart.ml.features import build_delivery_features


def _model_frame(pdf: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    ignored = {
        "order_id",
        "store_id",
        "is_late",
        "placed_at",
        "placed_date",
    }
    frame = pdf.drop(columns=[column for column in ignored if column in pdf], errors="ignore")
    if "promo_applied" in frame:
        frame["promo_applied"] = frame["promo_applied"].astype(int)
    categorical = [column for column in ("payment_method",) if column in frame]
    if categorical:
        frame[categorical] = frame[categorical].fillna("UNKNOWN").astype(str)
        frame = pd.get_dummies(frame, columns=categorical, dtype=float)
    for column in frame.columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.fillna(frame.median(numeric_only=True)).fillna(0)
    return frame.reindex(columns=feature_columns, fill_value=0)


def _new_features(features: DataFrame, predictions_path: Path) -> DataFrame:
    if not predictions_path.exists():
        return features
    scored_ids = (
        features.sparkSession.read.format("delta")
        .load(str(predictions_path))
        .select("order_id")
        .distinct()
    )
    return features.join(scored_ids, "order_id", "left_anti")


def score_unscored_orders(
    spark: SparkSession,
    root: Path,
    *,
    features: DataFrame | None = None,
) -> dict[str, int]:
    """Score only order IDs absent from the delivery prediction sink."""
    source = features if features is not None else build_delivery_features(spark, root)
    rows_in = source.count()
    predictions_path = root / "gold" / "gold_delivery_predictions"
    unscored = _new_features(source, predictions_path)
    if not unscored.head(1):
        return {"rows_in": rows_in, "rows_out": 0}

    model_path = root / DELIVERY_MODEL_JOBLIB
    columns_path = root / DELIVERY_FEATURES_JSON
    model = joblib.load(model_path)
    feature_columns = json.loads(columns_path.read_text(encoding="utf-8"))
    if not isinstance(feature_columns, list) or not all(
        isinstance(column, str) for column in feature_columns
    ):
        raise ValueError(f"invalid delivery feature contract: {columns_path}")

    pdf = unscored.toPandas()
    model_input = _model_frame(pdf, feature_columns)
    probabilities = model.predict_proba(model_input)[:, 1]
    output = pd.DataFrame(
        {
            "order_id": pdf["order_id"].astype("int64"),
            "store_id": pdf["store_id"].astype("int64"),
            "late_probability": probabilities,
            "predicted_class": (probabilities >= 0.5).astype("int64"),
            "actual_class": pdf["is_late"].astype("int64"),
            "predicted_at": datetime.now(UTC),
            "model_name": MODEL_NAME,
            "model_version": "joblib",
        }
    )
    predictions = spark.createDataFrame(output).withColumn(
        "late_probability", F.round("late_probability", 4)
    )

    if predictions_path.exists():
        (
            DeltaTable.forPath(spark, str(predictions_path))
            .alias("target")
            .merge(predictions.alias("source"), "target.order_id = source.order_id")
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        predictions.write.format("delta").mode("overwrite").save(str(predictions_path))
    return {"rows_in": rows_in, "rows_out": len(output)}
