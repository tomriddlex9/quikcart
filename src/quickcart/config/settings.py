"""Central application settings.

Every environment-specific value lives here and is fed by environment variables
(or a local `.env` file). Domain code never reads `os.environ` directly.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the current phase-activated components."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "local"
    log_level: str = "INFO"

    # PostgreSQL operational source (core profile)
    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5432
    postgres_db: str = "quickcart"
    postgres_user: str = "quickcart_app"
    postgres_password: str = "quickcart_app_dev"

    # Local data root for raw/bronze/silver/gold/quarantine/checkpoints/artifacts
    data_root: Path = Path("./data")

    # Lakehouse storage backend (`local` now, `s3` arrives in Phase 6)
    storage_backend: str = "local"

    # S3-compatible object storage (Phase 6, SeaweedFS)
    s3_endpoint: str = "http://127.0.0.1:8333"
    s3_access_key: str = "quickcart_dev"
    s3_secret_key: str = "quickcart_dev_secret"
    s3_bucket: str = "quickcart-lakehouse"

    # Streaming (Phase 7, Redpanda)
    redpanda_bootstrap_servers: str = "127.0.0.1:9092"

    # Local LLM (Phase 13, Ollama) — model choice is configuration, never hard-coded
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:1.5b"

    # Google Gemini (preferred for NL→SQL on the /query console)
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_model: str = "gemini-3.8-flash"

    # Gemini Live voice (Phase B5). Off unless explicitly enabled *and* a key is set.
    gemini_live_model: str = "gemini-3.8-live"
    gemini_live_voice: str = "Aoede"
    voice_enabled: bool = False
    # How long a minted ephemeral token may open its (single) session.
    voice_token_ttl_seconds: int = 120
    # Hard cap on one voice session's length (the client closes at this mark).
    voice_max_session_seconds: int = 600

    # xAI Grok (optional OpenAI-compatible chat calls)
    xai_api_key: str = ""
    xai_base_url: str = "https://api.x.ai/v1"
    xai_model: str = "grok-3-mini"

    # Identity & RBAC (Phase B1)
    auth_secret: str = "quickcart-dev-secret-change-me"
    # False keeps the pre-auth console/tests working (anonymous = synthetic admin);
    # True requires a valid qc_session cookie and enforces permissions.
    auth_enforce: bool = False
    auth_token_ttl_hours: int = 12
    demo_user_password: str = "quickcart"
    # Public showcase: demo sessions can never approve proposals.
    public_demo: bool = Field(
        default=False, validation_alias=AliasChoices("quickcart_public_demo", "public_demo")
    )
    # Passwordless persona picker (/api/v1/auth/demo-login). Disable in real deployments.
    demo_login_enabled: bool = True

    # Ordered, versioned DDL migration scripts
    migrations_dir: Path = Path("infrastructure/postgres/migrations")

    @property
    def database_dsn(self) -> str:
        """libpq-style DSN for psycopg (no inline secrets in logs)."""
        return (
            f"host={self.postgres_host} "
            f"port={self.postgres_port} "
            f"dbname={self.postgres_db} "
            f"user={self.postgres_user} "
            f"password={self.postgres_password}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
