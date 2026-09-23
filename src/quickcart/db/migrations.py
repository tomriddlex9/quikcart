"""Ordered, versioned DDL migrations (kit/05 §7: migrations or ordered versioned scripts).

Each `VNNN__description.sql` file under the migrations directory is applied
exactly once, in filename order, inside its own transaction. Applied versions
are recorded in `schema_migrations`.
"""

from pathlib import Path

import psycopg

_SCHEMA_MIGRATIONS_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

REPO_ROOT = Path(__file__).resolve().parents[3]


def migrations_dir() -> Path:
    from quickcart.config.settings import get_settings

    configured = get_settings().migrations_dir
    return configured if configured.is_absolute() else REPO_ROOT / configured


def discover_migrations() -> list[tuple[str, str, Path]]:
    """Return [(version, description, path)] sorted by version."""
    found = []
    for path in sorted(migrations_dir().glob("V*.sql")):
        version = path.stem.split("__", 1)[0]
        description = path.stem.split("__", 1)[1].replace("_", " ") if "__" in path.stem else ""
        found.append((version, description, path))
    return found


def applied_versions(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(_SCHEMA_MIGRATIONS_SQL)
        cur.execute("SELECT version FROM schema_migrations")
        return {row[0] for row in cur.fetchall()}


def apply_migrations(conn: psycopg.Connection) -> list[str]:
    """Apply pending migrations. Returns versions applied in this call."""
    applied_before = applied_versions(conn)
    newly_applied: list[str] = []
    for version, description, path in discover_migrations():
        if version in applied_before or version in newly_applied:
            continue
        sql = path.read_text(encoding="utf-8")
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (%s, %s)",
                (version, description),
            )
        newly_applied.append(version)
    return newly_applied
