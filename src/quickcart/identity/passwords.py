"""Password hashing (argon2id via argon2-cffi). Pure functions, no I/O."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_HASHER = PasswordHasher()


def hash_password(password: str) -> str:
    """Return a salted argon2id hash for ``password``."""
    if not password:
        raise ValueError("password must not be empty")
    return _HASHER.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """True iff ``password`` matches ``password_hash``. Malformed hashes never match."""
    try:
        return _HASHER.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the stored hash uses weaker parameters than the current policy."""
    return _HASHER.check_needs_rehash(password_hash)
