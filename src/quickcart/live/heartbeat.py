"""PostgreSQL persistence for live-pipeline stage heartbeats."""

from __future__ import annotations

import json
from contextlib import nullcontext
from typing import Any

from quickcart.db.connection import connect
from quickcart.live.contracts import StageHeartbeat

_UPSERT = """
INSERT INTO pipeline_status (
    stage, last_run_at, rows_in, rows_out, lag_seconds, error, detail, updated_at
) VALUES (
    %s, %s, %s, %s, %s, %s, %s::jsonb, now()
)
ON CONFLICT (stage) DO UPDATE SET
    last_run_at = EXCLUDED.last_run_at,
    rows_in = EXCLUDED.rows_in,
    rows_out = EXCLUDED.rows_out,
    lag_seconds = EXCLUDED.lag_seconds,
    error = EXCLUDED.error,
    detail = EXCLUDED.detail,
    updated_at = now()
"""


def upsert_heartbeat(
    heartbeat: StageHeartbeat,
    *,
    connection: Any | None = None,
) -> None:
    """Insert or replace one stage heartbeat.

    A caller-supplied connection keeps this adapter straightforward to test and
    lets higher-level jobs share transactions when needed.
    """
    connection_context = (
        nullcontext(connection) if connection is not None else connect(autocommit=True)
    )
    with connection_context as active_connection, active_connection.cursor() as cursor:
        cursor.execute(
            _UPSERT,
            (
                heartbeat.stage,
                heartbeat.last_run_at,
                heartbeat.rows_in,
                heartbeat.rows_out,
                heartbeat.lag_seconds,
                heartbeat.error,
                json.dumps(heartbeat.detail, sort_keys=True),
            ),
        )


def write_heartbeat(heartbeat: StageHeartbeat) -> None:
    """Persist a heartbeat using the configured operational database."""
    upsert_heartbeat(heartbeat)
