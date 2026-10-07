"""The role→permission matrix, and parity with the V007 migration seed."""

import re
from pathlib import Path

import pytest

from quickcart.identity.catalog import (
    APPROVE_PERMISSIONS,
    PERMISSIONS,
    ROLE_PERMISSIONS,
    ROLES,
    experience_for,
)

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "infrastructure/postgres/migrations/V007__identity.sql"
)
BUSINESS_ROLES = [r for r, (_, exp) in ROLES.items() if exp == "business"]


def test_expected_roles_and_permission_count() -> None:
    assert set(ROLES) == {
        "business_exec", "city_manager", "store_manager", "category_manager",
        "leadership", "ops_manager", "inventory_manager", "admin",
    }
    assert len(PERMISSIONS) == 21
    for perms in ROLE_PERMISSIONS.values():
        assert perms <= set(PERMISSIONS)


@pytest.mark.parametrize("role", BUSINESS_ROLES)
def test_business_roles_never_get_sql(role: str) -> None:
    assert not ROLE_PERMISSIONS[role] & {"sql:execute", "copilot:sql_tool"}


def test_store_manager_cannot_execute_sql() -> None:
    assert "sql:execute" not in ROLE_PERMISSIONS["store_manager"]


def test_admin_administers_but_cannot_approve() -> None:
    admin = ROLE_PERMISSIONS["admin"]
    assert {"user:manage", "audit:read", "system:read"} <= admin
    assert not admin & set(APPROVE_PERMISSIONS)
    assert "proposal:approve:restock" not in admin


def test_each_approval_has_the_right_owner() -> None:
    holders = {
        perm: {r for r, perms in ROLE_PERMISSIONS.items() if perm in perms}
        for perm in APPROVE_PERMISSIONS
    }
    assert holders["proposal:approve:restock"] == {"inventory_manager"}
    assert holders["proposal:approve:ops"] == {"ops_manager"}
    assert holders["proposal:approve:escalated"] == {"leadership"}
    assert "target:write" in ROLE_PERMISSIONS["leadership"]


def test_experience_lookup() -> None:
    assert experience_for("store_manager") == "business"
    assert experience_for("admin") == "ops"


def test_migration_seed_matches_catalog() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    roles_block = re.search(r"INSERT INTO roles .*?VALUES(.*?);", sql, re.S).group(1)
    role_rows = re.findall(r"\('([a-z_]+)', '([^']*)', '(business|ops)'\)", roles_block)
    roles = {key: exp for key, _label, exp in role_rows}
    assert roles == {k: exp for k, (_, exp) in ROLES.items()}

    perms_block = re.search(r"INSERT INTO permissions .*?VALUES(.*?);", sql, re.S).group(1)
    assert set(re.findall(r"\('([a-z:_]+)',", perms_block)) == set(PERMISSIONS)

    rp_block = re.search(r"INSERT INTO role_permissions .*?VALUES(.*?);", sql, re.S).group(1)
    pairs = set(re.findall(r"\('([a-z_]+)', '([a-z:_]+)'\)", rp_block))
    expected = {(r, p) for r, perms in ROLE_PERMISSIONS.items() for p in perms}
    assert pairs == expected
