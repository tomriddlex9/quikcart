"""Phase 14 API integration tests (kit/07 Phase 14 gates).

Covers the full proposal lifecycle against the seeded operational DB plus the
analytics/status routes against a one-shot pipeline run. Uses FastAPI
TestClient — no real server is started. Each lifecycle test consumes a fresh
(store_id, product_id) scope so the duplicate-open rule never misfires.
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from quickcart.api.app import create_app

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def app_client(spark_session, pipeline_run):
    app = create_app(spark=spark_session, data_root=pipeline_run["root"])
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="module")
def next_scope(seeded_db):
    """Successive inventory scopes, one per call (smoke seed has hundreds)."""
    from quickcart.db.connection import connect_dict

    with connect_dict() as conn, conn.cursor() as cur:
        cur.execute("SELECT store_id, product_id FROM inventory ORDER BY store_id, product_id")
        rows = cur.fetchall()
    assert len(rows) >= 10, "need several inventory rows for proposal tests"
    index = {"i": 0}

    def _next() -> dict:
        row = dict(rows[index["i"]])
        index["i"] += 1
        return row

    return _next


def _payload(scope, quantity: int) -> dict:
    return {
        "proposal_type": "RESTOCK",
        "entity_scope": {
            "store_id": int(scope["store_id"]),
            "product_id": int(scope["product_id"]),
            "quantity": quantity,
        },
        "recommended_action": f"Restock {quantity} units",
        "reason": "on-hand below reorder point (gold_inventory_health)",
        "evidence": ["gold_inventory_health: stock_cover_hours below threshold"],
        "source_request_id": "req-phase14-test",
    }


def _get_inventory_qty(scope) -> int:
    from quickcart.db.connection import connect_dict

    with connect_dict() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT on_hand_qty FROM inventory WHERE store_id = %s AND product_id = %s",
            (scope["store_id"], scope["product_id"]),
        )
        return int(cur.fetchone()["on_hand_qty"])


def _set_inventory_freshness(scope, updated_at: datetime) -> None:
    from quickcart.db.connection import connect

    with connect() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "UPDATE inventory SET updated_at = %s WHERE store_id = %s AND product_id = %s",
            (updated_at, scope["store_id"], scope["product_id"]),
        )


# --- health + system status -------------------------------------------------------


def test_health(app_client) -> None:
    body = app_client.get("/health").json()
    assert body["status"] == "ok"
    assert body["service"] == "quickcart-api"
    assert isinstance(body["version"], str) and body["version"]


def test_system_status_shape(app_client) -> None:
    resp = app_client.get("/api/v1/system/status")
    assert resp.status_code == 200
    body = resp.json()
    assert {p["phase"] for p in body["phases"]} >= {0, 1, 14}
    assert all(set(p) == {"phase", "name", "status"} for p in body["phases"])
    assert set(body["services"]) == {"postgres", "redpanda", "qdrant", "mlflow"}
    assert set(body["data_root_tables"]) == {
        "gold_store_hourly_metrics",
        "gold_customer_360",
        "gold_inventory_health",
        "gold_delivery_performance",
        "gold_product_performance",
    }
    assert body["services"]["postgres"] == "up"  # seeded_db guarantees it
    assert all(isinstance(v, bool) for v in body["data_root_tables"].values())


def test_correlation_id_header_roundtrip(app_client) -> None:
    resp = app_client.get("/health", headers={"X-Correlation-ID": "cid-123"})
    assert resp.headers["X-Correlation-ID"] == "cid-123"
    assert app_client.get("/health").headers["X-Correlation-ID"]


# --- analytics routes ----------------------------------------------------------------


def test_kpis_shape(app_client) -> None:
    kpis = app_client.get("/api/v1/overview/kpis").json()
    assert set(kpis) == {
        "gmv",
        "orders_placed",
        "cancellation_rate",
        "late_delivery_rate",
        "products_below_reorder",
        "active_customers",
    }
    assert kpis["orders_placed"] > 0


def test_orders_trend(app_client) -> None:
    rows = app_client.get("/api/v1/trends/orders").json()
    assert 0 < len(rows) <= 365
    assert {"day", "orders", "gmv", "cancelled"} <= set(rows[0])


def test_stores_and_metrics(app_client) -> None:
    stores = app_client.get("/api/v1/stores").json()
    assert stores and "store_id" in stores[0]
    store_id = stores[0]["store_id"]
    metrics = app_client.get(f"/api/v1/stores/{store_id}/metrics").json()
    assert metrics["store_id"] == store_id
    assert metrics["comparison"]["store_id"] == store_id
    assert isinstance(metrics["hourly_sample"], list)
    unknown = app_client.get("/api/v1/stores/999999/metrics").json()
    assert unknown["comparison"] is None and unknown["hourly_sample"] == []


def test_inventory_risks_and_filter(app_client) -> None:
    rows = app_client.get("/api/v1/inventory/risks").json()
    assert isinstance(rows, list)
    if rows:
        store_id = rows[0]["store_id"]
        filtered = app_client.get("/api/v1/inventory/risks", params={"store_id": store_id}).json()
        assert filtered and all(r["store_id"] == store_id for r in filtered)


def test_order_lookup_and_404(app_client, spark_session, pipeline_run) -> None:
    orders = spark_session.read.format("delta").load(
        str(pipeline_run["root"] / "silver" / "silver_orders")
    )
    order_id = orders.select("order_id").first()["order_id"]
    body = app_client.get(f"/api/v1/orders/{order_id}").json()
    assert body["order"]["order_id"] == order_id
    assert "delivery" in body
    assert app_client.get("/api/v1/orders/999999999").status_code == 404


def test_anomalies_empty_with_warning_header(app_client) -> None:
    resp = app_client.get("/api/v1/anomalies")
    assert resp.status_code == 200
    assert resp.json() == []
    assert "gold_anomalies" in resp.headers["X-Data-Warning"]


def test_predictions_absent(app_client, spark_session, pipeline_run) -> None:
    orders = spark_session.read.format("delta").load(
        str(pipeline_run["root"] / "silver" / "silver_orders")
    )
    order_id = orders.select("order_id").first()["order_id"]
    assert app_client.get(f"/api/v1/predictions/delivery/{order_id}").status_code == 404
    resp = app_client.get("/api/v1/predictions/demand")
    assert resp.status_code == 200 and resp.json() == []
    assert "gold_demand_forecasts" in resp.headers["X-Data-Warning"]


# --- proposal lifecycle (kit/07 Phase 14 gates) -----------------------------------------


def test_create_proposal_valid(app_client, next_scope) -> None:
    scope = next_scope()
    resp = app_client.post("/api/v1/proposals", json=_payload(scope, 25))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["validation_status"] == "VALID"
    assert body["status"] == "PENDING"
    assert body["entity_scope"]["quantity"] == 25
    assert body["evidence"] == ["gold_inventory_health: stock_cover_hours below threshold"]
    assert body["source_request_id"] == "req-phase14-test"


def test_create_rejects_bad_quantities(app_client, next_scope) -> None:
    scope = next_scope()  # rejections store nothing, so one scope serves all three
    for qty in (0, -3, 501):
        resp = app_client.post("/api/v1/proposals", json=_payload(scope, qty))
        assert resp.status_code == 400, qty
        assert "quantity" in resp.json()["detail"]


def test_create_rejects_unknown_entities(app_client, next_scope) -> None:
    scope = next_scope()
    payload = _payload(scope, 10)
    payload["entity_scope"]["store_id"] = 999_999
    resp = app_client.post("/api/v1/proposals", json=payload)
    assert resp.status_code == 400 and "store" in resp.json()["detail"]

    scope = next_scope()
    payload = _payload(scope, 10)
    payload["entity_scope"]["product_id"] = 999_999
    resp = app_client.post("/api/v1/proposals", json=payload)
    assert resp.status_code == 400 and "product" in resp.json()["detail"]


def test_create_rejects_missing_scope_keys(app_client, next_scope) -> None:
    scope = next_scope()
    payload = _payload(scope, 10)
    del payload["entity_scope"]["quantity"]
    assert app_client.post("/api/v1/proposals", json=payload).status_code == 400


def test_schema_violations_are_422(app_client, next_scope) -> None:
    payload = _payload(next_scope(), 10)
    payload["proposal_type"] = "DELETE_EVERYTHING"
    assert app_client.post("/api/v1/proposals", json=payload).status_code == 422
    payload = _payload(next_scope(), 10)
    del payload["reason"]
    assert app_client.post("/api/v1/proposals", json=payload).status_code == 422


def test_duplicate_open_proposal_rejected(app_client, next_scope) -> None:
    scope = next_scope()
    first = app_client.post("/api/v1/proposals", json=_payload(scope, 10))
    assert first.status_code == 201
    second = app_client.post("/api/v1/proposals", json=_payload(scope, 12))
    assert second.status_code == 400
    assert "open" in second.json()["detail"]


def test_approve_executes_and_audits(app_client, next_scope) -> None:
    scope = next_scope()
    before = _get_inventory_qty(scope)
    created = app_client.post("/api/v1/proposals", json=_payload(scope, 25)).json()
    pid = created["proposal_id"]

    approved = app_client.post(f"/api/v1/proposals/{pid}/approve", json={"approver": "ops.lead"})
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "EXECUTED"
    assert body["approved_by"] == "ops.lead"
    assert body["approved_at"] and body["executed_at"]
    assert _get_inventory_qty(scope) == before + 25

    from quickcart.db.connection import connect_dict

    with connect_dict() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM inventory_movements WHERE reference_type = 'AUTO_PROPOSAL'"
            " AND reference_id = %s",
            (str(pid),),
        )
        movement = cur.fetchone()
    assert movement is not None, "executor must write the RECEIPT movement"
    assert movement["movement_type"] == "RECEIPT"
    assert movement["quantity_delta"] == 25
    assert movement["store_id"] == scope["store_id"]
    assert movement["product_id"] == scope["product_id"]

    audit = app_client.get(f"/api/v1/proposals/{pid}/audit").json()
    transitions = [(a["from_status"], a["to_status"]) for a in audit]
    assert (None, "PENDING") in transitions
    assert ("PENDING", "APPROVED") in transitions
    assert ("APPROVED", "EXECUTED") in transitions
    correlation_ids = {a["correlation_id"] for a in audit}
    assert len(correlation_ids) == 1, "one correlation id threads the whole lifecycle"
    actors = {a["actor"] for a in audit}
    assert "ops.lead" in actors and "executor:proposal_service" in actors


def test_double_approve_conflicts(app_client, next_scope) -> None:
    scope = next_scope()
    created = app_client.post("/api/v1/proposals", json=_payload(scope, 5)).json()
    pid = created["proposal_id"]
    first = app_client.post(f"/api/v1/proposals/{pid}/approve", json={"approver": "a"})
    assert first.status_code == 200
    resp = app_client.post(f"/api/v1/proposals/{pid}/approve", json={"approver": "a"})
    assert resp.status_code == 409


def test_reject_leaves_non_executed(app_client, next_scope) -> None:
    scope = next_scope()
    before = _get_inventory_qty(scope)
    created = app_client.post("/api/v1/proposals", json=_payload(scope, 10)).json()
    pid = created["proposal_id"]
    resp = app_client.post(
        f"/api/v1/proposals/{pid}/reject",
        json={"approver": "ops.manager", "reason": "supplier lead time too long"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "REJECTED"
    assert body["approved_by"] == "ops.manager"
    assert body["executed_at"] is None
    assert _get_inventory_qty(scope) == before, "rejected proposal must never execute"
    audit = app_client.get(f"/api/v1/proposals/{pid}/audit").json()
    assert ("PENDING", "REJECTED") in [(a["from_status"], a["to_status"]) for a in audit]
    assert audit[-1]["detail"] == "supplier lead time too long"


def test_revalidation_at_approve_marks_invalid(app_client, next_scope) -> None:
    """kit/03 §14.3: validation runs AGAIN at approve time against the DB."""
    scope = next_scope()
    created = app_client.post("/api/v1/proposals", json=_payload(scope, 7)).json()
    pid = created["proposal_id"]
    stale = datetime(2026, 9, 20, tzinfo=UTC)  # > 48h before "now"
    _set_inventory_freshness(scope, stale)
    try:
        resp = app_client.post(f"/api/v1/proposals/{pid}/approve", json={"approver": "ops.lead"})
        assert resp.status_code == 409
        assert "stale" in resp.json()["detail"]
        row = app_client.get(f"/api/v1/proposals/{pid}").json()
        assert row["validation_status"] == "INVALID"
        assert row["status"] == "PENDING", "unapproved proposal cannot execute"
    finally:
        _set_inventory_freshness(scope, datetime.now(UTC))


def test_execution_failure_marks_failed(app_client, next_scope) -> None:
    """Executor error surfaces as status FAILED with an audit row — never silent."""
    from quickcart.db.connection import connect

    scope = next_scope()
    created = app_client.post("/api/v1/proposals", json=_payload(scope, 4)).json()
    pid = created["proposal_id"]
    before = _get_inventory_qty(scope)
    with connect() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "CREATE OR REPLACE FUNCTION reject_auto_proposal() RETURNS trigger AS $$"
            " BEGIN RAISE EXCEPTION 'injected executor failure'; END;"
            " $$ LANGUAGE plpgsql"
        )
        cur.execute(
            "CREATE TRIGGER inject_executor_failure BEFORE INSERT ON inventory_movements"
            " FOR EACH ROW WHEN (NEW.reference_type = 'AUTO_PROPOSAL')"
            " EXECUTE FUNCTION reject_auto_proposal()"
        )
    try:
        resp = app_client.post(f"/api/v1/proposals/{pid}/approve", json={"approver": "ops.lead"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "FAILED"
        assert _get_inventory_qty(scope) == before
        audit = app_client.get(f"/api/v1/proposals/{pid}/audit").json()
        assert ("APPROVED", "FAILED") in [(a["from_status"], a["to_status"]) for a in audit]
        assert "injected executor failure" in audit[-1]["detail"]
    finally:
        with connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("DROP TRIGGER IF EXISTS inject_executor_failure ON inventory_movements")
            cur.execute("DROP FUNCTION IF EXISTS reject_auto_proposal()")


def test_list_filter_and_unknown_id(app_client) -> None:
    executed = app_client.get("/api/v1/proposals", params={"status": "EXECUTED"}).json()
    assert executed and all(p["status"] == "EXECUTED" for p in executed)
    rejected = app_client.get("/api/v1/proposals", params={"status": "REJECTED"}).json()
    assert rejected and all(p["status"] == "REJECTED" for p in rejected)
    assert app_client.get("/api/v1/proposals/999999").status_code == 404
    assert app_client.get("/api/v1/proposals/999999/audit").status_code == 404


def test_agent_chat_503_when_unavailable(app_client, monkeypatch) -> None:
    from quickcart.api import app as app_module

    monkeypatch.setattr(app_module, "_get_agent_service", lambda: None)
    resp = app_client.post("/api/v1/agent/chat", json={"message": "why is store 1 unhealthy?"})
    assert resp.status_code == 503
    assert resp.json() == {"detail": "agent not available"}


def test_agent_chat_delegates_when_available(app_client, monkeypatch) -> None:
    """If the Phase 13 service exists, the same route must delegate to it."""
    from quickcart.api import app as app_module

    service = app_module._get_agent_service()
    if service is None:
        pytest.skip("quickcart.agents.service not importable yet (Phase 13 pending)")
    resp = app_client.post("/api/v1/agent/chat", json={"message": "hello"})
    assert resp.status_code == 200
    assert "answer" in resp.json()


# --- approval UI page (Streamlit) --------------------------------------------------------


def test_approvals_page_renders_with_fake_streamlit(spark_session, pipeline_run) -> None:
    from quickcart.dashboard_pages import render_page
    from quickcart.lakehouse.readers import GoldReaders

    class FakeSt:
        @staticmethod
        def subheader(*a, **k):
            return None

        @staticmethod
        def dataframe(*a, **k):
            return None

        @staticmethod
        def info(*a, **k):
            return None

        @staticmethod
        def warning(*a, **k):
            return None

        @staticmethod
        def selectbox(label, options, **k):
            return options[0]

        caption = staticmethod(lambda *a, **k: None)

    readers = GoldReaders(spark_session, pipeline_run["root"])
    render_page("Approvals", readers, FakeSt())
