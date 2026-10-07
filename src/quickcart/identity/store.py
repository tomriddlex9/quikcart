"""Identity persistence: a small Protocol with Postgres and in-memory implementations.

The service depends only on :class:`IdentityStore`, so unit tests run against
:class:`InMemoryIdentityStore` (same permission catalog as the migration seed)
while production uses :class:`PostgresIdentityStore`.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from quickcart.db.connection import connect
from quickcart.identity.catalog import permissions_for_roles
from quickcart.identity.models import Preferences, Scope, SessionRecord, UserRecord

_PREF_COLUMNS = (
    "persona",
    "home_store_id",
    "home_city",
    "briefing_time",
    "timezone",
    "onboarding_state",
    "completed_journeys",
    "voice_enabled",
    "pinned_metrics",
    "density",
)


class IdentityStore(Protocol):
    def get_user_by_email(self, email: str) -> UserRecord | None: ...
    def get_user(self, user_id: int) -> UserRecord | None: ...
    def user_access(self, user_id: int) -> tuple[list[str], frozenset[str], list[Scope]]: ...
    def count_users(self) -> int: ...
    def upsert_user(
        self,
        *,
        email: str,
        display_name: str,
        password_hash: str,
        roles: list[str],
        scopes: list[Scope],
    ) -> int: ...
    def mark_login(self, user_id: int, at: datetime) -> None: ...
    def create_session(self, session: SessionRecord) -> None: ...
    def get_session(self, sid: str) -> SessionRecord | None: ...
    def revoke_session(self, sid: str, at: datetime) -> bool: ...
    def get_preferences(self, user_id: int) -> Preferences | None: ...
    def save_preferences(self, prefs: Preferences) -> None: ...
    def write_audit(
        self,
        *,
        actor_user_id: int | None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        channel: str = "web",
        detail: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> None: ...


class InMemoryIdentityStore:
    """Dict-backed store for tests and DB-less local runs."""

    def __init__(self) -> None:
        self._users: dict[int, UserRecord] = {}
        self._roles: dict[int, list[str]] = {}
        self._scopes: dict[int, list[Scope]] = {}
        self._sessions: dict[str, SessionRecord] = {}
        self._prefs: dict[int, Preferences] = {}
        self.audit_events: list[dict[str, Any]] = []
        self._next_id = 1

    def get_user_by_email(self, email: str) -> UserRecord | None:
        wanted = email.casefold()
        return next((u for u in self._users.values() if u.email.casefold() == wanted), None)

    def get_user(self, user_id: int) -> UserRecord | None:
        return self._users.get(user_id)

    def user_access(self, user_id: int) -> tuple[list[str], frozenset[str], list[Scope]]:
        roles = list(self._roles.get(user_id, []))
        return roles, permissions_for_roles(roles), list(self._scopes.get(user_id, []))

    def count_users(self) -> int:
        return len(self._users)

    def upsert_user(
        self,
        *,
        email: str,
        display_name: str,
        password_hash: str,
        roles: list[str],
        scopes: list[Scope],
    ) -> int:
        existing = self.get_user_by_email(email)
        if existing is None:
            user_id = self._next_id
            self._next_id += 1
            self._users[user_id] = UserRecord(
                user_id=user_id,
                email=email,
                display_name=display_name,
                password_hash=password_hash,
            )
        else:
            user_id = existing.user_id
            self._users[user_id] = existing.model_copy(
                update={"display_name": display_name, "password_hash": password_hash}
            )
        self._roles[user_id] = list(roles)
        self._scopes[user_id] = list(scopes)
        return user_id

    def mark_login(self, user_id: int, at: datetime) -> None:
        self._users[user_id] = self._users[user_id].model_copy(update={"last_login_at": at})

    def create_session(self, session: SessionRecord) -> None:
        self._sessions[session.sid] = session

    def get_session(self, sid: str) -> SessionRecord | None:
        return self._sessions.get(sid)

    def revoke_session(self, sid: str, at: datetime) -> bool:
        session = self._sessions.get(sid)
        if session is None or session.revoked_at is not None:
            return False
        self._sessions[sid] = session.model_copy(update={"revoked_at": at})
        return True

    def get_preferences(self, user_id: int) -> Preferences | None:
        return self._prefs.get(user_id)

    def save_preferences(self, prefs: Preferences) -> None:
        self._prefs[prefs.user_id] = prefs

    def write_audit(
        self,
        *,
        actor_user_id: int | None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        channel: str = "web",
        detail: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> None:
        self.audit_events.append(
            {
                "actor_user_id": actor_user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "channel": channel,
                "detail": detail or {},
                "correlation_id": correlation_id,
                "created_at": datetime.now(UTC),
            }
        )


class PostgresIdentityStore:
    """psycopg-backed store; every call opens a short-lived connection."""

    def __init__(self, connect_factory: Callable[..., psycopg.Connection] | None = None) -> None:
        self._connect = connect_factory or connect

    def get_user_by_email(self, email: str) -> UserRecord | None:
        return self._one(
            "SELECT user_id, email, display_name, password_hash, is_active, last_login_at"
            " FROM app_users WHERE lower(email) = lower(%s)",
            (email,),
            UserRecord,
        )

    def get_user(self, user_id: int) -> UserRecord | None:
        return self._one(
            "SELECT user_id, email, display_name, password_hash, is_active, last_login_at"
            " FROM app_users WHERE user_id = %s",
            (user_id,),
            UserRecord,
        )

    def user_access(self, user_id: int) -> tuple[list[str], frozenset[str], list[Scope]]:
        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT role_key FROM user_roles WHERE user_id = %s ORDER BY role_key",
                (user_id,),
            )
            roles = [row["role_key"] for row in cur.fetchall()]
            cur.execute(
                "SELECT DISTINCT rp.perm_key FROM user_roles ur"
                " JOIN role_permissions rp USING (role_key) WHERE ur.user_id = %s",
                (user_id,),
            )
            perms = frozenset(row["perm_key"] for row in cur.fetchall())
            cur.execute(
                "SELECT scope_type, scope_value FROM user_scopes WHERE user_id = %s"
                " ORDER BY scope_type, scope_value",
                (user_id,),
            )
            scopes = [Scope(**row) for row in cur.fetchall()]
        return roles, perms, scopes

    def count_users(self) -> int:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM app_users")
            row = cur.fetchone()
        return int(row[0]) if row else 0

    def upsert_user(
        self,
        *,
        email: str,
        display_name: str,
        password_hash: str,
        roles: list[str],
        scopes: list[Scope],
    ) -> int:
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "INSERT INTO app_users (email, display_name, password_hash)"
                " VALUES (%s, %s, %s)"
                " ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name,"
                " password_hash = EXCLUDED.password_hash RETURNING user_id",
                (email, display_name, password_hash),
            )
            user_id = int(cur.fetchone()[0])
            cur.execute("DELETE FROM user_roles WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM user_scopes WHERE user_id = %s", (user_id,))
            for role in roles:
                cur.execute(
                    "INSERT INTO user_roles (user_id, role_key) VALUES (%s, %s)", (user_id, role)
                )
            for scope in scopes:
                cur.execute(
                    "INSERT INTO user_scopes (user_id, scope_type, scope_value)"
                    " VALUES (%s, %s, %s)",
                    (user_id, scope.scope_type, scope.scope_value),
                )
        return user_id

    def mark_login(self, user_id: int, at: datetime) -> None:
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("UPDATE app_users SET last_login_at = %s WHERE user_id = %s", (at, user_id))

    def create_session(self, session: SessionRecord) -> None:
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "INSERT INTO auth_sessions (sid, user_id, issued_at, expires_at, user_agent)"
                " VALUES (%s, %s, %s, %s, %s)",
                (
                    session.sid,
                    session.user_id,
                    session.issued_at,
                    session.expires_at,
                    session.user_agent,
                ),
            )

    def get_session(self, sid: str) -> SessionRecord | None:
        try:
            return self._one(
                "SELECT sid::text AS sid, user_id, issued_at, expires_at, revoked_at, user_agent"
                " FROM auth_sessions WHERE sid = %s::uuid",
                (sid,),
                SessionRecord,
            )
        except psycopg.errors.InvalidTextRepresentation:
            return None

    def revoke_session(self, sid: str, at: datetime) -> bool:
        try:
            with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    "UPDATE auth_sessions SET revoked_at = %s"
                    " WHERE sid = %s::uuid AND revoked_at IS NULL",
                    (at, sid),
                )
                return cur.rowcount > 0
        except psycopg.errors.InvalidTextRepresentation:
            return False

    def get_preferences(self, user_id: int) -> Preferences | None:
        return self._one(
            f"SELECT user_id, {', '.join(_PREF_COLUMNS)} FROM user_preferences WHERE user_id = %s",
            (user_id,),
            Preferences,
        )

    def save_preferences(self, prefs: Preferences) -> None:
        values = prefs.model_dump()
        values["onboarding_state"] = Jsonb(values["onboarding_state"])
        columns = ", ".join(_PREF_COLUMNS)
        placeholders = ", ".join(["%s"] * len(_PREF_COLUMNS))
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in _PREF_COLUMNS)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO user_preferences (user_id, {columns}) VALUES (%s, {placeholders})"
                f" ON CONFLICT (user_id) DO UPDATE SET {updates}",
                (prefs.user_id, *(values[c] for c in _PREF_COLUMNS)),
            )

    def write_audit(
        self,
        *,
        actor_user_id: int | None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        channel: str = "web",
        detail: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> None:
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "INSERT INTO audit_log (actor_user_id, action, resource_type, resource_id,"
                " channel, detail, correlation_id) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    actor_user_id,
                    action,
                    resource_type,
                    resource_id,
                    channel,
                    Jsonb(detail or {}),
                    correlation_id,
                ),
            )

    def _one(self, sql: str, params: tuple[Any, ...], model: type[Any]) -> Any:
        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
        return model(**row) if row else None
