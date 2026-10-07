"""Shared identity fixtures: in-memory store, cheap settings, seeded service."""

import pytest

from quickcart.config.settings import Settings
from quickcart.identity.service import IdentityService
from quickcart.identity.store import InMemoryIdentityStore


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        auth_secret="unit-test-secret-unit-test-secret-32b",
        demo_user_password="demo-pass",
        public_demo=False,
        demo_login_enabled=True,
        auth_enforce=False,
    )


@pytest.fixture
def store() -> InMemoryIdentityStore:
    return InMemoryIdentityStore()


@pytest.fixture
def service(store: InMemoryIdentityStore, settings: Settings) -> IdentityService:
    svc = IdentityService(store, settings)
    svc.seed_demo_users()
    return svc
