"""Pydantic request/response contracts for the Phase 14 API (kit/03 §14.1).

Boundary between schema and business validation:
- Pydantic enforces shape only (missing fields, wrong types) → 422.
- ``entity_scope`` is a free-form dict, so RESTOCK quantity bounds and all
  existence/freshness/duplicate checks are decided by the deterministic
  ProposalService → 400/409 with reasons (never silently accepted).
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_RESTOCK_QUANTITY = 500

ProposalType = Literal["RESTOCK", "INCIDENT", "OPS_NOTIFICATION"]
ProposalStatus = Literal["PENDING", "APPROVED", "REJECTED", "EXECUTED", "FAILED"]
ValidationStatus = Literal["PENDING", "VALID", "INVALID"]
SqlSource = Literal["postgres", "lakehouse"]
CatalogLayer = Literal["raw", "bronze", "silver", "gold"]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None


class ChatResponse(BaseModel):
    answer: str
    evidence: list[dict] = Field(default_factory=list)
    tool_trace: list[dict] = Field(default_factory=list)


class ProposalCreate(BaseModel):
    proposal_type: ProposalType
    entity_scope: dict[str, int] = Field(min_length=1)
    recommended_action: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    evidence: list[str] = Field(default_factory=list)
    source_request_id: str | None = None


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    proposal_id: int
    proposal_type: str
    entity_scope: dict[str, int]
    recommended_action: str
    reason: str
    evidence: list[str]
    source_request_id: str | None
    validation_status: str
    status: str
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None
    executed_at: datetime | None
    approved_by: str | None


class ApproveRequest(BaseModel):
    approver: str = Field(min_length=1)


class RejectRequest(BaseModel):
    approver: str = Field(min_length=1)
    reason: str | None = None


class SqlExecuteRequest(BaseModel):
    """One read-only statement for the SQL console.

    ``limit`` is clamped down to the hard row cap by the guard rather than
    rejected, so a console asking for more rows gets the cap, not a 422.
    """

    source: SqlSource
    sql: str = Field(min_length=1)
    limit: int | None = Field(default=None, ge=1)


class SqlExecuteResponse(BaseModel):
    source: SqlSource
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
    elapsed_ms: float


class SqlGenerateRequest(BaseModel):
    question: str = Field(min_length=1)
    source: SqlSource


class SqlGenerateResponse(BaseModel):
    """A candidate statement only — the API never executes generated SQL."""

    source: SqlSource
    sql: str
    model: str | None
    valid: bool
    degraded: bool
    notes: list[str] = Field(default_factory=list)


class CatalogColumn(BaseModel):
    name: str
    type: str
    nullable: bool = True


class CatalogTable(BaseModel):
    layer: CatalogLayer
    name: str
    columns: list[CatalogColumn] = Field(default_factory=list)
    location: str | None = None


class CatalogTablesResponse(BaseModel):
    tables: list[CatalogTable]
    notes: list[str] = Field(default_factory=list)


class CatalogPreviewResponse(BaseModel):
    layer: CatalogLayer
    name: str
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool
    elapsed_ms: float
    source: Literal["postgres", "lakehouse"]


class ErTable(BaseModel):
    name: str
    columns: list[CatalogColumn] = Field(default_factory=list)


class ErEdge(BaseModel):
    from_table: str
    from_column: str
    to_table: str
    to_column: str


class ErResponse(BaseModel):
    tables: list[ErTable]
    edges: list[ErEdge]


class AuditEntry(BaseModel):
    audit_id: int
    proposal_id: int
    from_status: str | None
    to_status: str
    actor: str
    detail: str | None
    correlation_id: str
    created_at: datetime
