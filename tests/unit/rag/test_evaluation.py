"""Retrieval-eval tests (kit/07 §7 — hit rate, unsupported probes, fixture integrity)."""

import json
from pathlib import Path

import pytest

from quickcart.rag.chunking import chunk_documents
from quickcart.rag.evaluation import load_eval_questions, run_retrieval_eval
from quickcart.rag.indexing import build_index
from quickcart.rag.retrieve import Retriever

from .fakes import FakeEmbedder, make_document, memory_client

pytestmark = pytest.mark.unit

DOCS = [
    make_document(
        "refund_policy",
        {
            "Eligibility": "Customers are eligible for a full refund when perishable "
            "items arrive spoiled, claimed within 24 hours of delivery."
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
]

EVAL_SET = [
    {
        "question_id": "T01",
        "question": "full refund spoiled perishable items claim within 24 hours",
        "expected_doc": "refund_policy",
        "expected_section": "Eligibility",
    },
    {
        "question_id": "T02",
        "question": "cycle counted daily high value skus staff",
        "expected_doc": "inventory_sop",
        "expected_section": "Cycle counting",
    },
    {
        "question_id": "T03",
        "question": "earnings revenue profit shareholders quarterly results",
        "expected_doc": None,
        "must_answer": False,
    },
]


def _retriever() -> Retriever:
    client = memory_client()
    build_index(chunk_documents(DOCS), embedder=FakeEmbedder(), client=client)
    return Retriever(embedder=FakeEmbedder(), client=client)


def test_run_retrieval_eval_report(tmp_path: Path) -> None:
    eval_path = tmp_path / "eval.json"
    eval_path.write_text(json.dumps(EVAL_SET), encoding="utf-8")

    report = run_retrieval_eval(_retriever(), eval_path=eval_path)

    assert report["questions"] == 3
    assert report["answered_questions"] == 2
    assert report["hit_rate"] == 1.0
    assert report["unsupported_questions"] == 1
    assert report["unsupported_ok"] == 1
    assert len(report["details"]) == 3

    by_id = {d["question_id"]: d for d in report["details"]}
    assert by_id["T01"]["hit"] is True
    assert by_id["T01"]["top_doc"] == "refund_policy"
    assert by_id["T01"]["top_section"] == "Eligibility"
    assert by_id["T03"]["hit"] is None
    assert by_id["T03"]["unsupported_ok"] is True
    assert by_id["T03"]["top_score"] < report["unsupported_threshold"]


def test_run_retrieval_eval_miss_is_counted(tmp_path: Path) -> None:
    eval_path = tmp_path / "eval.json"
    eval_path.write_text(
        json.dumps(
            [
                {
                    "question_id": "M01",
                    # token overlap only with inventory_sop; refund_policy must not rank top-1
                    "question": "daily store staff warehouse walk",
                    "expected_doc": "refund_policy",
                }
            ]
        ),
        encoding="utf-8",
    )
    report = run_retrieval_eval(_retriever(), eval_path=eval_path, k=1)
    assert report["hit_rate"] == 0.0
    assert report["details"][0]["hit"] is False
    assert report["details"][0]["top_doc"] == "inventory_sop"


def test_eval_question_contract_validation(tmp_path: Path) -> None:
    eval_path = tmp_path / "eval.json"
    eval_path.write_text(json.dumps([{"question": "no expected doc key"}]), encoding="utf-8")
    with pytest.raises(ValueError, match="expected_doc"):
        run_retrieval_eval(_retriever(), eval_path=eval_path)


def test_packaged_eval_set_shape() -> None:
    questions = load_eval_questions()
    assert 15 <= len(questions) <= 20
    must_answer = [q for q in questions if q.must_answer]
    unsupported = [q for q in questions if not q.must_answer]
    assert len(must_answer) + len(unsupported) == len(questions)
    assert len(must_answer) >= 15
    assert len(unsupported) >= 2, "RAGR-004 probes required"
    assert all(q.expected_doc for q in must_answer)
    assert all(q.expected_doc is None for q in unsupported)
    assert len({q.question_id for q in questions}) == len(questions)


def test_packaged_eval_set_references_loaded_docs() -> None:
    """Guard against fixture/eval drift: every expected_doc must exist."""
    from quickcart.rag.documents import load_documents

    doc_ids = {doc.doc_id for doc in load_documents()}
    for question in load_eval_questions():
        if question.expected_doc is not None:
            assert question.expected_doc in doc_ids, question.question_id
