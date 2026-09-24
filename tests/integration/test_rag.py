"""Live RAG integration test (kit/07 Phase 12 acceptance gates).

Runs only when BOTH hold:
- Qdrant answers at `QUICKCART_QDRANT_URL` (default http://127.0.0.1:6333), and
- `QUICKCART_RUN_LIVE_RAG=1` is set.

Uses the real sentence-transformers embedder (the local all-MiniLM-L6-v2 model
is downloaded once on first use) and the real Qdrant server from the compose
`ai` profile. Without Docker/services this module skips cleanly, as required
for CI (kit/07 §2).
"""

import json
import os
import urllib.request

import pytest

from quickcart.rag.chunking import chunk_documents
from quickcart.rag.documents import load_documents
from quickcart.rag.evaluation import run_retrieval_eval
from quickcart.rag.indexing import build_index
from quickcart.rag.retrieve import UNSUPPORTED_MESSAGE, Retriever

pytestmark = pytest.mark.integration

MIN_HIT_RATE = 0.75
UNSUPPORTED_MAX_TOP_SCORE = 0.5


def _live_enabled() -> bool:
    if os.environ.get("QUICKCART_RUN_LIVE_RAG") != "1":
        return False
    from quickcart.rag.config import RagSettings

    try:
        with urllib.request.urlopen(f"{RagSettings().qdrant_url}/collections", timeout=3) as resp:
            return resp.status == 200
    except OSError:
        return False


if not _live_enabled():
    pytest.skip(
        "requires Qdrant (docker compose --profile ai up -d) and QUICKCART_RUN_LIVE_RAG=1",
        allow_module_level=True,
    )


@pytest.fixture(scope="module")
def live_index() -> dict:
    """Build (and rebuild) the index with the real embedder; return the report."""
    from quickcart.rag.config import RagSettings
    from quickcart.rag.embeddings import Embedder

    docs = load_documents()
    chunks = chunk_documents(docs)
    embedder = Embedder()  # real local model, downloaded once
    first = build_index(chunks, embedder=embedder)
    second = build_index(chunks, embedder=embedder)  # idempotency evidence
    retriever = Retriever(embedder=embedder)
    report = run_retrieval_eval(retriever)
    print(json.dumps(report, indent=2))
    return {
        "chunks": chunks,
        "first": first,
        "second": second,
        "retriever": retriever,
        "report": report,
        "collection": RagSettings().collection_name,
    }


def test_ingestion_idempotent(live_index: dict) -> None:
    assert live_index["first"]["points"] == len(live_index["chunks"])
    assert live_index["second"] == live_index["first"]


def test_retrieval_hit_rate(live_index: dict) -> None:
    report = live_index["report"]
    assert report["hit_rate"] >= MIN_HIT_RATE, json.dumps(report["details"], indent=2)


def test_current_policy_preferred_over_superseded(live_index: dict) -> None:
    """kit/07 §7: stale policy not preferred when metadata supports recency."""
    retriever: Retriever = live_index["retriever"]
    for question in (
        "Are customers eligible for a full refund when perishables arrive spoiled?",
        "How are partial refunds for missing items calculated?",
    ):
        hits = retriever.search(question, k=5)
        # the superseded v1 policy must never be the top answer
        assert hits[0].doc_id == "refund_policy", hits[0]
        assert hits[0].version == "2.1"


def test_missing_answer_query_does_not_fabricate(live_index: dict) -> None:
    retriever: Retriever = live_index["retriever"]
    report = live_index["report"]
    assert report["unsupported_questions"] >= 2
    assert report["unsupported_ok"] == report["unsupported_questions"]
    for detail in report["details"]:
        if not detail["must_answer"]:
            assert detail["top_score"] < UNSUPPORTED_MAX_TOP_SCORE, detail
            result = retriever.grounded_search(detail["question"])
            assert not result.supported
            assert result.chunks == []
            assert result.message == UNSUPPORTED_MESSAGE


def test_results_include_source_metadata(live_index: dict) -> None:
    retriever: Retriever = live_index["retriever"]
    hits = retriever.search("What compensation applies for a very late delivery?", k=3)
    assert hits
    top = hits[0]
    assert top.doc_id == "customer_complaint_policy"
    assert top.title == "Customer Complaint Policy"
    assert top.section_heading
    assert top.version == "2.0"
    assert top.effective_date == "2026-01-05"
    assert top.text
    assert 0.0 < top.score <= 1.0
