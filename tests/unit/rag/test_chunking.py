"""Chunking tests (kit/02 RAGR-001 — meaningful boundaries, determinism)."""

import hashlib
from itertools import pairwise

import pytest

from quickcart.rag.chunking import chunk_documents, chunk_id_for

from .fakes import make_document

pytestmark = pytest.mark.unit


def test_short_section_yields_single_chunk() -> None:
    doc = make_document("d1", {"Eligibility": "Short body text under five hundred chars."})
    (chunk,) = chunk_documents([doc])
    assert chunk.chunk_id == chunk_id_for("d1", "Eligibility", 0)
    assert chunk.chunk_id == hashlib.sha1(b"d1|Eligibility|0").hexdigest()
    assert chunk.doc_id == "d1"
    assert chunk.title == "D1"
    assert chunk.section_heading == "Eligibility"
    assert chunk.version == "1.0"
    assert chunk.effective_date == "2026-01-01"
    assert chunk.text == "Short body text under five hundred chars."


def test_chunking_is_deterministic() -> None:
    docs = [
        make_document("d1", {"A": "alpha " * 40, "B": "beta " * 200}),
        make_document("d2", {"C": "gamma " * 300}),
    ]
    first = chunk_documents(docs)
    second = chunk_documents(docs)
    assert first == second
    assert len({chunk.chunk_id for chunk in first}) == len(first)


def test_long_section_splits_at_paragraph_boundary_with_overlap() -> None:
    paragraphs = [f"Paragraph {i} " + "x" * 180 for i in range(4)]  # ~740 chars total
    doc = make_document("d1", {"Long": "\n\n".join(paragraphs)})
    chunks = chunk_documents([doc], max_chars=500, overlap=50)

    assert len(chunks) >= 2
    for chunk in chunks:
        assert len(chunk.text) <= 500
    for first, second in pairwise(chunks):
        # paragraph-boundary splits carry 50 chars of tail context forward
        assert second.text[:50] == first.text[-50:]
        assert second.text[50:52] == "\n\n"


def test_split_chunks_keep_whole_paragraphs() -> None:
    paragraphs = [f"p{i} " + "y" * 120 for i in range(5)]  # each ~125 chars, under max
    doc = make_document("d1", {"Sec": "\n\n".join(paragraphs)})
    chunks = chunk_documents([doc], max_chars=400, overlap=50)

    assert len(chunks) >= 2
    bodies = [chunks[0].text]
    for previous, chunk in pairwise(chunks):
        assert chunk.text[:50] == previous.text[-50:]
        assert chunk.text[50:52] == "\n\n"
        bodies.append(chunk.text[52:])
    reassembled = "\n\n".join(bodies)
    # hard splits would leave torn paragraph fragments; none happened here
    for piece in reassembled.split("\n\n"):
        assert piece in paragraphs


def test_single_oversized_paragraph_is_hard_split() -> None:
    doc = make_document("d1", {"Huge": "z" * 1200})
    chunks = chunk_documents([doc], max_chars=500, overlap=50)
    assert len(chunks) == 3  # 500 + 500 + 200, with overlap context
    for chunk in chunks:
        assert len(chunk.text) <= 500
    assert chunks[0].text.endswith(chunks[1].text[:50])


def test_chunk_ids_differ_by_section_and_index() -> None:
    doc = make_document("d1", {"A": "a " * 400, "B": "b " * 400})
    chunks = chunk_documents([doc], max_chars=500, overlap=50)
    assert len(chunks) > 2
    assert len({chunk.chunk_id for chunk in chunks}) == len(chunks)


def test_invalid_overlap_rejected() -> None:
    doc = make_document("d1", {"A": "word " * 200})
    with pytest.raises(ValueError, match="overlap"):
        chunk_documents([doc], max_chars=100, overlap=100)


def test_fixture_corpus_chunking() -> None:
    """The real fixture corpus chunks with bounded sizes and stable ids."""
    from quickcart.rag.documents import load_documents

    docs = load_documents()
    chunks = chunk_documents(docs)
    assert len(chunks) >= len(docs)  # at least one chunk per section
    by_id = {doc.doc_id: doc for doc in docs}
    for chunk in chunks:
        assert len(chunk.text) <= 500
        source = by_id[chunk.doc_id]
        assert chunk.title == source.title
        assert chunk.version == source.version
        assert chunk.effective_date == source.effective_date
        assert any(s.heading == chunk.section_heading for s in source.sections)
    again = chunk_documents(load_documents())
    assert [c.chunk_id for c in chunks] == [c.chunk_id for c in again]
