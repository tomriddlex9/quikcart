"""HS256 access tokens carried in the ``qc_session`` cookie.

Claims: ``sub`` (user id), ``sid`` (server-side session id), ``persona`` (primary
role), ``onb`` (1 when onboarding is complete, else 0), ``iat`` and ``exp``.
The frontend middleware verifies the same token with ``jose`` using the shared
secret, so the claim names are a cross-language contract.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from quickcart.config.settings import get_settings

ALGORITHM = "HS256"


class TokenError(Exception):
    """The token is missing, malformed, tampered with, or expired."""


@dataclass(frozen=True)
class TokenClaims:
    user_id: int
    sid: str
    persona: str
    onboarding_done: bool
    expires_at: datetime


def create_access_token(
    *,
    user_id: int,
    sid: str,
    persona: str,
    onboarding_done: bool,
    secret: str | None = None,
    ttl_hours: float | None = None,
    now: datetime | None = None,
) -> str:
    settings = get_settings()
    issued = now or datetime.now(UTC)
    ttl = timedelta(hours=settings.auth_token_ttl_hours if ttl_hours is None else ttl_hours)
    payload = {
        "sub": str(user_id),
        "sid": sid,
        "persona": persona,
        "onb": 1 if onboarding_done else 0,
        "iat": int(issued.timestamp()),
        "exp": int((issued + ttl).timestamp()),
    }
    return jwt.encode(payload, secret or settings.auth_secret, algorithm=ALGORITHM)


def decode_access_token(token: str, *, secret: str | None = None) -> TokenClaims:
    """Verify signature + expiry and return typed claims; raise TokenError otherwise."""
    try:
        payload = jwt.decode(
            token,
            secret or get_settings().auth_secret,
            algorithms=[ALGORITHM],
            options={"require": ["sub", "sid", "exp"]},
        )
        return TokenClaims(
            user_id=int(payload["sub"]),
            sid=str(payload["sid"]),
            persona=str(payload.get("persona", "")),
            onboarding_done=bool(payload.get("onb", 0)),
            expires_at=datetime.fromtimestamp(int(payload["exp"]), UTC),
        )
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise TokenError(str(exc)) from exc
