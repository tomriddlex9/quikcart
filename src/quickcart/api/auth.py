"""Auth router: login/logout/me/preferences and the demo persona picker.

The session is an httpOnly ``qc_session`` cookie holding a JWT whose ``sid`` is
looked up in ``auth_sessions`` on every request (so logout revokes immediately).
"""

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from quickcart.api.deps import (
    SESSION_COOKIE,
    CurrentPrincipal,
    identity_service,
    is_synthetic,
    store_errors,
)
from quickcart.identity import seed as seed_module
from quickcart.identity.catalog import APPROVE_PERMISSIONS, ROLE_PERMISSIONS, ROLES
from quickcart.identity.models import AuthResult, PreferencesPatch, Principal
from quickcart.identity.service import AuthenticationError, IdentityService
from quickcart.identity.tokens import TokenError, decode_access_token

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    # Plain str (not EmailStr): `.local` demo domains and legacy aliases must pass.
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class DemoLoginRequest(BaseModel):
    persona: str = Field(min_length=1, max_length=64)


def _me(service: IdentityService, principal: Principal) -> dict[str, Any]:
    body = principal.public()
    body["anonymous"] = is_synthetic(principal)
    body["preferences"] = (
        None
        if is_synthetic(principal)
        else service.get_preferences(principal.user_id).model_dump(mode="json")
    )
    return body


def _secure(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "")
    return request.url.scheme == "https" or forwarded == "https"


def _set_session_cookie(
    response: Response, request: Request, service: IdentityService, result: AuthResult
) -> None:
    max_age = max(int((result.expires_at - datetime.now(UTC)).total_seconds()), 0)
    response.set_cookie(
        SESSION_COOKIE,
        service.issue_token(result),
        max_age=max_age,
        httponly=True,
        secure=_secure(request),
        samesite="lax",
        path="/",
    )


def _login_response(
    response: Response, request: Request, service: IdentityService, result: AuthResult
) -> dict[str, Any]:
    _set_session_cookie(response, request, service, result)
    return _me(service, result.principal)


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    service = identity_service(request)
    with store_errors():
        try:
            result = service.authenticate(
                body.email, body.password, user_agent=request.headers.get("user-agent")
            )
        except AuthenticationError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return _login_response(response, request, service, result)


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(SESSION_COOKIE)
    service = identity_service(request)
    revoked = False
    if token:
        try:
            claims = decode_access_token(token, secret=service.settings.auth_secret)
        except TokenError:
            log.info("auth.logout_with_invalid_token")
        else:
            with store_errors():
                revoked = service.revoke_session(claims.sid, actor_user_id=claims.user_id)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
    return {"ok": True, "revoked": revoked}


@router.get("/me")
def me(request: Request, principal: CurrentPrincipal) -> dict[str, Any]:
    with store_errors():
        return _me(identity_service(request), principal)


@router.patch("/me/preferences")
def patch_preferences(
    patch: PreferencesPatch, request: Request, principal: CurrentPrincipal
) -> dict[str, Any]:
    if is_synthetic(principal):
        raise HTTPException(status_code=401, detail="sign in to save preferences")
    with store_errors():
        try:
            updated = identity_service(request).update_preferences(principal.user_id, patch)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return updated.model_dump(mode="json")


@router.get("/demo-personas")
def demo_personas(request: Request) -> list[dict[str, Any]]:
    """Personas offered by the login screen's demo picker (empty when disabled)."""
    settings = identity_service(request).settings
    if not settings.demo_login_enabled:
        return []
    return [
        {
            "persona": demo.role,
            "label": ROLES[demo.role][0],
            "experience": ROLES[demo.role][1],
            "display_name": demo.display_name,
            "blurb": demo.blurb,
            "can_approve": (
                not settings.public_demo
                and bool(ROLE_PERMISSIONS[demo.role].intersection(APPROVE_PERMISSIONS))
            ),
        }
        for demo in seed_module.DEMO_USERS
    ]


@router.post("/demo-login")
def demo_login(body: DemoLoginRequest, request: Request, response: Response) -> dict[str, Any]:
    """Passwordless session for a demo persona. With ``public_demo`` set, the
    resulting principal has every ``proposal:approve:*`` permission removed."""
    service = identity_service(request)
    with store_errors():
        try:
            result = service.demo_login(
                body.persona, user_agent=request.headers.get("user-agent")
            )
        except AuthenticationError as exc:
            status = 403 if not service.settings.demo_login_enabled else 404
            raise HTTPException(status_code=status, detail=str(exc)) from exc
        return _login_response(response, request, service, result)
