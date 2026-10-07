import pytest

from quickcart.identity.models import Scope
from quickcart.identity.rbac import has_any_permission, has_permission, scope_filter
from tests.unit.identity.factories import make_principal

COMPANY = Scope(scope_type="company", scope_value="*")


def test_has_permission_requires_all() -> None:
    p = make_principal("inventory_manager", COMPANY)
    assert has_permission(p, "kpi:read", "proposal:approve:restock")
    assert not has_permission(p, "kpi:read", "user:manage")
    assert has_any_permission(p, "user:manage", "kpi:read")
    assert has_permission(p)  # vacuously true


def test_company_scope_allows_everything() -> None:
    p = make_principal("business_exec", COMPANY)
    scope_filter(p, store_id=3, city="Delhi", category="Dairy")


def test_no_scopes_denies_everything() -> None:
    with pytest.raises(PermissionError):
        scope_filter(make_principal("store_manager"))


def test_store_scope() -> None:
    p = make_principal("store_manager", Scope(scope_type="store", scope_value="8"))
    scope_filter(p, store_id=8)
    scope_filter(p, store_id=8, category="Dairy")  # category unrestricted
    with pytest.raises(PermissionError):
        scope_filter(p, store_id=9)
    with pytest.raises(PermissionError):
        scope_filter(p, city="Bengaluru")


def test_city_scope_reaches_stores_in_city() -> None:
    p = make_principal("city_manager", Scope(scope_type="city", scope_value="Bengaluru"))
    scope_filter(p, city="bengaluru")
    scope_filter(p, store_id=8, store_city="Bengaluru")
    with pytest.raises(PermissionError):
        scope_filter(p, city="Mumbai")
    with pytest.raises(PermissionError):
        scope_filter(p, store_id=12, store_city="Mumbai")
    with pytest.raises(PermissionError):  # unknown store city fails closed
        scope_filter(p, store_id=8)


def test_category_scope_is_orthogonal_to_geography() -> None:
    p = make_principal("category_manager", Scope(scope_type="category", scope_value="Dairy"))
    scope_filter(p, store_id=42, city="Delhi", category="dairy")
    with pytest.raises(PermissionError):
        scope_filter(p, category="Snacks")


def test_combined_scopes_must_all_hold() -> None:
    p = make_principal(
        "store_manager",
        Scope(scope_type="store", scope_value="8"),
        Scope(scope_type="category", scope_value="Dairy"),
    )
    scope_filter(p, store_id=8, category="Dairy")
    with pytest.raises(PermissionError):
        scope_filter(p, store_id=8, category="Snacks")
    with pytest.raises(PermissionError):
        scope_filter(p, store_id=9, category="Dairy")
