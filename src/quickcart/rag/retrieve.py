"""Dense retrieval over the `quickcart_docs` collection (kit/03 Phase 12.4).

Every hit carries its full source metadata plus its similarity score
(kit/02 RAGR-002). `grounded_search` is the RAGR-004 primitive used by the
Phase 13 agent: when nothing clears the score floor it returns an explicit
`supported=False` with an uncertainty message instead of fabricating policy.
"""

from dataclasses import dataclass

import structlog
from qdrant_client import QdrantClient

from quickcart.rag.chunking import Chunk
from quickcart.rag.config import RagSettings
from quickcart.rag.embeddings import Embedder

logger = structlog.get_logger(__name__)

UNSUPPORTED_MESSAGE = (
    "No indexed internal document provides sufficient evidence to answer this "
    "question; the answer is not fabricated."
)

_PAYLOAD_FIELDS = (
    "chunk_id",
    "doc_id",
    "title",
    "section_heading",
    "version",
    "effective_date",
    "text",
)


@dataclass(frozen=True)
class RetrievedChunk(Chunk):
    """A retrieved chunk with its similarity score."""

    score: float


@dataclass(frozen=True)
class GroundedResult:
    """Evidence bundle for one query — never an invented answer.

    `supported` is False exactly when no chunk clears `min_score`; `message`
    then carries the explicit-uncertainty text (RAGR-004).
    """

    query: str
    chunks: list[RetrievedChunk]
    supported: bool
    message: str | None = None


def _to_retrieved(payload: dict, score: float) -> RetrievedChunk:
    missing = [field for field in _PAYLOAD_FIELDS if field not in payload]
    if missing:
        raise ValueError(f"point payload missing fields {missing}")
    return RetrievedChunk(
        chunk_id=payload["chunk_id"],
        doc_id=payload["doc_id"],
        title=payload["title"],
        section_heading=payload["section_heading"],
        version=payload["version"],
        effective_date=payload["effective_date"],
        text=payload["text"],
        score=score,
    )


class Retriever:
    """Embeds a query and searches the document collection.

    `url`, `embedder`, and `client` are injectable so unit tests run fully
    offline against an in-memory Qdrant and a deterministic embedder.
    """

    def __init__(
        self,
        url: str | None = None,
        embedder: Embedder | None = None,
        client: QdrantClient | None = None,
    ) -> None:
        settings = RagSettings()
        self._embedder = embedder if embedder is not None else Embedder()
        if client is not None:
            self._client = client
        else:
            self._client = QdrantClient(url=url or settings.qdrant_url)
        self._collection = settings.collection_name
        self._min_score = settings.min_score

    @property
    def collection(self) -> str:
        return self._collection

    def search(
        self, query: str, k: int = 5, min_score: float | None = None
    ) -> list[RetrievedChunk]:
        """Return the top-k chunks for `query`, best score first.

        With `min_score` set, hits below the floor are dropped — an
        out-of-scope question then yields an empty list rather than
        low-relevance padding.
        """
        if not query.strip():
            raise ValueError("query must be a non-empty string")
        if k <= 0:
            raise ValueError(f"k must be positive, got {k}")

        vector = self._embedder.embed([query])[0]
        response = self._client.query_points(
            collection_name=self._collection,
            query=vector,
            limit=k,
            with_payload=True,
        )
        hits = [
            _to_retrieved(point.payload, float(point.score)) for point in response.points
        ]
        hits.sort(key=lambda hit: hit.score, reverse=True)
        if min_score is not None:
            hits = [hit for hit in hits if hit.score >= min_score]
        logger.debug(
            "rag_search",
            query=query,
            k=k,
            min_score=min_score,
            returned=len(hits),
            top_score=round(hits[0].score, 4) if hits else None,
        )
        return hits

    def grounded_search(
        self,
        query: str,
        k: int = 5,
        min_score: float | None = None,
    ) -> GroundedResult:
        """Evidence-or-uncertainty retrieval (kit/02 RAGR-004).

        Applies the configured score floor (overridable per call). When no
        chunk clears the floor the result is `supported=False` with an explicit
        uncertainty message — the caller must not answer from nothing.
        """
        floor = self._min_score if min_score is None else min_score
        hits = self.search(query, k=k, min_score=floor)
        if hits:
            return GroundedResult(query=query, chunks=hits, supported=True)
        return GroundedResult(
            query=query, chunks=[], supported=False, message=UNSUPPORTED_MESSAGE
        )
