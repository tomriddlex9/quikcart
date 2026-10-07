"""Pure RBAC helpers: permission checks and data-scope filtering.

Scope semantics (fail-closed):

* A ``company`` scope grants everything.
* Geography is hierarchical: ``store`` < ``city`` < ``company``. A requested
  store is allowed by a matching ``store`` scope, or by a ``city`` scope equal to
  the store's city (the caller supplies ``store_city``; if it is unknown the
  request is denied). A requested city needs a matching ``city`` scope.
* ``category`` is orthogonal: a requested category needs a matching ``category``
  scope when the principal has any, and is unrestricted otherwise.
* If the principal has no geographic scopes (e.g. a category manager), geography
  is unrestricted; if it has no scopes at all, everything is denied.
"""

from quickcart.identity.models import Principal, Scope


def has_permission(principal: Principal, *perms: str) -> bool:
    """True iff the principal holds *every* listed permission."""
    return all(perm in principal.permissions for perm in perms)


def has_any_permission(principal: Principal, *perms: str) -> bool:
    """True iff the principal holds at least one listed permission."""
    return any(perm in principal.permissions for perm in perms)


def _values(scopes: list[Scope], scope_type: str) -> set[str]:
    return {s.scope_value.casefold() for s in scopes if s.scope_type == scope_type}


def scope_filter(
    principal: Principal,
    *,
    store_id: int | None = None,
    city: str | None = None,
    category: str | None = None,
    store_city: str | None = None,
) -> None:
    """Raise ``PermissionError`` unless every requested dimension is in scope.

    ``store_city`` is the city of ``store_id`` and lets city-scoped principals
    reach stores in their city. Passing no dimensions checks only that the
    principal has some scope.
    """
    scopes = principal.scopes
    if not scopes:
        raise PermissionError(f"{principal.email} has no data scope")
    if any(s.scope_type == "company" for s in scopes):
        return

    stores = _values(scopes, "store")
    cities = _values(scopes, "city")
    categories = _values(scopes, "category")
    geo_restricted = bool(stores or cities)

    if geo_restricted:
        if store_id is not None:
            in_city = store_city is not None and store_city.casefold() in cities
            if str(store_id) not in stores and not in_city:
                raise PermissionError(f"store {store_id} is outside the scope of {principal.email}")
        if city is not None and city.casefold() not in cities:
            raise PermissionError(f"city {city!r} is outside the scope of {principal.email}")

    if categories and category is not None and category.casefold() not in categories:
        raise PermissionError(f"category {category!r} is outside the scope of {principal.email}")
