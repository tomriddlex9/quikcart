"""PostgreSQL connection helpers (psycopg 3)."""


import psycopg
from psycopg.rows import dict_row

from quickcart.config.settings import get_settings


def connect(*, autocommit: bool = False) -> psycopg.Connection:
    """Open a connection from Settings. Callers own transaction boundaries."""
    return psycopg.connect(get_settings().database_dsn, autocommit=autocommit)


def connect_dict(*, autocommit: bool = False) -> psycopg.Connection:
    """Connection yielding dict-like rows for reporting/validation queries."""
    return psycopg.connect(get_settings().database_dsn, autocommit=autocommit, row_factory=dict_row)


def is_reachable() -> bool:
    """True if PostgreSQL accepts a connection with current Settings."""
    try:
        with connect(autocommit=True) as conn:
            conn.execute("SELECT 1")
    except psycopg.OperationalError:
        return False
    return True


def fetch_all(conn: psycopg.Connection, sql: str, params: tuple | None = None) -> list[dict]:
    """Run a read query and return all rows as dicts.

    Returns a concrete list (not a lazy iterator) so results stay usable
    after the connection context exits.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()
