"""FastAPI auth dependencies (Phase B1).

``get_principal`` resolves the ``qc_session`` cookie (JWT → live server-side
session → Principal). ``require_permission`` builds on it:

* ``auth_enforce`` False (default) and no valid cookie → a *synthetic admin*
  Principal (all permissions, company scope) so the pre-auth console and tests
  keep working unchanged.
* ``auth_enforce`` True → 401 without a valid session, 403 without the permission.
* A real (cookie) principal is always permission-checked, enforced or not.
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Annotated

import psycopg
import structlog
from fastapi import Depends, HTTPException, Request

from quickcart.identity.catalog import PERMISSIONS
from quickcart.identity.models import COMPANY_SCOPE_VALUE, Principal, Scope
from quickcart.identity.rbac import has_permission
from quickcart.identity.service import IdentityService, default_service
from quickcart.identity.tokens import TokenError, decode_access_token

log = structlog.get_logger(__name__)

SESSION_COOKIE = "qc_session"

SYNTHETIC_ADMIN = Principal(
    user_id=0,
    email="anonymous@quickcart.local",
    display_name="Local admin (auth not enforced)",
    roles=["admin"],
    permissions=frozenset(PERMISSIONS),
    scopes=[Scope(scope_type="company", scope_value=COMPANY_SCOPE_VALUE)],
    onboarding_done=True,
)


def is_synthetic(principal: Principal) -> bool:
    return principal.user_id == 0


def identity_service(request: Request) -> IdentityService:
    """The app's identity service (injected in tests, PostgreSQL-backed otherwise)."""
    return getattr(request.app.state, "identity_service", None) or default_service()


@contextmanager
def store_errors() -> Iterator[None]:
    """Map identity-store (PostgreSQL) failures to a visible 503."""
    try:
        yield
    except psycopg.Error as exc:
        log.error("identity.store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="identity store unavailable") from exc


def get_principal(request: Request) -> Principal | None:
    """Principal for the request's session cookie, or ``None`` if absent/invalid/revoked."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    service = identity_service(request)
    try:
        claims = decode_access_token(token, secret=service.settings.auth_secret)
    except TokenError as exc:
        log.info("auth.token_rejected", reason=str(exc))
        return None
    principal = service.get_principal_by_sid(claims.sid)
    if principal is None or principal.user_id != claims.user_id:
        return None
    return principal


def resolve_principal(request: Request) -> Principal | None:
    """Real principal, or ``None`` for anonymous callers when auth is not enforced."""
    enforce = identity_service(request).settings.auth_enforce
    try:
        principal = get_principal(request)
    except psycopg.Error as exc:
        log.error("identity.store_unavailable", error=str(exc))
        if enforce:
            raise HTTPException(status_code=503, detail="identity store unavailable") from exc
        return None
    if principal is None and enforce:
        raise HTTPException(status_code=401, detail="authentication required")
    return principal


def require_permission(*perms: str) -> Callable[[Request], Principal]:
    """Dependency factory: caller must hold *all* ``perms`` (none = just authenticated)."""
    unknown = [p for p in perms if p not in PERMISSIONS]
    if unknown:
        raise ValueError(f"unknown permission keys: {unknown}")

    def dependency(request: Request) -> Principal:
        principal = resolve_principal(request)
        if principal is None:
            return SYNTHETIC_ADMIN
        if perms and not has_permission(principal, *perms):
            missing = [p for p in perms if p not in principal.permissions]
            log.warning("auth.permission_denied", user_id=principal.user_id, missing=missing)
            raise HTTPException(status_code=403, detail=f"missing permission: {', '.join(missing)}")
        return principal

    return dependency


OptionalPrincipal = Annotated[Principal | None, Depends(resolve_principal)]
CurrentPrincipal = Annotated[Principal, Depends(require_permission())]
