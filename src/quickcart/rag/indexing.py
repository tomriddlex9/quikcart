"""Qdrant indexing (kit/03 Phase 12.3 — load → normalize → chunk → embed → upsert).

Builds (or atomically replaces) the single `quickcart_docs` collection with
cosine distance and one point per chunk. Point ids are deterministic integers
derived from SHA-256 of the chunk id, so rebuilding from the same chunk list is
fully idempotent: same ids, same count, no duplicates. Chunk metadata rides in
the point payload so retrieval can return source attribution (kit/02 RAGR-002).
"""

import hashlib
import json

import structlog
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from quickcart.rag.chunking import Chunk
from quickcart.rag.config import RagSettings
from quickcart.rag.embeddings import Embedder

logger = structlog.get_logger(__name__)

UPSERT_BATCH_SIZE = 128


def point_id_for(chunk_id: str) -> int:
    """Deterministic unsigned 64-bit point id from a chunk id."""
    digest = hashlib.sha256(chunk_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _payload_for(chunk: Chunk) -> dict[str, str]:
    return {
        "chunk_id": chunk.chunk_id,
        "doc_id": chunk.doc_id,
        "title": chunk.title,
        "section_heading": chunk.section_heading,
        "version": chunk.version,
        "effective_date": chunk.effective_date,
        "text": chunk.text,
    }


def build_index(
    chunks: list[Chunk],
    embedder: Embedder | None = None,
    client: QdrantClient | None = None,
    url: str | None = None,
) -> dict:
    """Create or replace the document collection; returns {collection, points}.

    `embedder`, `client`, and `url` are injectable so unit tests can run
    against a local/in-memory Qdrant without Docker or a downloaded model.
    """
    if not chunks:
        raise ValueError("build_index requires at least one chunk")

    settings = RagSettings()
    active_embedder = embedder if embedder is not None else Embedder()
    active_client = client if client is not None else QdrantClient(url=url or settings.qdrant_url)
    collection = settings.collection_name

    vectors = active_embedder.embed([chunk.text for chunk in chunks])
    vector_size = len(vectors[0])

    if active_client.collection_exists(collection):
        active_client.delete_collection(collection)
    active_client.create_collection(
        collection_name=collection,
        vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
    )

    points = [
        PointStruct(id=point_id_for(chunk.chunk_id), vector=vectors[i], payload=_payload_for(chunk))
        for i, chunk in enumerate(chunks)
    ]
    for start in range(0, len(points), UPSERT_BATCH_SIZE):
        batch = points[start : start + UPSERT_BATCH_SIZE]
        active_client.upsert(collection_name=collection, points=batch)

    logger.info(
        "rag_index_built",
        collection=collection,
        points=len(points),
        vector_size=vector_size,
        embedder=active_embedder.model_name,
    )
    return {"collection": collection, "points": len(points)}


def main() -> int:
    """CLI: `uv run python -m quickcart.rag.indexing` rebuilds the index.

    All diagnostics go to stderr so stdout carries only the JSON result.
    """
    import sys

    from quickcart.logging import configure_logging
    from quickcart.rag.embeddings import quiet_embedding_logs

    original_stdout = sys.stdout
    sys.stdout = sys.stderr  # loggers and model-loading noise go to stderr
    try:
        configure_logging()
        quiet_embedding_logs()
        from quickcart.rag.chunking import chunk_documents
        from quickcart.rag.documents import load_documents

        docs = load_documents()
        chunks = chunk_documents(docs)
        result = build_index(chunks)
    finally:
        sys.stdout = original_stdout
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
