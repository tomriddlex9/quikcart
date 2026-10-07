"""RBAC over HTTP: cookie sessions, the permission matrix, enforcement modes,
and approve/reject attribution. Runs against the in-memory identity store and a
fake proposal service — no PostgreSQL, no Spark.
"""

from typing import Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from quickcart.api.app import create_app
from quickcart.api.deps import SESSION_COOKIE, require_permission
from quickcart.config.settings import Settings
from quickcart.identity.catalog import PERMISSIONS, ROLE_PERMISSIONS, ROLES
from quickcart.identity.service import IdentityService
from quickcart.identity.store import InMemoryIdentityStore


class FakeProposalService:
    def __init__(self, proposal_type: str = "RESTOCK") -> None:
        self.proposal_type = proposal_type
        self.calls: list[tuple[str, int, str]] = []

    def get(self, proposal_id: int) -> dict[str, Any] | None:
        return {"proposal_id": proposal_id, "proposal_type": self.proposal_type}

    def approve(self, proposal_id: int, approver: str) -> dict[str, Any]:
        self.calls.append(("approve", proposal_id, approver))
        return _proposal_out(proposal_id, "APPROVED", approver)

    def reject(self, proposal_id: int, approver: str, reason: str | None = None) -> dict[str, Any]:
        self.calls.append(("reject", proposal_id, approver))
        return _proposal_out(proposal_id, "REJECTED", approver)


def _proposal_out(proposal_id: int, status: str, approver: str) -> dict[str, Any]:
    return {
        "proposal_id": proposal_id,
        "proposal_type": "RESTOCK",
        "entity_scope": {},
        "recommended_action": "restock",
        "reason": "test",
        "evidence": [],
        "source_request_id": None,
        "validation_status": "VALID",
        "status": status,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "approved_at": None,
        "executed_at": None,
        "approved_by": approver,
    }


def _settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "_env_file": None,
        "auth_secret": "unit-test-secret-unit-test-secret-32b",
        "demo_user_password": "demo-pass",
        "auth_enforce": True,
    }
    base.update(overrides)
    return Settings(**base)


def _build(
    *, proposals: FakeProposalService | None = None, **settings: Any
) -> tuple[FastAPI, IdentityService, FakeProposalService]:
    svc = IdentityService(InMemoryIdentityStore(), _settings(**settings))
    svc.seed_demo_users()
    fake = proposals or FakeProposalService()
    app = create_app(identity_service=svc, proposal_service=fake)  # type: ignore[arg-type]
    for perm in PERMISSIONS:
        app.add_api_route(
            f"/_t/{perm}",
            lambda _p=Depends(require_permission(perm)): {"ok": True},  # noqa: B008
            methods=["GET"],
        )
    return app, svc, fake


def _login(client: TestClient, persona: str) -> None:
    response = client.post("/api/v1/auth/demo-login", json={"persona": persona})
    assert response.status_code == 200, response.text


@pytest.fixture
def enforced() -> tuple[FastAPI, IdentityService, FakeProposalService]:
    return _build()


# --- permission matrix -------------------------------------------------------------


def test_every_role_gets_exactly_its_permissions(enforced) -> None:
    app, _, _ = enforced
    for role in ROLES:
        client = TestClient(app)
        _login(client, role)
        granted = {
            perm for perm in PERMISSIONS if client.get(f"/_t/{perm}").status_code == 200
        }
        assert granted == ROLE_PERMISSIONS[role], role


def test_store_manager_cannot_sql_execute(enforced) -> None:
    app, _, _ = enforced
    client = TestClient(app)
    _login(client, "store_manager")
    assert client.get("/_t/sql:execute").status_code == 403
    assert client.get("/_t/copilot:sql_tool").status_code == 403
    assert client.get("/_t/kpi:read").status_code == 200


def test_admin_cannot_approve_restock(enforced) -> None:
    app, _, fake = enforced
    client = TestClient(app)
    _login(client, "admin")
    assert client.get("/_t/proposal:approve:restock").status_code == 403
    response = client.post("/api/v1/proposals/1/approve", json={"approver": "x"})
    assert response.status_code == 403
    assert fake.calls == []


# --- enforcement modes ---------------------------------------------------------------


def test_enforced_requires_a_valid_session(enforced) -> None:
    app, _, _ = enforced
    client = TestClient(app)
    assert client.get("/_t/kpi:read").status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set(SESSION_COOKIE, "garbage")
    assert client.get("/_t/kpi:read").status_code == 401


def test_not_enforced_anonymous_is_synthetic_admin() -> None:
    app, _, fake = _build(auth_enforce=False)
    client = TestClient(app)
    assert client.get("/_t/sql:execute").status_code == 200
    assert client.get("/_t/proposal:approve:restock").status_code == 200
    me = client.get("/api/v1/auth/me").json()
    assert me["anonymous"] is True and me["persona"] == "admin"
    # legacy approve with body.approver still works for anonymous callers
    response = client.post("/api/v1/proposals/5/approve", json={"approver": "legacy-user"})
    assert response.status_code == 200
    assert fake.calls == [("approve", 5, "legacy-user")]


def test_not_enforced_real_session_is_still_permission_checked() -> None:
    app, _, _ = _build(auth_enforce=False)
    client = TestClient(app)
    _login(client, "store_manager")
    assert client.get("/_t/sql:execute").status_code == 403


# --- auth endpoints --------------------------------------------------------------------


def test_login_me_logout_flow(enforced) -> None:
    app, _, _ = enforced
    client = TestClient(app)
    bad = client.post("/api/v1/auth/login", json={"email": "exec@quickcart.local", "password": "x"})
    assert bad.status_code == 401

    ok = client.post(
        "/api/v1/auth/login", json={"email": "exec@quickcart.local", "password": "demo-pass"}
    )
    assert ok.status_code == 200
    set_cookie = ok.headers["set-cookie"]
    assert SESSION_COOKIE in set_cookie and "HttpOnly" in set_cookie
    assert ok.json()["persona"] == "business_exec"
    assert "password_hash" not in ok.text

    me = client.get("/api/v1/auth/me").json()
    assert me["email"] == "exec@quickcart.local" and me["anonymous"] is False
    assert "sql:execute" not in me["permissions"]

    token = client.cookies.get(SESSION_COOKIE)
    assert client.post("/api/v1/auth/logout").json()["revoked"] is True
    client.cookies.set(SESSION_COOKIE, token)  # replay the old token
    assert client.get("/api/v1/auth/me").status_code == 401  # session revoked server-side


def test_legacy_alias_login(enforced) -> None:
    app, _, _ = enforced
    client = TestClient(app)
    response = client.post(
        "/api/v1/auth/login", json={"email": "tomriddle", "password": "demo-pass"}
    )
    assert response.status_code == 200 and response.json()["email"] == "admin@quickcart.local"


def test_demo_personas_and_demo_login(enforced) -> None:
    app, _, _ = enforced
    client = TestClient(app)
    personas = client.get("/api/v1/auth/demo-personas").json()
    assert {p["persona"] for p in personas} == set(ROLES)
    approvers = {p["persona"] for p in personas if p["can_approve"]}
    assert approvers == {"inventory_manager", "ops_manager", "leadership"}
    assert client.post("/api/v1/auth/demo-login", json={"persona": "nope"}).status_code == 404


def test_demo_login_disabled() -> None:
    app, _, _ = _build(demo_login_enabled=False)
    client = TestClient(app)
    assert client.get("/api/v1/auth/demo-personas").json() == []
    assert client.post("/api/v1/auth/demo-login", json={"persona": "admin"}).status_code == 403


def test_preferences_patch(enforced) -> None:
    app, _, _ = enforced
    client = TestClient(app)
    _login(client, "city_manager")
    response = client.patch(
        "/api/v1/auth/me/preferences",
        json={"voice_enabled": True, "home_city": "Bengaluru", "briefing_time": "07:30:00"},
    )
    assert response.status_code == 200
    assert response.json()["voice_enabled"] is True
    assert client.get("/api/v1/auth/me").json()["preferences"]["home_city"] == "Bengaluru"
    bad = client.patch("/api/v1/auth/me/preferences", json={"persona": "admin"})
    assert bad.status_code == 422
    assert client.patch("/api/v1/auth/me/preferences", json={"nope": 1}).status_code == 422


# --- approve / reject attribution ---------------------------------------------------------


def test_approve_uses_principal_display_name_over_body(enforced) -> None:
    app, _, fake = enforced
    client = TestClient(app)
    _login(client, "inventory_manager")
    response = client.post("/api/v1/proposals/7/approve", json={"approver": "spoofed"})
    assert response.status_code == 200
    assert fake.calls == [("approve", 7, "Ishita Das (Inventory)")]
    assert response.json()["approved_by"] == "Ishita Das (Inventory)"

    rejected = client.post("/api/v1/proposals/8/reject", json={"approver": "spoofed"})
    assert rejected.status_code == 200
    assert fake.calls[-1] == ("reject", 8, "Ishita Das (Inventory)")


def test_approval_permission_must_match_proposal_type() -> None:
    app, _, fake = _build(proposals=FakeProposalService("INCIDENT"))
    client = TestClient(app)
    _login(client, "inventory_manager")  # restock owner, not ops
    assert client.post("/api/v1/proposals/1/approve", json={"approver": "x"}).status_code == 403
    client = TestClient(app)
    _login(client, "ops_manager")
    assert client.post("/api/v1/proposals/1/approve", json={"approver": "x"}).status_code == 200
    assert [c[2] for c in fake.calls] == ["Rohit Shah (Ops)"]


def test_enforced_approve_without_session_is_401(enforced) -> None:
    app, _, fake = enforced
    response = TestClient(app).post("/api/v1/proposals/1/approve", json={"approver": "x"})
    assert response.status_code == 401
    assert fake.calls == []


def test_public_demo_cannot_approve() -> None:
    app, _, fake = _build(public_demo=True)
    client = TestClient(app)
    _login(client, "inventory_manager")
    me = client.get("/api/v1/auth/me").json()
    assert not any(p.startswith("proposal:approve:") for p in me["permissions"])
    assert client.post("/api/v1/proposals/1/approve", json={"approver": "x"}).status_code == 403
    assert fake.calls == []
    personas = client.get("/api/v1/auth/demo-personas").json()
    assert not any(p["can_approve"] for p in personas)
