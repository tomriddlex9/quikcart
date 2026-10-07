"""Alert engine (Phase B7): stock risks + stale proposals → ``alerts`` / ``notifications``.

Idempotent on ``alert_key``. Safe when V014 tables are missing.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from psycopg.rows import dict_row

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)


def _table_exists(cur: Any, name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables"
        " WHERE table_schema = 'public' AND table_name = %s",
        (name,),
    )
    return cur.fetchone() is not None


def _upsert_alert(
    cur: Any,
    *,
    alert_key: str,
    kind: str,
    severity: str,
    title: str,
    detail: str,
    metric_key: str | None,
    store_id: int | None,
    suggested_action: str | None = None,
) -> int | None:
    cur.execute(
        "SELECT alert_id, status FROM alerts WHERE alert_key = %s"
        " AND status IN ('OPEN', 'ACKNOWLEDGED')",
        (alert_key,),
    )
    existing = cur.fetchone()
    if existing:
        cur.execute(
            "UPDATE alerts SET last_seen_at = now(), detail = %s, severity = %s"
            " WHERE alert_id = %s",
            (detail, severity, existing["alert_id"]),
        )
        return int(existing["alert_id"])
    cur.execute(
        "INSERT INTO alerts"
        " (alert_key, kind, severity, title, detail, suggested_action,"
        "  metric_key, store_id, evidence)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, '{}'::jsonb)"
        " RETURNING alert_id",
        (
            alert_key,
            kind,
            severity,
            title,
            detail,
            suggested_action,
            metric_key,
            store_id,
        ),
    )
    row = cur.fetchone()
    return int(row["alert_id"]) if row else None


def _notify(cur: Any, alert_id: int, title: str, body: str) -> None:
    if not _table_exists(cur, "notifications"):
        return
    cur.execute(
        "INSERT INTO notifications (user_id, alert_id, channel, title, body, status, sent_at)"
        " SELECT NULL, %s, 'in_app', %s, %s, 'SENT', now()"
        " WHERE NOT EXISTS ("
        "   SELECT 1 FROM notifications n"
        "   WHERE n.alert_id = %s AND n.user_id IS NULL AND n.status IN ('PENDING', 'SENT')"
        " )",
        (alert_id, title, body, alert_id),
    )


def evaluate_and_upsert(conn: Any) -> dict[str, int]:
    """Scan inventory + pending proposals and upsert alerts. Returns counts."""
    created = refreshed = notified = 0
    with conn.cursor(row_factory=dict_row) as cur:
        if not _table_exists(cur, "alerts"):
            log.warning("alerts.skip", reason="alerts table missing")
            return {"created": 0, "refreshed": 0, "notified": 0}

        cur.execute(
            "SELECT i.store_id, s.name AS store_name, i.product_id, p.name AS product_name,"
            " i.on_hand_qty, i.reorder_point"
            " FROM inventory i"
            " JOIN stores s ON s.store_id = i.store_id"
            " JOIN products p ON p.product_id = i.product_id"
            " WHERE i.on_hand_qty <= i.reorder_point"
            " ORDER BY (i.reorder_point - i.on_hand_qty) DESC"
            " LIMIT 50"
        )
        for row in cur.fetchall():
            key = f"stock:{row['store_id']}:{row['product_id']}"
            cur.execute(
                "SELECT alert_id FROM alerts"
                " WHERE alert_key = %s AND status IN ('OPEN','ACKNOWLEDGED')",
                (key,),
            )
            existed = cur.fetchone() is not None
            alert_id = _upsert_alert(
                cur,
                alert_key=key,
                kind="STOCK_RISK",
                severity="bad" if row["on_hand_qty"] <= 0 else "watch",
                title=f"{row['product_name']} running low at {row['store_name']}",
                detail=(
                    f"{row['on_hand_qty']} on hand (refill level {row['reorder_point']})."
                ),
                metric_key="stockout_risk_count",
                store_id=row["store_id"],
                suggested_action="Review a restock suggestion",
            )
            if alert_id is None:
                continue
            if existed:
                refreshed += 1
            else:
                created += 1
                _notify(
                    cur,
                    alert_id,
                    title=f"Stock risk · {row['store_name']}",
                    body=f"{row['product_name']} is at or below refill level.",
                )
                notified += 1

        if _table_exists(cur, "proposals"):
            cutoff = datetime.now(UTC) - timedelta(hours=2)
            cur.execute(
                "SELECT proposal_id, proposal_type, recommended_action, created_at,"
                " (entity_scope->>'store_id')::int AS store_id"
                " FROM proposals"
                " WHERE status = 'PENDING' AND created_at < %s"
                " LIMIT 30",
                (cutoff,),
            )
            for row in cur.fetchall():
                key = f"proposal:{row['proposal_id']}"
                cur.execute(
                    "SELECT alert_id FROM alerts"
                    " WHERE alert_key = %s AND status IN ('OPEN','ACKNOWLEDGED')",
                    (key,),
                )
                existed = cur.fetchone() is not None
                alert_id = _upsert_alert(
                    cur,
                    alert_key=key,
                    kind="OTHER",
                    severity="watch",
                    title="Suggestion waiting for a decision",
                    detail=row["recommended_action"][:240],
                    metric_key=None,
                    store_id=row["store_id"],
                    suggested_action="Open Actions and approve or skip",
                )
                if alert_id is None:
                    continue
                if existed:
                    refreshed += 1
                else:
                    created += 1
                    _notify(
                        cur,
                        alert_id,
                        title="Waiting on you",
                        body=row["recommended_action"][:240],
                    )
                    notified += 1

    conn.commit()
    result = {"created": created, "refreshed": refreshed, "notified": notified}
    log.info("alerts.evaluated", **result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate business alerts")
    parser.parse_args(argv)
    configure_logging(get_settings().log_level)
    with connect() as conn:
        evaluate_and_upsert(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
