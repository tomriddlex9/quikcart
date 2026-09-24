"""Retrieval over internal QuickCart documents (kit/03 Phase 12).

Public contract (consumed by the Phase 13 agent and the FastAPI layer):

- `load_documents` / `Document` / `Section` — versioned Markdown ingestion;
- `chunk_documents` / `Chunk` — deterministic section-aware chunking;
- `Embedder` — local sentence-transformers embeddings with injectable callable;
- `build_index` — idempotent Qdrant collection build;
- `Retriever` / `RetrievedChunk` / `GroundedResult` — scored, metadata-carrying
  search with an explicit-uncertainty path (RAGR-004);
- `run_retrieval_eval` — hit-rate evaluation over the packaged eval set.
"""

from quickcart.rag.chunking import Chunk, chunk_documents
from quickcart.rag.documents import Document, Section, load_documents
from quickcart.rag.embeddings import Embedder
from quickcart.rag.indexing import build_index
from quickcart.rag.retrieve import GroundedResult, RetrievedChunk, Retriever

__all__ = [
    "Chunk",
    "Document",
    "Embedder",
    "GroundedResult",
    "RetrievedChunk",
    "Retriever",
    "Section",
    "build_index",
    "chunk_documents",
    "load_documents",
]
