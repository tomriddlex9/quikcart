"""POST /api/v1/assistant/tools/{name}: auth, validation, RBAC, card + scheduling."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.assistant import principal_dependency, register_assistant_routes
from tests.unit.agents.business_fixtures import FakeProposals, make_principal, make_registry

pytestmark = pytest.mark.unit


class _Settings:
    auth_enforce = False


class _Service:
    settings = _Settings()


def _client(enforce: bool = False, principal=None, proposals=None) -> TestClient:
    app = FastAPI()
    app.state.assistant_registry = make_registry(proposals)
    _Settings.auth_enforce = enforce
    app.state.identity_service = _Service()
    register_assistant_routes(app)
    if principal is not None:
        app.dependency_overrides[principal_dependency] = lambda: principal
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_enforce():
    yield
    _Settings.auth_enforce = False


def test_tool_call_returns_model_view_card_and_scheduling() -> None:
    body = _client().post("/api/v1/assistant/tools/get_metric", json={"args": {"metric": "sales"}})
    assert body.status_code == 200
    data = body.json()
    assert data["tool"] == "get_metric" and data["scheduling"] == "WHEN_IDLE"
    assert data["model_view"]["facts"][0]["ref"] == "metric:sales_gmv:all"
    assert data["card"]["type"] == "kpi" and data["card"]["display"] == "₹2.50 L"


def test_proposal_tool_uses_interrupt_scheduling_and_creates_pending_only() -> None:
    proposals = FakeProposals()
    response = _client(proposals=proposals).post(
        "/api/v1/assistant/tools/draft_action",
        json={"args": {"action_type": "INCIDENT", "store_id": 1, "reason": "rider shortage"}},
    )
    data = response.json()
    assert response.status_code == 200 and data["scheduling"] == "INTERRUPT"
    assert data["card"]["type"] == "proposal" and data["card"]["status"] == "PENDING"
    assert len(proposals.created) == 1


def test_validation_unknown_tool_and_permission_errors() -> None:
    client = _client()
    assert client.post("/api/v1/assistant/tools/get_metric", json={"args": {}}).status_code == 422
    assert client.post("/api/v1/assistant/tools/nope", json={"args": {}}).status_code == 404
    leadership = _client(principal=make_principal("leadership"))
    denied = leadership.post(
        "/api/v1/assistant/tools/draft_action",
        json={"args": {"action_type": "INCIDENT", "store_id": 1, "reason": "x"}},
    )
    assert denied.status_code == 403 and "proposal:create" in denied.json()["detail"]
    scoped = _client(principal=make_principal("store_manager", stores=(1,)))
    out_of_scope = scoped.post(
        "/api/v1/assistant/tools/get_metric", json={"args": {"metric": "orders", "store_id": 2}}
    )
    assert out_of_scope.status_code == 403


def test_voice_channel_blocks_sql_tool() -> None:
    client = _client(principal=make_principal("ops_manager"))
    response = client.post(
        "/api/v1/assistant/tools/run_readonly_sql",
        json={"args": {"sql": "SELECT 1 FROM gold_x"}, "channel": "voice"},
    )
    assert response.status_code == 403 and "voice surface" in response.json()["detail"]


def test_auth_is_required_only_when_enforced() -> None:
    assert (
        _client(enforce=False).post("/api/v1/assistant/tools/get_briefing", json={}).status_code
        == 200
    )
    enforced = _client(enforce=True)
    assert enforced.post("/api/v1/assistant/tools/get_briefing", json={}).status_code == 401


def test_tools_listing_is_permission_and_channel_filtered() -> None:
    client = _client(principal=make_principal("business_exec"))
    text = {t["name"] for t in client.get("/api/v1/assistant/tools").json()["tools"]}
    assert "get_metric" in text and "run_readonly_sql" not in text
    voice = client.get("/api/v1/assistant/tools", params={"channel": "voice"}).json()
    assert voice["channel"] == "voice" and "draft_action" in {t["name"] for t in voice["tools"]}
