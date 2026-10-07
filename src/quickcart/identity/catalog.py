"""Static identity catalog: roles, permission keys, and the role→permission matrix.

This is the single source of truth mirrored by the seed rows in
``infrastructure/postgres/migrations/V007__identity.sql`` (a unit test keeps the
two in sync). Pure data — no I/O.

Hard rules encoded here:

* Business roles never hold ``sql:execute`` or ``copilot:sql_tool``.
* ``admin`` administers users/audit/system but can never approve proposals.
* Each approval permission has exactly one natural owner role.
"""

from typing import Final

BUSINESS: Final = "business"
OPS: Final = "ops"

PERMISSIONS: Final[dict[str, str]] = {
    "kpi:read": "Read headline KPIs and trends",
    "drill:store": "Drill into store-level metrics",
    "drill:order": "Drill into individual orders",
    "copilot:chat": "Chat with the analytics copilot",
    "copilot:voice": "Use the copilot by voice",
    "copilot:sql_tool": "Let the copilot call the bounded read-only SQL tool",
    "proposal:create": "Create action proposals",
    "proposal:approve:restock": "Approve or reject restock proposals",
    "proposal:approve:ops": "Approve or reject incident / ops-notification proposals",
    "proposal:approve:escalated": "Approve or reject escalated proposals",
    "promo:draft": "Draft promotions",
    "promo:publish": "Publish promotions",
    "target:read": "Read targets",
    "target:write": "Set targets",
    "report:export": "Export reports",
    "digest:subscribe": "Subscribe to the daily digest",
    "alert:rule:write": "Create or edit alert rules",
    "sql:execute": "Run read-only SQL in the query console",
    "system:read": "Read pipeline and system status",
    "user:manage": "Manage users and roles",
    "audit:read": "Read the audit log",
}

# role_key -> (label, experience)
ROLES: Final[dict[str, tuple[str, str]]] = {
    "business_exec": ("Business Executive", BUSINESS),
    "city_manager": ("City Manager", BUSINESS),
    "store_manager": ("Store Manager", BUSINESS),
    "category_manager": ("Category Manager", BUSINESS),
    "leadership": ("Leadership", BUSINESS),
    "ops_manager": ("Operations Manager", OPS),
    "inventory_manager": ("Inventory Manager", OPS),
    "admin": ("Administrator", OPS),
}

_BUSINESS_BASE = (
    "kpi:read",
    "drill:store",
    "drill:order",
    "copilot:chat",
    "copilot:voice",
    "proposal:create",
    "target:read",
    "digest:subscribe",
)

ROLE_PERMISSIONS: Final[dict[str, frozenset[str]]] = {
    "business_exec": frozenset(
        (*_BUSINESS_BASE, "promo:draft", "report:export", "alert:rule:write")
    ),
    "city_manager": frozenset((*_BUSINESS_BASE, "promo:draft", "report:export")),
    "store_manager": frozenset(_BUSINESS_BASE),
    "category_manager": frozenset(
        (*_BUSINESS_BASE, "promo:draft", "promo:publish", "report:export")
    ),
    "leadership": frozenset(
        (
            "kpi:read",
            "drill:store",
            "copilot:chat",
            "copilot:voice",
            "proposal:approve:escalated",
            "target:read",
            "target:write",
            "report:export",
            "digest:subscribe",
            "alert:rule:write",
        )
    ),
    "ops_manager": frozenset(
        (
            "kpi:read",
            "drill:store",
            "drill:order",
            "copilot:chat",
            "copilot:sql_tool",
            "proposal:create",
            "proposal:approve:ops",
            "sql:execute",
            "system:read",
            "alert:rule:write",
        )
    ),
    "inventory_manager": frozenset(
        (
            "kpi:read",
            "drill:store",
            "drill:order",
            "copilot:chat",
            "copilot:sql_tool",
            "proposal:create",
            "proposal:approve:restock",
            "sql:execute",
            "system:read",
        )
    ),
    "admin": frozenset(
        (
            "kpi:read",
            "drill:store",
            "drill:order",
            "copilot:chat",
            "copilot:sql_tool",
            "proposal:create",
            "target:read",
            "sql:execute",
            "system:read",
            "user:manage",
            "audit:read",
        )
    ),
}

APPROVE_PERMISSIONS: Final = (
    "proposal:approve:restock",
    "proposal:approve:ops",
    "proposal:approve:escalated",
)

# Proposal type → the approval permission that owns it (escalated also accepted).
PROPOSAL_APPROVE_PERMISSION: Final[dict[str, str]] = {
    "RESTOCK": "proposal:approve:restock",
    "INCIDENT": "proposal:approve:ops",
    "OPS_NOTIFICATION": "proposal:approve:ops",
}


def experience_for(role_key: str) -> str:
    """Experience (business|ops) for a role; unknown roles raise KeyError."""
    return ROLES[role_key][1]


def permissions_for_roles(roles: list[str] | tuple[str, ...]) -> frozenset[str]:
    """Union of permissions granted by the given roles (unknown roles grant nothing)."""
    granted: set[str] = set()
    for role in roles:
        granted |= ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(granted)
