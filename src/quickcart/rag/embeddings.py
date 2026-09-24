"""Embedding adapter (kit/03 Phase 12.3 — local, zero-cost embeddings).

The default implementation loads a local sentence-transformers model whose name
comes from `QUICKCART_EMBEDDING_MODEL` (default `all-MiniLM-L6-v2`) — never a
remote API. An injectable `encode_fn` callable is mandatory support so unit
tests and downstream agents can substitute deterministic embeddings without
downloading a model (kit/07 Phase 12 test rules).
"""

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from quickcart.rag.config import RagSettings

if TYPE_CHECKING:
    import numpy as np

EncodeFn = Callable[[list[str]], list[list[float]]]

_NOISY_LOGGERS = ("httpx", "httpcore", "huggingface_hub", "sentence_transformers", "torch")


def quiet_embedding_logs() -> None:
    """Keep model-loading noise out of CLI stdout so printed JSON stays parseable."""
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


class Embedder:
    """Turns text batches into dense vectors.

    Exactly one of two modes is active:

    - model mode (`encode_fn=None`): loads the configured local
      sentence-transformers model lazily at construction;
    - injected mode: delegates to the supplied `encode_fn`, no model import at
      all (unit tests, deterministic evaluation).
    """

    def __init__(self, model: str | None = None, encode_fn: EncodeFn | None = None) -> None:
        self._settings = RagSettings()
        self._encode_fn = encode_fn
        self._model_name = model or self._settings.embedding_model
        if encode_fn is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:  # pragma: no cover - depends on env
                raise RuntimeError(
                    "sentence-transformers is required for the default Embedder; "
                    "install the 'ai' dependency group or inject encode_fn"
                ) from exc
            self._model: SentenceTransformer | None = SentenceTransformer(self._model_name)
        else:
            self._model = None

    @property
    def model_name(self) -> str:
        """Human-readable model identifier (`injected` for test doubles)."""
        return "injected" if self._encode_fn is not None else self._model_name

    @property
    def dimensions(self) -> int | None:
        """Vector size when known up front; `None` for injected callables."""
        if self._model is None:
            return None
        return int(self._model.get_sentence_embedding_dimension())

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts into a list of equal-length float vectors."""
        if not texts:
            return []
        if self._encode_fn is not None:
            vectors: list[list[float]] | np.ndarray = self._encode_fn(texts)
        else:
            if self._model is None:  # pragma: no cover - constructor guarantees
                raise RuntimeError("Embedder has neither model nor encode_fn")
            vectors = self._model.encode(list(texts), convert_to_numpy=True)

        out = [[float(value) for value in vector] for vector in vectors]
        if len(out) != len(texts):
            raise ValueError(f"embedder returned {len(out)} vectors for {len(texts)} texts")
        sizes = {len(vector) for vector in out}
        if len(sizes) != 1:
            raise ValueError(f"embedder returned inconsistent vector dimensions: {sorted(sizes)}")
        for index, vector in enumerate(out):
            if not any(vector):
                raise ValueError(
                    f"embedder returned an all-zero vector at index {index}; "
                    "cosine scoring would be undefined"
                )
        return out
