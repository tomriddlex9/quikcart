import json
from datetime import UTC, datetime

import joblib
import pandas as pd
from sklearn.dummy import DummyClassifier

from quickcart.live.contracts import (
    DELIVERY_FEATURES_JSON,
    DELIVERY_MODEL_JOBLIB,
    DEMAND_FEATURES_JSON,
    DEMAND_MODEL_JOBLIB,
)


def test_scoring_only_writes_unseen_order_ids(spark_session, tmp_path) -> None:
    from quickcart.live.scoring import score_unscored_orders

    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    model = DummyClassifier(strategy="constant", constant=1)
    model.fit(pd.DataFrame({"placed_hour": [8, 9]}), [0, 1])
    joblib.dump(model, tmp_path / DELIVERY_MODEL_JOBLIB)
    (tmp_path / DELIVERY_FEATURES_JSON).write_text(
        json.dumps(["placed_hour"]),
        encoding="utf-8",
    )

    features = spark_session.createDataFrame(
        [
            (1, 10, 8, 0),
            (2, 10, 9, 1),
        ],
        "order_id long, store_id long, placed_hour long, is_late long",
    )
    predictions_path = tmp_path / "gold" / "gold_delivery_predictions"
    existing = spark_session.createDataFrame(
        [
            (
                1,
                10,
                0.2,
                0,
                0,
                datetime(2026, 9, 25, tzinfo=UTC),
                "delivery_delay_classifier",
                "existing",
            )
        ],
        (
            "order_id long, store_id long, late_probability double, predicted_class long, "
            "actual_class long, predicted_at timestamp, model_name string, model_version string"
        ),
    )
    existing.write.format("delta").mode("overwrite").save(str(predictions_path))

    result = score_unscored_orders(spark_session, tmp_path, features=features)

    assert result == {"rows_in": 2, "rows_out": 1}
    rows = spark_session.read.format("delta").load(str(predictions_path))
    assert sorted(row.order_id for row in rows.select("order_id").collect()) == [1, 2]


def test_timer_step_is_callable_in_isolation(spark_session, tmp_path, monkeypatch) -> None:
    from quickcart.live import worker

    heartbeats = []
    monkeypatch.setattr(
        worker,
        "run_gold",
        lambda spark, root: {"gold_store_hourly_metrics": 3},
    )
    monkeypatch.setattr(
        worker,
        "score_unscored_orders",
        lambda spark, root: {"rows_in": 3, "rows_out": 2},
    )
    monkeypatch.setattr(worker, "write_heartbeat", heartbeats.append)

    result = worker.run_timer_step(spark_session, tmp_path)

    assert result["gold_refresh"]["rows_out"] == 3
    assert result["ml_scoring"]["rows_out"] == 2
    assert result["anomaly_detect"]["status"] == "skipped"
    assert [heartbeat.stage for heartbeat in heartbeats] == [
        "gold_refresh",
        "ml_scoring",
        "anomaly_detect",
    ]


def test_training_artifact_helpers_export_models_and_feature_contracts(tmp_path) -> None:
    from quickcart.ml.delivery_model import _export_live_artifacts as export_delivery
    from quickcart.ml.demand_model import _export_live_artifacts as export_demand

    model = DummyClassifier(strategy="most_frequent").fit([[0], [1]], [0, 1])
    export_delivery(model, ["placed_hour"], tmp_path)
    export_demand(model, ["units_lag_1d"], tmp_path)

    assert joblib.load(tmp_path / DELIVERY_MODEL_JOBLIB).predict([[0]]).tolist() == [0]
    assert json.loads((tmp_path / DELIVERY_FEATURES_JSON).read_text()) == ["placed_hour"]
    assert joblib.load(tmp_path / DEMAND_MODEL_JOBLIB).predict([[0]]).tolist() == [0]
    assert json.loads((tmp_path / DEMAND_FEATURES_JSON).read_text()) == ["units_lag_1d"]
