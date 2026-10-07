from datetime import UTC, datetime, timedelta

import pytest

from quickcart.config.settings import Settings
from quickcart.identity.models import PreferencesPatch
from quickcart.identity.seed import DEMO_USERS
from quickcart.identity.service import AuthenticationError, IdentityService
from quickcart.identity.store import InMemoryIdentityStore


def test_seed_creates_one_user_per_persona(service: IdentityService) -> None:
    assert service.store.count_users() == len(DEMO_USERS) == 8
    assert {u.role for u in DEMO_USERS} == {
        "business_exec", "city_manager", "store_manager", "category_manager",
        "leadership", "ops_manager", "inventory_manager", "admin",
    }
    assert service.seed_if_empty() == 0  # idempotent guard
    service.seed_demo_users()  # re-seed is an upsert, not a duplicate
    assert service.store.count_users() == 8


def test_authenticate_success_opens_session(service: IdentityService) -> None:
    result = service.authenticate("Store8@QuickCart.local", "demo-pass", user_agent="pytest")
    assert result.principal.persona == "store_manager"
    assert [(s.scope_type, s.scope_value) for s in result.principal.scopes] == [("store", "8")]
    assert result.principal.onboarding_done is False  # business users get the welcome tour
    assert service.get_principal_by_sid(result.sid) == result.principal
    assert service.store.get_user(result.principal.user_id).last_login_at is not None


def test_ops_users_skip_onboarding(service: IdentityService) -> None:
    assert service.authenticate("ops@quickcart.local", "demo-pass").principal.onboarding_done


@pytest.mark.parametrize(
    ("email", "password"),
    [("store8@quickcart.local", "nope"), ("ghost@quickcart.local", "demo-pass")],
)
def test_authenticate_rejects_bad_credentials(
    service: IdentityService, email: str, password: str
) -> None:
    with pytest.raises(AuthenticationError):
        service.authenticate(email, password)
    assert service.store.audit_events[-1]["action"] == "auth.login_failed"


def test_legacy_alias_maps_to_admin(service: IdentityService) -> None:
    result = service.authenticate("tomriddle", "demo-pass")
    assert result.principal.email == "admin@quickcart.local"


def test_revoked_and_expired_sessions_are_rejected(
    store: InMemoryIdentityStore, settings: Settings
) -> None:
    now = [datetime(2026, 1, 1, tzinfo=UTC)]
    svc = IdentityService(store, settings, clock=lambda: now[0])
    svc.seed_demo_users()
    first = svc.authenticate("exec@quickcart.local", "demo-pass")
    assert svc.revoke_session(first.sid)
    assert svc.get_principal_by_sid(first.sid) is None
    assert not svc.revoke_session(first.sid)  # already revoked

    second = svc.authenticate("exec@quickcart.local", "demo-pass")
    now[0] += timedelta(hours=settings.auth_token_ttl_hours, seconds=1)
    assert svc.get_principal_by_sid(second.sid) is None
    assert svc.get_principal_by_sid("not-a-session") is None


def test_disabled_user_cannot_login(service: IdentityService) -> None:
    user = service.store.get_user_by_email("exec@quickcart.local")
    service.store._users[user.user_id] = user.model_copy(update={"is_active": False})
    with pytest.raises(AuthenticationError):
        service.authenticate("exec@quickcart.local", "demo-pass")


def test_demo_login_and_public_demo_strips_approvals(
    store: InMemoryIdentityStore, settings: Settings
) -> None:
    svc = IdentityService(store, settings)
    svc.seed_demo_users()
    assert "proposal:approve:restock" in svc.demo_login("inventory_manager").principal.permissions

    public = IdentityService(store, settings.model_copy(update={"public_demo": True}))
    principal = public.demo_login("inventory_manager").principal
    assert "proposal:approve:restock" not in principal.permissions
    assert "kpi:read" in principal.permissions

    off = IdentityService(store, settings.model_copy(update={"demo_login_enabled": False}))
    with pytest.raises(AuthenticationError):
        off.demo_login("admin")
    with pytest.raises(AuthenticationError):
        svc.demo_login("nonexistent")


def test_preferences_patch(service: IdentityService) -> None:
    principal = service.authenticate("store8@quickcart.local", "demo-pass").principal
    updated = service.update_preferences(
        principal.user_id,
        PreferencesPatch(
            voice_enabled=True,
            pinned_metrics=["gmv"],
            home_store_id=8,
            onboarding_state={"completed": True},
        ),
    )
    assert updated.voice_enabled and updated.pinned_metrics == ["gmv"]
    assert updated.timezone == "Asia/Kolkata" and updated.persona == "store_manager"
    assert service.get_preferences(principal.user_id) == updated
    # onboarding flag flows into the principal
    assert service.authenticate("store8@quickcart.local", "demo-pass").principal.onboarding_done

    with pytest.raises(ValueError):
        service.update_preferences(principal.user_id, PreferencesPatch(persona="admin"))
    # explicit null on a non-nullable column is ignored; on a nullable one it clears
    cleared = service.update_preferences(
        principal.user_id, PreferencesPatch(timezone=None, home_store_id=None)
    )
    assert cleared.timezone == "Asia/Kolkata" and cleared.home_store_id is None
