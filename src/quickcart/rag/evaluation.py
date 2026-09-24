"""Retrieval evaluation (kit/03 Phase 12.5, kit/07 §7 RAG evaluation gates).

Measures retrieval quality *before* any answer generation exists (kit/05 §13):
- `hit_rate` — share of must-answer questions whose `expected_doc` appears in
  the top-k (kit/07 Phase 12 gate);
- unsupported probes — questions no internal document can answer (quantitative
  analytics, unknowable facts). A probe "passes" when the top score stays below
  the threshold, i.e. retrieval does not fabricate a source (RAGR-004).

CLI: `uv run python -m quickcart.rag.evaluation` prints the JSON report.
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import structlog

from quickcart.rag.embeddings import quiet_embedding_logs
from quickcart.rag.retrieve import Retriever

logger = structlog.get_logger(__name__)

DEFAULT_EVAL_PATH = Path(__file__).resolve().parent / "fixtures" / "eval_questions.json"
DEFAULT_K = 5
DEFAULT_UNSUPPORTED_THRESHOLD = 0.4  # measured separation: hits >= 0.54, probes <= 0.33


@dataclass(frozen=True)
class EvalQuestion:
    """One retrieval eval probe."""

    question_id: str
    question: str
    expected_doc: str | None
    expected_section: str | None
    must_answer: bool


def load_eval_questions(eval_path: Path | None = None) -> list[EvalQuestion]:
    """Load the eval set; every entry must carry an `expected_doc` key
    (`null` marks an unsupported probe that must not be answered)."""
    path = Path(eval_path) if eval_path is not None else DEFAULT_EVAL_PATH
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{path}: eval set must be a non-empty JSON list")

    questions: list[EvalQuestion] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict) or "question" not in entry or "expected_doc" not in entry:
            raise ValueError(f"{path}: entry {index} must carry 'question' and 'expected_doc'")
        must_answer = bool(entry.get("must_answer", entry["expected_doc"] is not None))
        questions.append(
            EvalQuestion(
                question_id=str(entry.get("question_id", f"Q{index + 1:02d}")),
                question=str(entry["question"]),
                expected_doc=entry["expected_doc"],
                expected_section=entry.get("expected_section"),
                must_answer=must_answer,
            )
        )
    return questions


def run_retrieval_eval(
    retriever: Retriever,
    eval_path: Path | None = None,
    k: int = DEFAULT_K,
    unsupported_threshold: float = DEFAULT_UNSUPPORTED_THRESHOLD,
) -> dict:
    """Run the eval set against a retriever; returns the report dict.

    `hit_rate` is computed over must-answer questions only (those with a
    non-null `expected_doc`), matching kit/07 Phase 12: "retrieval returns
    expected document for evaluation queries".
    """
    questions = load_eval_questions(eval_path)
    details: list[dict] = []
    answered = 0
    hits = 0
    unsupported_total = 0
    unsupported_ok = 0

    for question in questions:
        results = retriever.search(question.question, k=k)
        top = results[0] if results else None
        entry = {
            "question_id": question.question_id,
            "question": question.question,
            "expected_doc": question.expected_doc,
            "expected_section": question.expected_section,
            "must_answer": question.must_answer,
            "top_doc": top.doc_id if top else None,
            "top_section": top.section_heading if top else None,
            "top_score": round(top.score, 4) if top else None,
            "top_k_docs": [hit.doc_id for hit in results],
        }
        if question.must_answer and question.expected_doc is not None:
            answered += 1
            hit = question.expected_doc in entry["top_k_docs"]
            hits += hit
            entry["hit"] = hit
        else:
            unsupported_total += 1
            top_score = top.score if top else 0.0
            ok = top_score < unsupported_threshold
            unsupported_ok += ok
            entry["hit"] = None
            entry["unsupported_ok"] = ok
        details.append(entry)

    report = {
        "questions": len(questions),
        "answered_questions": answered,
        "hit_rate": round(hits / answered, 4) if answered else 0.0,
        "unsupported_questions": unsupported_total,
        "unsupported_ok": unsupported_ok,
        "unsupported_threshold": unsupported_threshold,
        "details": details,
    }
    logger.info(
        "rag_eval_completed",
        questions=report["questions"],
        hit_rate=report["hit_rate"],
        unsupported_ok=f"{unsupported_ok}/{unsupported_total}",
    )
    return report


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: evaluates retrieval against the packaged eval set.

    All diagnostics go to stderr so stdout carries only the JSON report.
    """
    parser = argparse.ArgumentParser(description="QuickCart RAG retrieval evaluation")
    parser.add_argument("--eval-path", type=Path, default=None, help="override eval JSON path")
    parser.add_argument("--k", type=int, default=DEFAULT_K, help="top-k per question")
    parser.add_argument("--url", type=str, default=None, help="Qdrant URL override")
    args = parser.parse_args(argv)

    import sys

    from quickcart.logging import configure_logging

    original_stdout = sys.stdout
    sys.stdout = sys.stderr  # loggers and model-loading noise go to stderr
    try:
        configure_logging()
        quiet_embedding_logs()
        retriever = Retriever(url=args.url)
        report = run_retrieval_eval(retriever, eval_path=args.eval_path, k=args.k)
    finally:
        sys.stdout = original_stdout
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
