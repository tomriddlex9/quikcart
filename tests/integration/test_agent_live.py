"""Live agent integration test (kit/07 Phase 13 acceptance gates).

Runs only when ALL hold:
- Ollama answers at `OLLAMA_BASE_URL` and serves `OLLAMA_MODEL`,
- `QUICKCART_RUN_LIVE_AGENT=1` is set,
- for the analytics case: `data/gold` tables exist (`make seed` + `make lakehouse`),
- for the policy case: Qdrant answers at `QUICKCART_QDRANT_URL` with the
  `quickcart_docs` collection indexed (`uv run python -m quickcart.rag.indexing`).

Uses the real qwen3 model, real Gold Delta tables, and the real Qdrant index.
Without services/flag this module skips cleanly (kit/07 §2).
"""

import json
import os
import urllib.request
from pathlib import Path

import pytest

from quickcart.config.settings import get_settings

pytestmark = [pytest.mark.integration, pytest.mark.slow]


def _ollama_live() -> bool:
    settings = get_settings()
    try:
        with urllib.request.urlopen(f"{settings.ollama_base_url}/api/tags", timeout=3) as resp:
            models = {m["name"] for m in json.loads(resp.read())["models"]}
    except (OSError, ValueError, KeyError):
        return False
    return settings.ollama_model in models


def _qdrant_live() -> bool:
    from quickcart.rag.config import RagSettings

    try:
        with urllib.request.urlopen(
            f"{RagSettings().qdrant_url}/collections", timeout=3
        ) as resp:
            collections = {c["name"] for c in json.loads(resp.read())["result"]["collections"]}
    except (OSError, ValueError, KeyError):
        return False
    return RagSettings().collection_name in collections


def _gold_live() -> bool:
    gold = get_settings().data_root / "gold"
    return (gold / "gold_store_hourly_metrics").exists() and (gold / "gold_customer_360").exists()


if os.environ.get("QUICKCART_RUN_LIVE_AGENT") != "1":
    pytest.skip("set QUICKCART_RUN_LIVE_AGENT=1 to run the live agent tests",
                allow_module_level=True)

if not _ollama_live():
    pytest.skip(
        f"Ollama not serving {get_settings().ollama_model} at "
        f"{get_settings().ollama_base_url}",
        allow_module_level=True,
    )


def _known_store_id() -> int:
    from quickcart.agents.service import _readers

    rows = _readers().stores().select("store_id").collect()
    if not rows:
        pytest.skip("no stores in silver_stores; run make seed + make lakehouse")
    return min(row[0] for row in rows)


def test_live_analytics_question_uses_real_gold_data() -> None:
    """kit/07 Phase 13: analytics question → analytics tools → grounded answer."""
    if not _gold_live():
        pytest.skip("data/gold not built; run make seed + make lakehouse")
    from quickcart.agents import service

    store_id = _known_store_id()
    result = service.chat(f"How is store {store_id} performing? Summarize the key metrics.")
    assert result["degraded"] is False
    assert result["answer"].strip(), "answer must be non-empty"
    assert result["evidence"], "analytics answer must carry retrieved evidence"
    tools = {step["tool"] for step in result["tool_trace"]}
    assert "get_store_metrics" in tools
    assert str(store_id) in result["answer"], "answer should cite the store id"
    assert result["trace_path"] and Path(result["trace_path"]).exists()


def test_live_policy_question_uses_real_qdrant_index() -> None:
    """kit/07 Phase 13: policy question → RAG tool, grounded in real chunks."""
    if not _qdrant_live():
        pytest.skip("Qdrant not reachable or index missing; start compose ai profile")
    from quickcart.agents import service

    result = service.chat("What is our refund policy for expired items?")
    assert result["degraded"] is False
    assert result["answer"].strip(), "answer must be non-empty"
    tools = {step["tool"] for step in result["tool_trace"]}
    assert "search_company_docs" in tools
    doc_evidence = [e for e in result["evidence"] if e.get("type") == "document"]
    assert doc_evidence and doc_evidence[0]["supported"] is True
    chunk = doc_evidence[0]["chunks"][0]
    assert chunk["doc_id"] and chunk["version"]  # source metadata present (RAGR-002)


def test_live_unsupported_question_does_not_fabricate() -> None:
    from quickcart.agents import service

    result = service.chat("What is the CEO's favourite colour?")
    assert result["degraded"] is False
    assert "don't have sufficient evidence" in result["answer"]
    assert result["evidence"] == []
