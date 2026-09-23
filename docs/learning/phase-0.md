# Phase 0 — Repository and developer environment

## What was built

Reproducible project skeleton with no business functionality: uv-managed Python 3.12 project
(`src/quickcart` layout), Ruff + Pytest configured and gated, `.env.example` documenting the
full runbook variable set, pydantic-settings `Settings` as the single configuration entry point,
structured logging setup (structlog), a `core`-profile-only Docker Compose file (PostgreSQL
17.11, named volume, healthcheck), a Makefile with working setup/lint/test/compose targets,
root `AGENTS.md`/`README.md`, and the `docs/` + `data/` directory layout.

## How to run

```bash
make setup          # uv sync --all-groups + .env from .env.example
uv run pytest
uv run ruff check .
docker compose config --quiet
```

## How to test / verification executed

- `uv sync --all-groups` — environment installs from `uv.lock` ✅
- `uv run ruff check .` — clean ✅
- `uv run pytest` — 4 passed (smoke + settings) ✅
- `docker compose config --quiet` — valid ✅ (PostgreSQL image pull deferred to Phase 1)

## Concepts learned / demonstrated

- uv project + dependency groups + lockfile as the reproducibility backbone.
- Compose profiles as the resource-isolation mechanism (NFR-002): only `core` exists now.
- Settings pattern: domain code never touches `os.environ` directly.

## Known limitations

- Java 17 and Spark are installed/verified on the host but unused until Phase 3.
- `docker compose --profile core up` intentionally not exercised until Phase 1 schema exists.

## Machine record (for benchmark honesty)

- macOS (Apple Silicon), Docker 29.4.0, uv 0.12.18, OpenJDK 17.0.20.1 (keg-only; `JAVA_HOME=$(brew --prefix openjdk@17)`).
