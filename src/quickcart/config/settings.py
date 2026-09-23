"""Central application settings.

Every environment-specific value lives here and is fed by environment variables
(or a local `.env` file). Domain code never reads `os.environ` directly.
"""

from functools import lru_cache
from pathlib import Path

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
