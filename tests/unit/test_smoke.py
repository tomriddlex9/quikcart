import pytest

import quickcart
from quickcart.config.settings import Settings


@pytest.mark.unit
def test_package_version_exists() -> None:
    assert quickcart.__version__


@pytest.mark.unit
def test_settings_load_with_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER"):
        monkeypatch.delenv(var, raising=False)
    settings = Settings(_env_file=None)
    assert settings.postgres_db == "quickcart"
    assert settings.storage_backend == "local"


@pytest.mark.unit
def test_settings_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTGRES_DB", "quickcart_test")
    monkeypatch.setenv("QUICKCART_STORAGE_BACKEND", "local")
    settings = Settings(_env_file=None)
    assert settings.postgres_db == "quickcart_test"
    assert settings.storage_backend == "local"


@pytest.mark.unit
def test_database_dsn_uses_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTGRES_PORT", "55432")
    settings = Settings(_env_file=None)
    dsn = settings.database_dsn
    assert "port=55432" in dsn
    assert "dbname=quickcart" in dsn
