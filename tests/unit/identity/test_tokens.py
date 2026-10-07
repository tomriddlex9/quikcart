from datetime import UTC, datetime, timedelta

import jwt
import pytest

from quickcart.identity.tokens import TokenError, create_access_token, decode_access_token

SECRET = "unit-test-secret-unit-test-secret-32b"


def _token(**overrides) -> str:
    kwargs = dict(user_id=7, sid="sid-1", persona="store_manager", onboarding_done=False)
    kwargs.update(overrides)
    return create_access_token(secret=SECRET, ttl_hours=1, **kwargs)


def test_roundtrip() -> None:
    claims = decode_access_token(_token(), secret=SECRET)
    assert (claims.user_id, claims.sid, claims.persona) == (7, "sid-1", "store_manager")
    assert claims.onboarding_done is False
    assert claims.expires_at > datetime.now(UTC)


def test_claim_names_are_the_frontend_contract() -> None:
    payload = jwt.decode(_token(onboarding_done=True), SECRET, algorithms=["HS256"])
    assert set(payload) == {"sub", "sid", "persona", "onb", "iat", "exp"}
    assert payload["sub"] == "7"
    assert payload["onb"] == 1


def test_wrong_secret_rejected() -> None:
    with pytest.raises(TokenError):
        decode_access_token(_token(), secret="another-secret-another-secret-32by")


def test_expired_rejected() -> None:
    old = datetime.now(UTC) - timedelta(hours=3)
    with pytest.raises(TokenError):
        decode_access_token(_token(now=old), secret=SECRET)


def test_tampered_and_garbage_rejected() -> None:
    token = _token()
    with pytest.raises(TokenError):
        decode_access_token(token[:-2] + "xx", secret=SECRET)
    with pytest.raises(TokenError):
        decode_access_token("garbage", secret=SECRET)


def test_alg_none_rejected() -> None:
    forged = jwt.encode({"sub": "1", "sid": "s", "exp": 9999999999}, key=None, algorithm="none")
    with pytest.raises(TokenError):
        decode_access_token(forged, secret=SECRET)
