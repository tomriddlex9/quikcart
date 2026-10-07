"""Test principal factory (no store needed)."""

from quickcart.identity.catalog import permissions_for_roles
from quickcart.identity.models import Principal, Scope


def make_principal(role: str, *scopes: Scope, email: str | None = None) -> Principal:
    return Principal(
        user_id=99,
        email=email or f"{role}@test.local",
        display_name=role,
        roles=[role],
        permissions=permissions_for_roles([role]),
        scopes=list(scopes),
        onboarding_done=True,
    )
