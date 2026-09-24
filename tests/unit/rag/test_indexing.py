"""Indexing tests (kit/07 Phase 12 — ingestion idempotent).

Runs against an in-memory Qdrant (`:memory:`) and the deterministic fake
embedder — real cosine scoring, no Docker, no model download.
"""

import hashlib

import pytest

from quickcart.rag.chunking import chunk_documents
from quickcart.rag.config import RagSettings
from quickcart.rag.indexing import build_index, point_id_for

from .fakes import FakeEmbedder, make_document, memory_client

pytestmark = pytest.mark.unit


def _chunks():
    docs = [
        make_document(
            "refund_policy",
            {
                "Eligibility": "Customers are eligible for a full refund when items "
                "arrive spoiled within 24 hours of delivery."
            },
            title="Refund Policy",
            version="2.1",
            effective_date="2026-01-15",
        ),
        make_document(
            "inventory_sop",
            {"Cycle counting": "High-value SKUs are cycle counted daily by staff."},
            title="Inventory SOP",
            version="1.4",
            effective_date="2026-02-01",
        ),
    ]
    return chunk_documents(docs)


def test_point_id_is_deterministic_sha256() -> None:
    expected = int.from_bytes(hashlib.sha256(b"some-chunk-id").digest()[:8], "big")
    assert point_id_for("some-chunk-id") == expected
    assert point_id_for("some-chunk-id") == point_id_for("some-chunk-id")
    assert point_id_for("a") != point_id_for("b")


def test_build_index_returns_contract() -> None:
    chunks = _chunks()
    client = memory_client()
    result = build_index(chunks, embedder=FakeEmbedder(), client=client)
    assert result == {"collection": RagSettings().collection_name, "points": len(chunks)}


def test_index_is_idempotent() -> None:
    chunks = _chunks()
    client = memory_client()
    first = build_index(chunks, embedder=FakeEmbedder(), client=client)
    second = build_index(chunks, embedder=FakeEmbedder(), client=client)
    assert first == second
    info = client.get_collection(RagSettings().collection_name)
    assert info.points_count == len(chunks)


def test_rebuild_replaces_stale_chunks() -> None:
    client = memory_client()

    full = _chunks()
    build_index(full, embedder=FakeEmbedder(), client=client)
    subset = full[:1]
    result = build_index(subset, embedder=FakeEmbedder(), client=client)
    assert result["points"] == 1
    info = client.get_collection(RagSettings().collection_name)
    assert info.points_count == 1


def test_payload_carries_source_metadata() -> None:
    chunks = _chunks()
    client = memory_client()

    build_index(chunks, embedder=FakeEmbedder(), client=client)
    points, _ = client.scroll(
        collection_name=RagSettings().collection_name, limit=len(chunks), with_payload=True
    )
    assert len(points) == len(chunks)
    by_chunk_id = {point.payload["chunk_id"]: point.payload for point in points}
    for chunk in chunks:
        payload = by_chunk_id[chunk.chunk_id]
        assert payload["doc_id"] == chunk.doc_id
        assert payload["title"] == chunk.title
        assert payload["section_heading"] == chunk.section_heading
        assert payload["version"] == chunk.version
        assert payload["effective_date"] == chunk.effective_date
        assert payload["text"] == chunk.text
        assert isinstance(payload["text"], str) and payload["text"]


def test_vector_size_matches_embedder_dimensions() -> None:

    embedder = FakeEmbedder(dim=48)
    client = memory_client()
    build_index(_chunks(), embedder=embedder, client=client)
    info = client.get_collection(RagSettings().collection_name)
    assert info.config.params.vectors.size == 48


def test_empty_chunks_rejected() -> None:

    with pytest.raises(ValueError, match="at least one chunk"):
        build_index([], embedder=FakeEmbedder(), client=memory_client())
