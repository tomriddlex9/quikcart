"""`uv run python -m quickcart.db.reset` — drop and recreate the application schema.

Destructive: drops every business table. Migrations are re-applied so the
database returns to an empty, schema-only state. Used for disposable test
databases and deterministic re-seeding (kit/05 §7).
"""

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.db.migrations import apply_migrations
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)


def reset_schema() -> None:
    with connect() as conn:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("DROP SCHEMA public CASCADE")
            cur.execute("CREATE SCHEMA public")
            cur.execute("GRANT USAGE ON SCHEMA public TO public")
        applied = apply_migrations(conn)
        conn.commit()
    log.info("schema.reset", migrations_reapplied=applied)


def main() -> int:
    configure_logging(get_settings().log_level)
    reset_schema()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
