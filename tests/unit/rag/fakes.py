"""Shared test doubles for the RAG unit tests.

`FakeEmbedder` produces deterministic pseudo-vectors (hashed bag-of-words,
L2-normalized) so tests never download a sentence-transformers model, while
still exercising real Qdrant cosine scoring through the local in-memory mode.
"""

import hashlib
import math
import re

from qdrant_client import QdrantClient

from quickcart.rag.documents import Document, Section

_TOKEN_RE = re.compile(r"[a-z0-9]+")


class FakeEmbedder:
    """Deterministic embedder: tokens hashed into fixed buckets, L2-normalized.

    Cosine similarity between two texts approximates token overlap, which is
    enough to test ranking correctness and out-of-scope behaviour.
    """

    model_name = "fake-hash-bow"

    def __init__(self, dim: int = 64) -> None:
        self._dim = dim

    @property
    def dimensions(self) -> int:
        return self._dim

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self._dim
        for token in _TOKEN_RE.findall(text.lower()):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            vector[digest[0] % self._dim] += 1.0
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0.0:
            # Texts without a single token still need a usable vector: derive
            # one from the raw bytes so embeddings stay deterministic.
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            vector[digest[0] % self._dim] = 1.0
            norm = 1.0
        return [value / norm for value in vector]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]


def memory_client() -> QdrantClient:
    """In-memory Qdrant — real scoring path, no Docker, no network."""
    return QdrantClient(":memory:")


def make_document(doc_id: str, sections: dict[str, str], **overrides: str) -> Document:
    """Build a Document from a {heading: text} mapping for synthetic tests."""
    return Document(
        doc_id=doc_id,
        title=overrides.get("title", doc_id.replace("_", " ").title()),
        version=overrides.get("version", "1.0"),
        effective_date=overrides.get("effective_date", "2026-01-01"),
        sections=[Section(heading=heading, text=text) for heading, text in sections.items()],
    )
