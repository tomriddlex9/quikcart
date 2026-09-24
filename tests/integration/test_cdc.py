"""Phase 8 integration: PostgreSQL → Debezium → Redpanda → Bronze CDC → Silver MERGE.

Guarded by broker/connect/db reachability; proves kit/07 Phase 8:
- INSERT captured downstream, UPDATE captured, DELETE policy demonstrated;
- CDC events land in Bronze with envelope lineage;
- Silver current-state table reflects the change (upsert + hard delete).
"""

import json
import os
import time
import urllib.request

import pytest

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.ingestion.cdc import apply_cdc_to_silver, build_cdc_query
from quickcart.lakehouse.common.spark import build_spark

pytestmark = [pytest.mark.integration, pytest.mark.slow]

CONNECT_URL = os.environ.get("DEBEZIUM_CONNECT_URL", "http://127.0.0.1:8083")


def _connect_up() -> bool:
    try:
        with urllib.request.urlopen(f"{CONNECT_URL}/connectors", timeout=2):
            return True
    except (OSError, urllib.error.URLError):
        return False


def _register_connector() -> None:
    # Remove any previous connector so offsets do not leak across test runs.
    try:
        request = urllib.request.Request(
            f"{CONNECT_URL}/connectors/quickcart-orders-cdc", method="DELETE"
        )
        urllib.request.urlopen(request, timeout=15)
        time.sleep(5)
    except (OSError, urllib.error.URLError):
        pass
    config_path = "infrastructure/debezium/connector_orders.json"
    env = {
        "POSTGRES_USER": os.environ.get("POSTGRES_USER", "quickcart_app"),
        "POSTGRES_PASSWORD": os.environ.get("POSTGRES_PASSWORD", "quickcart_app_dev"),
        "POSTGRES_DB": os.environ.get("POSTGRES_DB", "quickcart"),
    }
    with open(config_path, encoding="utf-8") as fh:
        raw = fh.read()
    for var, value in env.items():
        raw = raw.replace("${" + var + "}", value)
    with open(config_path, encoding="utf-8") as fh:
        body = json.loads(raw)
    payload = json.dumps(body["config"]).encode()
    request = urllib.request.Request(
        f"{CONNECT_URL}/connectors/{body['name']}/config",
        data=payload,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        response.read()


def _connector_running() -> bool:
    try:
        with urllib.request.urlopen(
            f"{CONNECT_URL}/connectors/quickcart-orders-cdc/status", timeout=5
        ) as response:
            status = json.loads(response.read())
    except (OSError, urllib.error.URLError):
        return False
    return any(task["state"] == "RUNNING" for task in status.get("tasks", []))


def _mutate_source() -> int:
    """UPDATE an existing order, INSERT a new one, DELETE another."""
    with connect(autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SELECT min(order_id) FROM orders")
        target = cur.fetchone()[0]
        cur.execute(
            "UPDATE orders SET status = 'CANCELLED', updated_at = now() "
            "WHERE order_id = %s",
            (target,),
        )
        cur.execute(
            """INSERT INTO orders (order_id, customer_id, store_id, address_id,
                       promotion_id, status, subtotal, item_discount, promo_discount,
                       delivery_fee, tax_amount, total_amount, currency, placed_at, updated_at)
                   VALUES (990000001, 1, 1, NULL, NULL, 'PLACED', 10.00, 0, 0, 30.00, 2.00,
                           42.00, 'INR', now(), now())"""
        )
        cur.execute("DELETE FROM orders WHERE order_id = 990000001")
        return target


def test_cdc_insert_update_delete_propagate(seeded_db, tmp_path) -> None:
    if not _connect_up():
        pytest.skip("Debezium Connect unreachable; run: docker compose --profile streaming up -d")
    _register_connector()
    deadline = time.time() + 90
    while not _connector_running() and time.time() < deadline:
        time.sleep(3)
    if not _connector_running():
        pytest.fail("debezium connector did not reach RUNNING state")

    settings = get_settings()
    spark = build_spark("quickcart-cdc-it", test=True)
    root = tmp_path / "lake"
    checkpoint = root / "checkpoints" / "cdc"
    cdc_bronze_path = root / "bronze" / "bronze_orders_cdc"
    try:
        # Snapshot ('r') events arrive first; wait for at least one CDC row.
        deadline = time.time() + 120
        while time.time() < deadline:
            query = build_cdc_query(
                spark, settings.redpanda_bootstrap_servers, root, checkpoint
            )
            query.processAllAvailable()
            query.stop()
            if cdc_bronze_path.exists() and (
                spark.read.format("delta").load(str(cdc_bronze_path)).head(1)
            ):
                break
            time.sleep(3)
        else:
            pytest.fail("no CDC rows arrived in bronze after 120s")

        snapshot_count = spark.read.format("delta").load(str(cdc_bronze_path)).count()
        assert snapshot_count > 0

        target = _mutate_source()
        deadline = time.time() + 120
        expected = snapshot_count + 3  # update + insert + delete
        while time.time() < deadline:
            query = build_cdc_query(
                spark, settings.redpanda_bootstrap_servers, root, checkpoint
            )
            query.processAllAvailable()
            query.stop()
            count = spark.read.format("delta").load(str(cdc_bronze_path)).count()
            if count >= expected:
                break
            time.sleep(3)
        else:
            pytest.fail(f"expected {expected} CDC rows, got {count}")

        bronze = spark.read.format("delta").load(str(cdc_bronze_path))
        ops = {r["operation"] for r in bronze.filter("operation = 'd'").collect()}
        assert "d" in ops or bronze.filter("operation = 'd'").count() >= 1

        # Silver apply: latest op per key wins — the inserted-then-deleted
        # order must NOT appear; the UPDATE must be reflected.
        metrics = apply_cdc_to_silver(spark, root)
        assert metrics["deleted"] >= 1
        silver = spark.read.format("delta").load(str(root / "silver" / "silver_orders"))
        assert silver.filter("order_id = 990000001").count() == 0
        updated = silver.filter(f"order_id = {target}").collect()
        assert updated and updated[0]["status"] == "CANCELLED"

        # Idempotent re-apply of the same log keeps Silver state identical.
        apply_cdc_to_silver(spark, root)
        silver_after = spark.read.format("delta").load(str(root / "silver" / "silver_orders"))
        assert silver_after.filter(f"order_id = {target}").collect()[0]["status"] == "CANCELLED"
    finally:
        spark.stop()
