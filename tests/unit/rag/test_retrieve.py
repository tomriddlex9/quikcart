"""Retrieval tests (kit/07 Phase 12 gates: ranking, metadata, no fabrication)."""

import pytest

from quickcart.rag.chunking import chunk_documents
from quickcart.rag.config import RagSettings
from quickcart.rag.indexing import build_index
from quickcart.rag.retrieve import UNSUPPORTED_MESSAGE, RetrievedChunk, Retriever

from .fakes import FakeEmbedder, make_document, memory_client

pytestmark = pytest.mark.unit

DOCS = [
    make_document(
        "refund_policy",
        {
            "Eligibility": "Customers are eligible for a full refund when perishable "
            "items arrive spoiled, provided the claim is made within 24 hours.",
            "Methods": "Approved refunds return to the original payment method within "
            "3 to 5 business days.",
        },
        title="Refund Policy",
        version="2.1",
        effective_date="2026-01-15",
    ),
    make_document(
        "inventory_sop",
        {"Cycle counting": "High-value SKUs are cycle counted daily by store staff."},
        title="Inventory SOP",
        version="1.4",
        effective_date="2026-02-01",
    ),
    make_document(
        "delivery_incident_sop",
        {"Rider accident": "Call emergency services first and do not move an injured rider."},
        title="Delivery Incident SOP",
        version="1.2",
        effective_date="2026-01-20",
    ),
]


def _retriever() -> Retriever:
    chunks = chunk_documents(DOCS)
    client = memory_client()
    build_index(chunks, embedder=FakeEmbedder(), client=client)
    return Retriever(embedder=FakeEmbedder(), client=client)


def test_search_ranks_relevant_chunk_first() -> None:
    retriever = _retriever()
    hits = retriever.search("full refund for spoiled perishable items claim window", k=3)
    assert hits, "expected retrieval results"
    assert hits[0].doc_id == "refund_policy"
    assert hits[0].section_heading == "Eligibility"
    assert isinstance(hits[0], RetrievedChunk)
    assert all(hits[i].score >= hits[i + 1].score for i in range(len(hits) - 1))


def test_results_include_source_metadata() -> None:
    retriever = _retriever()
    (hit,) = retriever.search("daily cycle count high value skus", k=1)
    assert hit.doc_id == "inventory_sop"
    assert hit.title == "Inventory SOP"
    assert hit.section_heading == "Cycle counting"
    assert hit.version == "1.4"
    assert hit.effective_date == "2026-02-01"
    assert hit.text
    assert 0.0 < hit.score <= 1.0


def test_out_of_scope_query_scores_low() -> None:
    """RAGR-004: an off-corpus question must not surface confident hits."""
    retriever = _retriever()
    hits = retriever.search("quarterly earnings revenue profit shareholders", k=3)
    assert hits, "cosine search always returns k nearest, however weak"
    assert all(hit.score < 0.5 for hit in hits)
    known = {"refund_policy", "inventory_sop", "delivery_incident_sop"}
    assert all(hit.doc_id in known for hit in hits)


def test_out_of_scope_query_filtered_to_empty() -> None:
    retriever = _retriever()
    hits = retriever.search("quarterly earnings revenue profit shareholders", k=5, min_score=0.3)
    assert hits == []


def test_grounded_search_supported() -> None:
    retriever = _retriever()
    result = retriever.grounded_search("call emergency services first injured rider accident", k=2)
    assert result.supported
    assert result.message is None
    assert result.chunks[0].doc_id == "delivery_incident_sop"


def test_grounded_search_unsupported_is_explicit() -> None:
    retriever = _retriever()
    result = retriever.grounded_search("earnings revenue profit ipo shareholders", k=5)
    assert not result.supported
    assert result.chunks == []
    assert result.message == UNSUPPORTED_MESSAGE
    assert "not fabricated" in result.message


def test_grounded_search_uses_configured_default_floor() -> None:
    retriever = _retriever()
    weak = retriever.search("refund", k=1)  # single generic token, weak overlap
    result = retriever.grounded_search("refund", k=5)
    if weak[0].score < RagSettings().min_score:
        assert not result.supported
    else:
        assert result.supported


def test_invalid_inputs_rejected() -> None:
    retriever = _retriever()
    with pytest.raises(ValueError, match="non-empty"):
        retriever.search("   ")
    with pytest.raises(ValueError, match="positive"):
        retriever.search("refund", k=0)
