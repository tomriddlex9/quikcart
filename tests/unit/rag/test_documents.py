"""Document-loading tests (kit/07 Phase 12 — ingestion contract)."""

from pathlib import Path

import pytest

from quickcart.rag.documents import load_documents

pytestmark = pytest.mark.unit

EXPECTED_DOC_IDS = {
    "refund_policy",
    "refund_policy_v1",  # superseded version kept for recency evaluation
    "inventory_sop",
    "delivery_incident_sop",
    "store_operations_manual",
    "customer_complaint_policy",
    "promotion_policy",
}


def test_load_default_fixtures_contract() -> None:
    docs = load_documents()
    assert {doc.doc_id for doc in docs} == EXPECTED_DOC_IDS
    for doc in docs:
        assert doc.title
        assert doc.version
        assert doc.effective_date
        assert len(doc.sections) >= 1
        for section in doc.sections:
            assert section.heading
            assert section.text


def test_load_is_deterministic() -> None:
    first = load_documents()
    second = load_documents()
    assert first == second
    assert [doc.doc_id for doc in first] == sorted(EXPECTED_DOC_IDS)


def test_superseded_policy_is_marked(tmp_path: Path) -> None:
    docs = {doc.doc_id: doc for doc in load_documents()}
    legacy = docs["refund_policy_v1"]
    assert legacy.version == "1.0"
    assert "superseded" in legacy.sections[0].text.lower()
    current = docs["refund_policy"]
    assert current.version != legacy.version


def _write(tmp_path: Path, name: str, body: str) -> Path:
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    return path


VALID = """---
doc_id: test_doc
title: Test Doc
version: "1.0"
effective_date: "2026-01-01"
---

# Test Doc

Intro.

## Section one

Body text.
"""

VALID_SECOND = """---
doc_id: other_doc
title: Other Doc
version: "2.0"
effective_date: "2026-02-01"
---

# Other Doc

## Only section

Body.
"""


def test_load_custom_dir(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", VALID)
    _write(tmp_path, "b.md", VALID_SECOND)
    docs = load_documents(tmp_path)
    assert [doc.doc_id for doc in docs] == ["test_doc", "other_doc"]


def test_missing_frontmatter_key_rejected(tmp_path: Path) -> None:
    bad = VALID.replace('version: "1.0"\n', "")
    _write(tmp_path, "bad.md", bad)
    with pytest.raises(ValueError, match="version"):
        load_documents(tmp_path)


def test_duplicate_doc_id_rejected(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", VALID)
    _write(tmp_path, "b.md", VALID)
    with pytest.raises(ValueError, match="duplicate doc_id"):
        load_documents(tmp_path)


def test_h1_title_mismatch_rejected(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", VALID.replace("# Test Doc", "# Renamed Doc"))
    with pytest.raises(ValueError, match="does not match"):
        load_documents(tmp_path)


def test_section_without_text_rejected(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", VALID.replace("Body text.\n", ""))
    with pytest.raises(ValueError, match="no body text"):
        load_documents(tmp_path)


def test_no_frontmatter_at_all_rejected(tmp_path: Path) -> None:
    _write(tmp_path, "a.md", "# Just a heading\n\nNo frontmatter.\n")
    with pytest.raises(ValueError, match="frontmatter"):
        load_documents(tmp_path)


def test_empty_dir_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"no \.md documents"):
        load_documents(tmp_path)
