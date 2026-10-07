"""Demo users: one per persona, password from ``Settings.demo_user_password``.

Idempotent — re-running re-asserts roles/scopes and resets the demo password.
Run ``uv run python -m quickcart.identity.seed`` after migrating (the API also
seeds on startup when ``app_users`` is empty).

Ops-experience users carry a ``company`` scope: an empty scope list means *no*
access (see :func:`quickcart.identity.rbac.scope_filter`).
"""

from dataclasses import dataclass

import structlog

from quickcart.config.settings import get_settings
from quickcart.identity.catalog import ROLES
from quickcart.identity.models import COMPANY_SCOPE_VALUE, Preferences, Scope
from quickcart.identity.passwords import hash_password
from quickcart.identity.store import IdentityStore, PostgresIdentityStore
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

COMPANY = Scope(scope_type="company", scope_value=COMPANY_SCOPE_VALUE)

# Legacy console login (`tomriddle`) resolves to the admin demo user.
LOGIN_ALIASES: dict[str, str] = {"tomriddle": "admin@quickcart.local"}


@dataclass(frozen=True)
class DemoUser:
    email: str
    display_name: str
    role: str
    scopes: tuple[Scope, ...]
    blurb: str


DEMO_USERS: tuple[DemoUser, ...] = (
    DemoUser("admin@quickcart.local", "Tom Riddle (Admin)", "admin", (COMPANY,),
             "Platform admin — users, audit, system. Cannot approve proposals."),
    DemoUser("exec@quickcart.local", "Asha Rao (Business Exec)", "business_exec", (COMPANY,),
             "Company-wide KPIs, drill-downs and promos."),
    DemoUser("city.blr@quickcart.local", "Karan Mehta (Bengaluru)", "city_manager",
             (Scope(scope_type="city", scope_value="Bengaluru"),),
             "City manager for Bengaluru."),
    DemoUser("store8@quickcart.local", "Priya Nair (Store 8)", "store_manager",
             (Scope(scope_type="store", scope_value="8"),),
             "Runs dark store #8."),
    DemoUser("category.dairy@quickcart.local", "Dev Malhotra (Dairy)", "category_manager",
             (Scope(scope_type="category", scope_value="Dairy"),),
             "Owns the Dairy category and its promos."),
    DemoUser("cxo@quickcart.local", "Meera Kapoor (CXO)", "leadership", (COMPANY,),
             "Sets targets and approves escalations."),
    DemoUser("ops@quickcart.local", "Rohit Shah (Ops)", "ops_manager", (COMPANY,),
             "Operations desk — incidents and read-only SQL."),
    DemoUser("inventory@quickcart.local", "Ishita Das (Inventory)", "inventory_manager",
             (COMPANY,), "Approves restock proposals."),
)


def demo_user_for_persona(persona: str) -> DemoUser | None:
    return next((u for u in DEMO_USERS if u.role == persona), None)


def seed_demo_users(store: IdentityStore, *, password: str | None = None) -> list[str]:
    """Create/refresh the demo users; returns the seeded emails."""
    secret = get_settings().demo_user_password if password is None else password
    password_hash = hash_password(secret)  # one salt per run; fine for demo accounts
    emails: list[str] = []
    for demo in DEMO_USERS:
        if demo.role not in ROLES:
            raise ValueError(f"demo user {demo.email} has unknown role {demo.role!r}")
        user_id = store.upsert_user(
            email=demo.email,
            display_name=demo.display_name,
            password_hash=password_hash,
            roles=[demo.role],
            scopes=list(demo.scopes),
        )
        if store.get_preferences(user_id) is None:
            store.save_preferences(
                Preferences(
                    user_id=user_id,
                    persona=demo.role,
                    # Business users see the welcome tour once; ops land straight in the console.
                    onboarding_state={"completed": ROLES[demo.role][1] == "ops"},
                )
            )
        emails.append(demo.email)
    log.info("identity.demo_users_seeded", count=len(emails))
    return emails


def main() -> int:
    configure_logging(get_settings().log_level)
    seed_demo_users(PostgresIdentityStore())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
