"""`uv run python -m quickcart.db.init` — apply pending migrations."""

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.db.migrations import apply_migrations, discover_migrations
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)


def main() -> int:
    configure_logging(get_settings().log_level)
    with connect() as conn:
        applied = apply_migrations(conn)
        conn.commit()
    total = len(discover_migrations())
    if applied:
        log.info("migrations.applied", count=len(applied), versions=applied)
    else:
        log.info("migrations.none_pending", total=total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
