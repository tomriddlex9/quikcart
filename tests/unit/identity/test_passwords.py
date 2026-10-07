import pytest

from quickcart.identity.passwords import hash_password, needs_rehash, verify_password


def test_hash_verify_roundtrip() -> None:
    hashed = hash_password("s3cret-pass")
    assert hashed.startswith("$argon2")
    assert verify_password("s3cret-pass", hashed)
    assert not verify_password("wrong", hashed)


def test_hashes_are_salted() -> None:
    assert hash_password("same") != hash_password("same")


def test_malformed_hash_never_matches() -> None:
    assert not verify_password("anything", "not-a-hash")
    assert not verify_password("anything", "")


def test_empty_password_rejected() -> None:
    with pytest.raises(ValueError):
        hash_password("")


def test_fresh_hash_does_not_need_rehash() -> None:
    assert not needs_rehash(hash_password("x"))
