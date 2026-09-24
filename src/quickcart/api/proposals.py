"""Proposal service: deterministic validation + human-approved executor.

kit/03 §14.3-14.5. The agent (Phase 13) or an analyst *recommends*; this
service validates deterministically against the operational DB; a human
approves or rejects; only an approved, re-validated RESTOCK proposal executes
the simulated restock — inside one PostgreSQL transaction, never from
client-supplied action payloads. Every status transition is recorded in
``proposal_audit`` with the proposal's correlation id (generated at create).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg
import structlog
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from quickcart.api.models import MAX_RESTOCK_QUANTITY, ProposalCreate
from quickcart.db.connection import connect

log = structlog.get_logger(__name__)

INVENTORY_FRESHNESS = timedelta(hours=48)
OPEN_STATUSES = ("PENDING", "APPROVED")
RESTOCK_SCOPE_KEYS = ("store_id", "product_id", "quantity")


class ProposalError(Exception):
    """Domain failure the routers translate to an HTTP error (4xx, visible)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class RestockFacts:
    """Everything the RESTOCK rules need, gathered from the operational DB.

    Kept separate from ``validate_restock`` so the rule engine stays a pure
    function (unit-testable without a database).
    """

    store_exists: bool
    product_exists: bool
    quantity: int
    inventory_updated_at: datetime | None
    now: datetime
    has_open_duplicate: bool


def validate_restock(facts: RestockFacts) -> list[str]:
    """Deterministic RESTOCK rules (kit/03 §14.3). Empty list means VALID."""
    reasons: list[str] = []
    if not facts.store_exists:
        reasons.append("store does not exist")
    if not facts.product_exists:
        reasons.append("product does not exist")
    if facts.quantity <= 0:
        reasons.append(f"quantity must be positive, got {facts.quantity}")
    if facts.quantity > MAX_RESTOCK_QUANTITY:
        reasons.append(
            f"quantity {facts.quantity} exceeds max restock limit {MAX_RESTOCK_QUANTITY}"
        )
    if facts.inventory_updated_at is None:
        reasons.append("no inventory facts for this store+product")
    elif facts.now - facts.inventory_updated_at > INVENTORY_FRESHNESS:
        reasons.append(
            "inventory facts stale: updated_at "
            f"{facts.inventory_updated_at.isoformat()} older than 48h"
        )
    if facts.has_open_duplicate:
        reasons.append("an open (PENDING/APPROVED) proposal already exists for this scope")
    return reasons


def parse_restock_scope(entity_scope: dict[str, int]) -> tuple[int, int, int]:
    """Extract typed RESTOCK scope keys; 400 on missing/wrongly-typed values."""
    missing = [k for k in RESTOCK_SCOPE_KEYS if k not in entity_scope]
    if missing:
        raise ProposalError(400, f"entity_scope missing keys: {', '.join(missing)}")
    store_id, product_id, quantity = (entity_scope[k] for k in RESTOCK_SCOPE_KEYS)
    for name, value in (("store_id", store_id), ("product_id", product_id)):
        if not isinstance(value, int) or isinstance(value, bool):
            raise ProposalError(400, f"entity_scope.{name} must be an integer, got {value!r}")
    if not isinstance(quantity, int) or isinstance(quantity, bool):
        raise ProposalError(400, f"entity_scope.quantity must be an integer, got {quantity!r}")
    return store_id, product_id, quantity


class ProposalService:
    """DB-backed proposal lifecycle. Owns validation, approval, execution, audit."""

    def __init__(
        self,
        conn_factory: Callable[..., psycopg.Connection] = connect,
        actor: str = "api",
    ) -> None:
        self._connect = conn_factory
        self._actor = actor

    # --- reads -----------------------------------------------------------------
    def get(self, proposal_id: int) -> dict[str, Any] | None:
        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT * FROM proposals WHERE proposal_id = %s", (proposal_id,))
            return cur.fetchone()

    def list_proposals(
        self, status: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM proposals"
        params: tuple[Any, ...] = ()
        if status is not None:
            sql += " WHERE status = %s"
            params = (status,)
        sql += " ORDER BY created_at DESC, proposal_id DESC LIMIT %s"
        params += (limit,)
        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def audit_trail(self, proposal_id: int) -> list[dict[str, Any]]:
        if self.get(proposal_id) is None:
            raise ProposalError(404, f"proposal {proposal_id} not found")
        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM proposal_audit WHERE proposal_id = %s"
                " ORDER BY created_at, audit_id",
                (proposal_id,),
            )
            return cur.fetchall()

    def _correlation_id(self, cur: psycopg.Cursor, proposal_id: int) -> str:
        cur.execute(
            "SELECT correlation_id FROM proposal_audit WHERE proposal_id = %s"
            " ORDER BY audit_id LIMIT 1",
            (proposal_id,),
        )
        row = cur.fetchone()
        return row["correlation_id"] if row else str(uuid4())

    # --- facts + validation ------------------------------------------------------
    def _restock_facts(
        self,
        cur: psycopg.Cursor,
        store_id: int,
        product_id: int,
        quantity: int,
        exclude_proposal_id: int | None = None,
    ) -> RestockFacts:
        cur.execute("SELECT EXISTS(SELECT 1 FROM stores WHERE store_id = %s) AS e", (store_id,))
        store_exists = cur.fetchone()["e"]
        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM products WHERE product_id = %s) AS e", (product_id,)
        )
        product_exists = cur.fetchone()["e"]
        cur.execute(
            "SELECT updated_at FROM inventory WHERE store_id = %s AND product_id = %s",
            (store_id, product_id),
        )
        row = cur.fetchone()
        duplicate_sql = (
            "SELECT EXISTS(SELECT 1 FROM proposals WHERE status IN ('PENDING','APPROVED')"
            " AND entity_scope->>'store_id' = %s AND entity_scope->>'product_id' = %s"
            " AND proposal_type = 'RESTOCK'"
        )
        params: tuple[Any, ...] = (str(store_id), str(product_id))
        if exclude_proposal_id is not None:
            duplicate_sql += " AND proposal_id <> %s"
            params += (exclude_proposal_id,)
        duplicate_sql += ") AS e"
        cur.execute(duplicate_sql, params)
        has_open_duplicate = cur.fetchone()["e"]
        return RestockFacts(
            store_exists=store_exists,
            product_exists=product_exists,
            quantity=quantity,
            inventory_updated_at=row["updated_at"] if row else None,
            now=datetime.now(UTC),
            has_open_duplicate=has_open_duplicate,
        )

    def validate_scope(self, body: ProposalCreate) -> list[str]:
        """Run deterministic validation for the proposal type. RESTOCK only today."""
        if body.proposal_type != "RESTOCK":
            return []
        store_id, product_id, quantity = parse_restock_scope(body.entity_scope)
        with self._connect() as conn, conn.cursor(row_factory=dict_row) as cur:
            facts = self._restock_facts(cur, store_id, product_id, quantity)
        return validate_restock(facts)

    # --- create ------------------------------------------------------------------
    def create(self, body: ProposalCreate) -> dict[str, Any]:
        correlation_id = str(uuid4())
        reasons = self.validate_scope(body)
        if reasons:
            log.info(
                "proposal.rejected_at_create",
                correlation_id=correlation_id,
                proposal_type=body.proposal_type,
                reasons=reasons,
            )
            raise ProposalError(400, "; ".join(reasons))
        with self._connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "INSERT INTO proposals (proposal_type, entity_scope, recommended_action,"
                " reason, evidence, source_request_id, validation_status)"
                " VALUES (%s, %s, %s, %s, %s, %s, 'VALID') RETURNING *",
                (
                    body.proposal_type,
                    Jsonb(body.entity_scope),
                    body.recommended_action,
                    body.reason,
                    Jsonb(body.evidence),
                    body.source_request_id,
                ),
            )
            row = cur.fetchone()
            self._audit(
                cur, row["proposal_id"], None, "PENDING", self._actor, "created", correlation_id
            )
        log.info(
            "proposal.created",
            correlation_id=correlation_id,
            proposal_id=row["proposal_id"],
            proposal_type=body.proposal_type,
            validation_status="VALID",
        )
        return row

    # --- approve / reject ----------------------------------------------------------
    def approve(self, proposal_id: int, approver: str) -> dict[str, Any]:
        rejection: str | None = None
        with self._connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            row = self._lock(cur, proposal_id)
            if row["status"] != "PENDING":
                raise ProposalError(
                    409, f"proposal {proposal_id} is {row['status']}; only PENDING can be approved"
                )
            correlation_id = self._correlation_id(cur, proposal_id)
            reasons = self._revalidate(cur, row)
            if reasons:
                # Persist INVALID + audit BEFORE raising: the rejection must
                # survive the transaction rollback so the row tells the truth.
                rejection = "; ".join(reasons)
                cur.execute(
                    "UPDATE proposals SET validation_status = 'INVALID', updated_at = now()"
                    " WHERE proposal_id = %s",
                    (proposal_id,),
                )
                self._audit(
                    cur, proposal_id, "PENDING", "PENDING", approver,
                    "re-validation failed: " + rejection, correlation_id,
                )
            else:
                cur.execute(
                    "UPDATE proposals SET status = 'APPROVED', approved_by = %s,"
                    " approved_at = now(), updated_at = now()"
                    " WHERE proposal_id = %s RETURNING *",
                    (approver, proposal_id),
                )
                approved = cur.fetchone()
                self._audit(cur, proposal_id, "PENDING", "APPROVED", approver,
                            "human approval", correlation_id)
        if rejection is not None:
            log.warning(
                "proposal.approval_rejected",
                correlation_id=correlation_id,
                proposal_id=proposal_id,
                approver=approver,
                reasons=rejection,
            )
            raise ProposalError(409, rejection)
        log.info(
            "proposal.approved",
            correlation_id=correlation_id,
            proposal_id=proposal_id,
            approver=approver,
        )
        if approved["proposal_type"] != "RESTOCK":
            return self.get(proposal_id)
        return self._execute_restock(approved, correlation_id)

    def reject(
        self, proposal_id: int, approver: str, reason: str | None = None
    ) -> dict[str, Any]:
        with self._connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            row = self._lock(cur, proposal_id)
            if row["status"] != "PENDING":
                raise ProposalError(
                    409, f"proposal {proposal_id} is {row['status']}; only PENDING can be rejected"
                )
            correlation_id = self._correlation_id(cur, proposal_id)
            cur.execute(
                "UPDATE proposals SET status = 'REJECTED', approved_by = %s,"
                " updated_at = now() WHERE proposal_id = %s RETURNING *",
                (approver, proposal_id),
            )
            updated = cur.fetchone()
            self._audit(cur, proposal_id, "PENDING", "REJECTED", approver,
                        reason or "human rejection", correlation_id)
        log.info(
            "proposal.rejected",
            correlation_id=correlation_id,
            proposal_id=proposal_id,
            approver=approver,
        )
        return updated

    # --- executor (approve path only) ---------------------------------------------
    def _execute_restock(
        self, proposal: dict[str, Any], correlation_id: str
    ) -> dict[str, Any]:
        """Apply the simulated restock in ONE transaction; failures mark FAILED.

        The action is rebuilt exclusively from the stored row — never from
        request payloads (kit/03 §14.4).
        """
        store_id, product_id, quantity = parse_restock_scope(proposal["entity_scope"])
        try:
            with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    "UPDATE inventory SET on_hand_qty = on_hand_qty + %s, updated_at = now()"
                    " WHERE store_id = %s AND product_id = %s",
                    (quantity, store_id, product_id),
                )
                if cur.rowcount != 1:
                    raise RuntimeError(
                        f"inventory row missing for store={store_id} product={product_id}"
                    )
                cur.execute(
                    "INSERT INTO inventory_movements (store_id, product_id, movement_type,"
                    " quantity_delta, reference_type, reference_id, occurred_at)"
                    " VALUES (%s, %s, 'RECEIPT', %s, 'AUTO_PROPOSAL', %s, now())",
                    (store_id, product_id, quantity, str(proposal["proposal_id"])),
                )
                detail = (
                    f"restock executed: +{quantity} units to store {store_id}"
                    f" product {product_id}"
                )
                cur.execute(
                    "UPDATE proposals SET status = 'EXECUTED', executed_at = now(),"
                    " updated_at = now() WHERE proposal_id = %s",
                    (proposal["proposal_id"],),
                )
                self._audit(cur, proposal["proposal_id"], "APPROVED", "EXECUTED",
                            "executor:proposal_service", detail, correlation_id)
        except Exception as exc:
            log.exception(
                "proposal.execution_failed",
                correlation_id=correlation_id,
                proposal_id=proposal["proposal_id"],
                error=str(exc),
            )
            with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    "UPDATE proposals SET status = 'FAILED', updated_at = now()"
                    " WHERE proposal_id = %s",
                    (proposal["proposal_id"],),
                )
                self._audit(cur, proposal["proposal_id"], "APPROVED", "FAILED",
                            "executor:proposal_service", f"error: {exc}", correlation_id)
        return self.get(proposal["proposal_id"])

    # --- internals -----------------------------------------------------------------
    def _lock(self, cur: psycopg.Cursor, proposal_id: int) -> dict[str, Any]:
        cur.execute(
            "SELECT * FROM proposals WHERE proposal_id = %s FOR UPDATE", (proposal_id,)
        )
        row = cur.fetchone()
        if row is None:
            raise ProposalError(404, f"proposal {proposal_id} not found")
        return row

    def _revalidate(self, cur: psycopg.Cursor, row: dict[str, Any]) -> list[str]:
        """Re-run deterministic validation from the STORED row at approve time."""
        if row["proposal_type"] != "RESTOCK":
            return []
        store_id, product_id, quantity = parse_restock_scope(row["entity_scope"])
        facts = self._restock_facts(
            cur, store_id, product_id, quantity, exclude_proposal_id=row["proposal_id"]
        )
        return validate_restock(facts)

    def _audit(
        self,
        cur: psycopg.Cursor,
        proposal_id: int,
        from_status: str | None,
        to_status: str,
        actor: str,
        detail: str,
        correlation_id: str,
    ) -> None:
        cur.execute(
            "INSERT INTO proposal_audit (proposal_id, from_status, to_status, actor,"
            " detail, correlation_id) VALUES (%s, %s, %s, %s, %s, %s)",
            (proposal_id, from_status, to_status, actor, detail, correlation_id),
        )
