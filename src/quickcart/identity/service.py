"""Identity service: login, sessions, principals, preferences, demo seeding.

Sessions are server-side (``auth_sessions``); the JWT in the ``qc_session``
cookie only carries the ``sid`` plus UI hints (persona, onboarding flag), so a
revoked session stops working immediately regardless of token expiry.
"""

import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from uuid import uuid4

import structlog

from quickcart.config.settings import Settings, get_settings
from quickcart.identity import seed as seed_module
from quickcart.identity.models import (
    AuthResult,
    Preferences,
    PreferencesPatch,
    Principal,
    SessionRecord,
    UserRecord,
)
from quickcart.identity.passwords import hash_password, verify_password
from quickcart.identity.store import IdentityStore, PostgresIdentityStore
from quickcart.identity.tokens import create_access_token

log = structlog.get_logger(__name__)

# Preferences columns that cannot be NULL; an explicit null in a patch is ignored.
_NON_NULLABLE_PREFS = frozenset(
    {"timezone", "onboarding_state", "completed_journeys", "voice_enabled", "pinned_metrics"}
)


class AuthenticationError(Exception):
    """Bad credentials, disabled account, or demo login not permitted."""


@lru_cache
def _dummy_hash() -> str:
    """Hash verified when the account is unknown, to keep login timing uniform."""
    return hash_password(secrets.token_urlsafe(16))


def _normalize_login(login: str) -> str:
    cleaned = login.strip().lower()
    return seed_module.LOGIN_ALIASES.get(cleaned, cleaned)


class IdentityService:
    def __init__(
        self,
        store: IdentityStore,
        settings: Settings | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.store = store
        self._settings = settings
        self._clock = clock or (lambda: datetime.now(UTC))

    @property
    def settings(self) -> Settings:
        return self._settings or get_settings()

    # --- login / sessions ----------------------------------------------------------
    def authenticate(
        self, email: str, password: str, *, user_agent: str | None = None
    ) -> AuthResult:
        """Verify credentials and open a session. ``email`` also accepts legacy aliases."""
        login = _normalize_login(email)
        user = self.store.get_user_by_email(login)
        # Always run one argon2 verification so unknown accounts cost the same.
        valid = verify_password(password, user.password_hash if user else _dummy_hash())
        if user is None or not user.is_active or not valid:
            self.audit(
                actor_user_id=user.user_id if user else None,
                action="auth.login_failed",
                detail={"login": login},
            )
            raise AuthenticationError("invalid email or password")
        return self._open_session(user, user_agent=user_agent, action="auth.login")

    def demo_login(self, persona: str, *, user_agent: str | None = None) -> AuthResult:
        """Passwordless session for the demo user of ``persona`` (demo pickers only)."""
        if not self.settings.demo_login_enabled:
            raise AuthenticationError("demo login is disabled")
        demo = seed_module.demo_user_for_persona(persona)
        user = self.store.get_user_by_email(demo.email) if demo else None
        if user is None or not user.is_active:
            raise AuthenticationError(f"unknown demo persona {persona!r}")
        return self._open_session(user, user_agent=user_agent, action="auth.demo_login")

    def issue_token(self, result: AuthResult) -> str:
        """Signed ``qc_session`` JWT for an :class:`AuthResult`."""
        ttl = max((result.expires_at - self._clock()).total_seconds() / 3600, 0.0)
        return create_access_token(
            user_id=result.principal.user_id,
            sid=result.sid,
            persona=result.principal.persona,
            onboarding_done=result.principal.onboarding_done,
            secret=self.settings.auth_secret,
            ttl_hours=ttl,
        )

    def get_principal_by_sid(self, sid: str) -> Principal | None:
        """Principal for a live session; ``None`` if unknown, revoked, or expired."""
        session = self.store.get_session(sid)
        if session is None or session.revoked_at is not None:
            return None
        if session.expires_at <= self._clock():
            return None
        user = self.store.get_user(session.user_id)
        if user is None or not user.is_active:
            return None
        return self._build_principal(user)

    def revoke_session(self, sid: str, *, actor_user_id: int | None = None) -> bool:
        revoked = self.store.revoke_session(sid, self._clock())
        if revoked:
            self.audit(actor_user_id=actor_user_id, action="auth.logout", resource_id=sid)
        return revoked

    # --- seeding --------------------------------------------------------------------
    def seed_demo_users(self, *, password: str | None = None) -> list[str]:
        return seed_module.seed_demo_users(
            self.store, password=self.settings.demo_user_password if password is None else password
        )

    def seed_if_empty(self) -> int:
        """Seed demo users only when no user exists. Returns users created."""
        if self.store.count_users() > 0:
            return 0
        return len(self.seed_demo_users())

    # --- preferences ---------------------------------------------------------------
    def get_preferences(self, user_id: int) -> Preferences:
        return self.store.get_preferences(user_id) or Preferences(user_id=user_id)

    def update_preferences(self, user_id: int, patch: PreferencesPatch) -> Preferences:
        """Apply the explicitly provided fields; ``persona`` must be one of the user's roles."""
        current = self.get_preferences(user_id)
        changes = {
            key: value
            for key, value in patch.model_dump(exclude_unset=True).items()
            if value is not None or key not in _NON_NULLABLE_PREFS
        }
        persona = changes.get("persona")
        if persona is not None:
            roles, _, _ = self.store.user_access(user_id)
            if persona not in roles:
                raise ValueError(f"persona {persona!r} is not assigned to this user")
        updated = current.model_copy(update=changes)
        self.store.save_preferences(updated)
        self.audit(
            actor_user_id=user_id,
            action="preferences.update",
            resource_type="user_preferences",
            resource_id=str(user_id),
            detail={"fields": sorted(changes)},
        )
        return updated

    # --- audit ----------------------------------------------------------------------
    def audit(
        self,
        *,
        actor_user_id: int | None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        channel: str = "web",
        detail: dict[str, object] | None = None,
    ) -> None:
        from quickcart.observability import get_correlation_id

        self.store.write_audit(
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            channel=channel,
            detail=dict(detail or {}),
            correlation_id=get_correlation_id(),
        )

    # --- internals -----------------------------------------------------------------
    def _open_session(self, user: UserRecord, *, user_agent: str | None, action: str) -> AuthResult:
        now = self._clock()
        expires = now + timedelta(hours=self.settings.auth_token_ttl_hours)
        sid = str(uuid4())
        self.store.create_session(
            SessionRecord(
                sid=sid,
                user_id=user.user_id,
                issued_at=now,
                expires_at=expires,
                user_agent=user_agent[:300] if user_agent else None,
            )
        )
        self.store.mark_login(user.user_id, now)
        principal = self._build_principal(user)
        self.audit(actor_user_id=user.user_id, action=action, resource_id=sid)
        log.info("identity.session_opened", user_id=user.user_id, persona=principal.persona)
        return AuthResult(principal=principal, sid=sid, expires_at=expires)

    def _build_principal(self, user: UserRecord) -> Principal:
        roles, permissions, scopes = self.store.user_access(user.user_id)
        prefs = self.store.get_preferences(user.user_id)
        principal = Principal(
            user_id=user.user_id,
            email=user.email,
            display_name=user.display_name,
            roles=roles,
            permissions=permissions,
            scopes=scopes,
            onboarding_done=bool(prefs and prefs.onboarding_state.get("completed")),
        )
        return principal.without_approvals() if self.settings.public_demo else principal


@lru_cache
def default_service() -> IdentityService:
    """Process-wide service over PostgreSQL (connections are opened per call)."""
    return IdentityService(PostgresIdentityStore())


def authenticate(
    email: str,
    password: str,
    *,
    user_agent: str | None = None,
    service: IdentityService | None = None,
) -> AuthResult:
    return (service or default_service()).authenticate(email, password, user_agent=user_agent)


def get_principal_by_sid(sid: str, *, service: IdentityService | None = None) -> Principal | None:
    return (service or default_service()).get_principal_by_sid(sid)


def revoke_session(sid: str, *, service: IdentityService | None = None) -> bool:
    return (service or default_service()).revoke_session(sid)


def seed_demo_users(*, service: IdentityService | None = None) -> list[str]:
    return (service or default_service()).seed_demo_users()


def get_preferences(user_id: int, *, service: IdentityService | None = None) -> Preferences:
    return (service or default_service()).get_preferences(user_id)


def update_preferences(
    user_id: int, patch: PreferencesPatch, *, service: IdentityService | None = None
) -> Preferences:
    return (service or default_service()).update_preferences(user_id, patch)
