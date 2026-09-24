# Phase 12 — RAG

## What was built

- **`src/quickcart/rag/` package** — the full `load → normalize → section
  split → chunk → embed → upsert → retrieve → evaluate` path (kit/03 §12.3):
  - `documents.py` — versioned Markdown ingestion: YAML-ish frontmatter
    (`doc_id`, `title`, `version`, `effective_date`), `# `/`## ` heading
    parsing. Malformed sources (missing keys, duplicate `doc_id`, empty
    sections, H1/frontmatter title mismatch) raise `ValueError` — nothing is
    silently skipped.
  - `chunking.py` — section-aware chunking (kit/02 RAGR-001): one chunk per
    section; sections > 500 chars split at paragraph boundaries with 50 chars
    of tail overlap; oversized single paragraphs hard-split as last resort.
    `chunk_id = sha1(doc_id | section_heading | index)` — fully deterministic.
  - `embeddings.py` — `Embedder` with a local sentence-transformers model
    (`QUICKCART_EMBEDDING_MODEL`, default `all-MiniLM-L6-v2`) and a mandatory
    injectable `encode_fn` so tests and the Phase 13 agent never download a
    model. Zero vectors are rejected (cosine would be undefined).
  - `indexing.py` — `build_index(chunks, embedder=None, client=None, url=None)`
    creates/replaces the `quickcart_docs` Qdrant collection (cosine distance,
    vector size taken from the embedder). Point ids are deterministic ints
    from `sha256(chunk_id)`; payload carries full source metadata
    (kit/02 RAGR-002). Rebuilding from the same chunks yields the same count.
  - `retrieve.py` — `Retriever.search(query, k, min_score)` returns
    `RetrievedChunk`s (chunk fields + score), best first.
    `grounded_search` is the RAGR-004 primitive: nothing above the score floor
    → `supported=False` with an explicit "not fabricated" message, never an
    invented answer.
  - `evaluation.py` — `run_retrieval_eval(retriever, eval_path=None)` over
    `fixtures/eval_questions.json` (20 questions: 18 must-answer with
    `expected_doc` (+ optional `expected_section`), 2 unsupported probes with
    `expected_doc: null`). Returns `{questions, answered_questions, hit_rate,
    unsupported_questions, unsupported_ok, details[]}`.
- **Fixtures** — six versioned internal documents (Refund Policy 2.1,
  Inventory SOP 1.4, Delivery Incident SOP 1.2, Store Operations Manual 3.0,
  Customer Complaint Policy 2.0, Promotion Policy 1.1) plus `refund_policy_v1`
  (1.0), a superseded version kept indexed so the retrieval-recency gate
  (kit/07 §7) is exercised for real: refund questions must rank v2.1 first.
- **Qdrant** (kit/03 §12.1) — compose `ai` profile, `docker compose
  --profile ai up -d` → http://127.0.0.1:6333.

## How to run

```bash
docker compose --profile ai up -d
uv run python -m quickcart.rag.indexing      # rebuild index; prints {"collection", "points"}
uv run python -m quickcart.rag.evaluation    # prints the JSON eval report on stdout
QUICKCART_RUN_LIVE_RAG=1 uv run pytest tests/integration/test_rag.py -q
```

Optional env (see `src/quickcart/rag/config.py`): `QUICKCART_EMBEDDING_MODEL`,
`QUICKCART_QDRANT_URL`, `QUICKCART_COLLECTION_NAME`, `QUICKCART_MIN_SCORE`
(default 0.4, measured — see below). CLI stdout is pure JSON; all logs go to
stderr.

## Verification executed

- **38 unit tests** (`tests/unit/rag/`, fake hashed-bag-of-words embedder +
  in-memory Qdrant `QdrantClient(":memory:")` — real cosine scoring, no Docker,
  no model download): parsing contract + rejection paths, chunking determinism
  and paragraph-boundary/overlap behaviour, index idempotency and
  replace-semantics, payload metadata, ranking correctness, out-of-scope
  queries scoring low and filtering to empty at the floor, eval report shape.
  All green.
- **5 live integration tests** (`tests/integration/test_rag.py`, real
  all-MiniLM-L6-v2 + real Qdrant; skipped unless Qdrant answers AND
  `QUICKCART_RUN_LIVE_RAG=1`): ingestion idempotent, **hit rate 1.0 (18/18
  must-answer)**, superseded refund policy never ranks first for refund
  questions, both unsupported probes below the floor (`grounded_search`
  returns `supported=False`), metadata present on every hit. All green.
- **Score-floor measurement** (decides `QUICKCART_MIN_SCORE=0.4`): on the
  packaged eval set with the default model, minimum must-answer top score =
  0.542 (Q18), maximum unsupported top score = 0.331 (Q19). 0.4 sits between
  with margin on both sides.
- `uv run ruff check .` — repo-wide pass.

Acceptance gates (kit/07 Phase 12):

| Gate | Status |
|---|---|
| document ingestion idempotent | PASS (unit idempotency + live rebuild) |
| retrieval returns expected document for evaluation queries | PASS (18/18 live) |
| missing-answer query does not fabricate internal policy | PASS (probes ≤ 0.331 < 0.4 floor; explicit-uncertainty result) |
| result includes source metadata | PASS (unit + live assertions on every hit) |

## Known limitations

- The 0.4 floor is measured on this 20-question eval set with
  all-MiniLM-L6-v2; a different model or corpus needs re-measurement
  (`uv run python -m quickcart.rag.evaluation` prints per-question scores).
  It is env-overridable rather than hard-coded.
- Dense retrieval cannot *prove* absence; the unsupported probes rely on
  off-domain wording. kit/05 §13 stands — quantitative questions belong to
  SQL/analytics, not RAG, and Phase 13 must keep routing them away.
- Natural-language answer generation is deliberately out of scope (kit/05 §13:
  retrieval evaluation before answer polish); `grounded_search` gives the
  Phase 13 agent the evidence-or-uncertainty contract to build on.
- The qdrant-client (1.19.1) / server (1.13.2) version gap prints a
  compatibility warning; REST calls are unaffected. Aligned versions are a
  compose-file concern (pinned there, not owned by this phase).
