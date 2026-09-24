"""RAG runtime configuration.

All environment-specific values for the retrieval package live here and are fed
by `QUICKCART_*` environment variables (or a local `.env` file). Domain code in
this package never reads `os.environ` directly.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class RagSettings(BaseSettings):
    """Settings for the document-retrieval components (kit/03 Phase 12)."""

    model_config = SettingsConfigDict(
        env_prefix="QUICKCART_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Local sentence-transformers model (kit/03 §12.3 — model name is config, not code)
    embedding_model: str = "all-MiniLM-L6-v2"

    # Qdrant REST endpoint (docker compose `ai` profile)
    qdrant_url: str = "http://127.0.0.1:6333"

    # Single collection for internal policy/SOP knowledge (kit/02 RAGR-002)
    collection_name: str = "quickcart_docs"

    # Cosine-similarity floor below which retrieval is treated as "no evidence"
    # (kit/02 RAGR-004 — explicit uncertainty instead of fabrication).
    # 0.4 is measured, not guessed: on the packaged eval set with the default
    # all-MiniLM-L6-v2 model, every must-answer question scores >= 0.54 while
    # off-domain probes score <= 0.33 (see docs/learning/phase-12.md).
    min_score: float = 0.4
