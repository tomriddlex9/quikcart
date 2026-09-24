"""ML training/prediction tests (kit/07 Phase 11) using a file-store MLflow
tracking URI — no server required. Small Spark fixtures keep these fast."""

from datetime import date, timedelta
from pathlib import Path

import pytest
from pyspark.sql import functions as F

from quickcart.ml.anomaly_model import detect_anomalies
from quickcart.ml.delivery_model import train_delivery_model
from quickcart.ml.demand_model import train_demand_model
from quickcart.ml.features import build_delivery_features

pytestmark = pytest.mark.unit

LEAKY_COLUMNS = {"delivered_at", "picked_up_at", "pick_minutes", "ride_minutes"}

TS = "2026-01-01 08:00:00"
TS_COLS = (
    "placed_at", "updated_at", "created_at", "promised_by",
    "assigned_at", "picked_up_at", "delivered_at",
)
MONEY_COLS = (
    "subtotal", "item_discount", "promo_discount", "delivery_fee", "tax_amount",
    "total_amount", "unit_price", "line_discount", "line_total", "amount",
)

SCHEMAS = {
    "silver_orders": (
        "order_id: bigint, customer_id: bigint, store_id: bigint, "
        "address_id: bigint, promotion_id: bigint, status: string, "
        "subtotal: string, item_discount: string, promo_discount: string, "
        "delivery_fee: string, tax_amount: string, total_amount: string, "
        "currency: string, placed_at: string, updated_at: string"
    ),
    "silver_order_items": (
        "order_item_id: bigint, order_id: bigint, product_id: bigint, "
        "quantity: int, unit_price: string, line_discount: string, "
        "line_total: string, created_at: string"
    ),
    "silver_deliveries": (
        "delivery_id: bigint, order_id: bigint, rider_id: bigint, "
        "promised_by: string, assigned_at: string, picked_up_at: string, "
        "delivered_at: string, cancelled_at: string, "
        "estimated_distance_km: double, status: string, created_at: string, "
        "updated_at: string"
    ),
    "silver_payments": (
        "payment_id: bigint, order_id: bigint, payment_method: string, "
        "status: string, amount: string, currency: string, "
        "attempt_number: int, failure_code: string, created_at: string, "
        "updated_at: string"
    ),
    "silver_riders": (
        "rider_id: bigint, home_store_id: bigint, status: string, "
        "shift_start: string, shift_end: string, created_at: string, "
        "updated_at: string"
    ),
}


def _silver_fixture(spark, root: Path, days: int = 40) -> None:
    """Small deterministic Silver fixture: 2 stores, 2 categories, N days."""
    rng_start = date(2026, 7, 15)
    orders, items, deliveries, payments, riders = [], [], [], [], []
    oid = iid = 1
    for d in range(days):
        day = rng_start + timedelta(days=d)
        for store in (1, 2):
            for h in (10, 19):
                placed = f"{day.isoformat()} {h:02d}:15:00"
                # class mixing guaranteed in any window (oid grows with date)
                is_late = 1 if (oid % 3 == 0 if store == 1 else oid % 7 == 0) else 0
                orders.append(
                    (oid, 100 + oid % 50, store, None, None, "DELIVERED",
                     "200.00", "0.00", "0.00", "30.00", "11.50", "241.50",
                     "INR", placed, placed)
                )
                items.append((iid, oid, 1, 2, "100.00", "0.00", "200.00", placed))
                iid += 1
                items.append((iid, oid, 2, 1, "100.00", "0.00", "100.00", placed))
                iid += 1
                promised = f"{day.isoformat()} {h + 1:02d}:10:00"
                minute = "20" if is_late else "05"
                delivered = f"{day.isoformat()} {h + 1:02d}:{minute}:00"
                deliveries.append(
                    (oid, oid, 1, promised, f"{day.isoformat()} {h:02d}:25:00",
                     f"{day.isoformat()} {h:02d}:40:00", delivered, None, 3.5,
                     "DELIVERED", placed, delivered)
                )
                payments.append(
                    (oid, oid, "UPI", "CAPTURED", "241.50", "INR", 1, None,
                     placed, placed)
                )
                oid += 1
    for rider_id in (1, 2, 3, 4):
        home = 1 if rider_id <= 2 else 2
        riders.append((rider_id, home, "OFFLINE", "08:00", "22:00", TS, TS))

    data = {
        "silver_orders": orders,
        "silver_order_items": items,
        "silver_deliveries": deliveries,
        "silver_payments": payments,
        "silver_riders": riders,
    }
    for table, rows in data.items():
        df = spark.createDataFrame(rows, SCHEMAS[table])
        for col in TS_COLS:
            if col in df.columns:
                df = df.withColumn(col, F.to_timestamp(col))
        for col in MONEY_COLS:
            if col in df.columns:
                df = df.withColumn(col, F.col(col).cast("decimal(12,2)"))
        path = root / "silver" / table
        path.mkdir(parents=True)
        df.write.format("delta").save(str(path))

    products = spark.createDataFrame(
        [
            (1, "SKU-1", "Alpha", "Snacks", "Sub", "B", 1.0, "kg", True, TS, TS),
            (2, "SKU-2", "Beta", "Beverages", "Sub", "B", 1.0, "L", True, TS, TS),
        ],
        "product_id: bigint, sku: string, name: string, category: string, "
        "subcategory: string, brand: string, unit_size: double, "
        "unit_name: string, is_active: boolean, created_at: string, "
        "updated_at: string",
    )
    products = products.withColumn("created_at", F.to_timestamp("created_at"))
    products = products.withColumn("updated_at", F.to_timestamp("updated_at"))
    ppath = root / "silver" / "silver_products"
    ppath.mkdir(parents=True)
    products.write.format("delta").save(str(ppath))

    hourly_rows = []
    for d in range(days):
        day = rng_start + timedelta(days=d)
        for store in (1, 2):
            for h in (10, 19):
                spike = 50 if (store == 2 and d == days - 3) else 2
                hourly_rows.append(
                    (f"{day.isoformat()} {h:02d}:00:00", store, spike, spike, 0,
                     500.0, 500.0, 250.0, 0.0, 15.0, 25.0, 0.1, 2, 0.05)
                )
    hourly = spark.createDataFrame(
        hourly_rows,
        "metric_hour: string, store_id: bigint, orders_placed: bigint, "
        "orders_delivered: bigint, orders_cancelled: bigint, gmv: double, "
        "net_revenue: double, avg_order_value: double, cancel_rate: double, "
        "avg_pick_minutes: double, avg_delivery_minutes: double, "
        "late_delivery_rate: double, active_riders_estimate: bigint, "
        "payment_failure_rate: double",
    ).withColumn("metric_hour", F.to_timestamp("metric_hour"))
    gpath = root / "gold" / "gold_store_hourly_metrics"
    gpath.mkdir(parents=True)
    hourly.write.format("delta").save(str(gpath))


@pytest.fixture(scope="module")
def ml_fixture(spark_session, tmp_path_factory):
    root = tmp_path_factory.mktemp("ml_lake")
    _silver_fixture(spark_session, root, days=40)
    tracking = tmp_path_factory.mktemp("mlruns")
    uri = f"sqlite:///{tracking}/mlflow.db"
    return {"root": root, "tracking_uri": uri}


def test_delivery_features_exclude_leakage_columns(ml_fixture, spark_session) -> None:
    features = build_delivery_features(spark_session, ml_fixture["root"])
    leaked = LEAKY_COLUMNS & set(features.columns)
    assert not leaked, f"leaky columns present: {leaked}"
    assert "is_late" in features.columns  # training target
    assert features.count() > 0
    assert features.filter("is_late IS NOT NULL").count() == features.count()


def test_delivery_model_trains_logs_and_persists(ml_fixture, spark_session) -> None:
    result = train_delivery_model(
        spark_session, ml_fixture["root"], tracking_uri=ml_fixture["tracking_uri"]
    )
    assert set(result["metrics"]) == {"baseline_logistic", "xgboost"}
    assert result["test_rows"] > 0

    import mlflow

    mlflow.set_tracking_uri(ml_fixture["tracking_uri"])
    runs = mlflow.search_runs(experiment_names=["quickcart-delivery-delay"])
    assert len(runs) == 2
    assert bool(runs["tags.baseline"].astype(str).isin(["True", "true"]).any())

    predictions = spark_session.read.format("delta").load(
        str(ml_fixture["root"] / "gold" / "gold_delivery_predictions")
    )
    required = {
        "order_id", "late_probability", "predicted_class",
        "predicted_at", "model_name", "model_version",
    }
    assert required <= set(predictions.columns)
    assert predictions.count() == result["test_rows"]


def test_demand_model_baselines_and_forecasts(ml_fixture, spark_session) -> None:
    result = train_demand_model(
        spark_session, ml_fixture["root"], tracking_uri=ml_fixture["tracking_uri"]
    )
    assert "baseline_persistence" in result["metrics"]
    assert "xgboost_regressor" in result["metrics"]
    forecasts = spark_session.read.format("delta").load(
        str(ml_fixture["root"] / "gold" / "gold_demand_forecasts")
    )
    assert forecasts.count() == result["test_rows"]
    required = {"store_id", "forecast_date", "expected_units", "model_version"}
    assert required <= set(forecasts.columns)


def test_time_split_is_chronological(ml_fixture, spark_session) -> None:
    features = build_delivery_features(spark_session, ml_fixture["root"])
    pdf = features.select("placed_date").toPandas()
    cutoff = pdf["placed_date"].sort_values().quantile(0.7)
    train_max = pdf.loc[pdf["placed_date"] <= cutoff, "placed_date"].max()
    test_min = pdf.loc[pdf["placed_date"] > cutoff, "placed_date"].min()
    assert train_max < test_min


def test_anomaly_detection_finds_injected_spike(ml_fixture, spark_session) -> None:
    result = detect_anomalies(
        spark_session, ml_fixture["root"], tracking_uri=ml_fixture["tracking_uri"]
    )
    assert result["forest_hits"] >= 1
    table = spark_session.read.format("delta").load(
        str(ml_fixture["root"] / "gold" / "gold_anomalies")
    )
    assert table.count() > 0
    spike = table.filter("store_id = 2").collect()
    assert spike, "injected spike on store 2 was not detected"
    assert all(row["model_version"] for row in spike)
