# Start Here — Prompt for Cursor / Kimi / Coding Agent

Copy the prompt below into the coding agent after placing this specification package at the root of the project/repository.

---

## Initial implementation prompt

You are implementing the **QuickCart Intelligence Platform**, a staged local-first learning project for Python, SQL, PySpark, Delta Lake, streaming, CDC, ML, RAG, and agentic AI.

Before making any changes, read these files completely:

1. `README.md`
2. `PROJECT_MANIFEST.md`
3. `01_ARCHITECTURE_AND_TECH_STACK.md`
4. `02_PRD.md`
5. `03_IMPLEMENTATION_PLAN.md`
6. `04_DATA_MODEL_AND_EVENTS.md`
7. `05_AI_EDITOR_HANDOFF.md`
8. `06_SETUP_AND_RUNBOOK.md`
9. `07_TESTING_AND_ACCEPTANCE.md`
10. `AGENTS.md`
11. `TASKS.md`

The current active milestone is **Phase 0 — Repository and developer environment**.

Implement Phase 0 only. Do not install or configure later-phase services such as Redpanda, Debezium, Airflow, MLflow, Qdrant, Ollama, LangGraph, Prometheus, or Grafana yet.

### Required Phase 0 outcome

Create a clean repository foundation with:

- Python 3.12 project managed with `uv`
- `pyproject.toml`
- dependency lockfile
- `src/quickcart/` package structure
- Pytest
- Ruff
- `.gitignore`
- `.env.example`
- Docker Compose skeleton suitable for later profiles
- Makefile or equivalent documented task commands
- basic structured configuration approach
- smoke test
- updated README with exact setup/lint/test commands

### Engineering constraints

- local-first and zero-cost
- no cloud dependencies
- no secrets committed
- no unnecessary frameworks
- no placeholder implementation pretending later phases exist
- type hints for new Python code
- tests required
- preserve the architecture and phase boundaries in the supplied docs

### Verification

Before reporting completion, run the relevant commands, including at minimum:

```bash
uv run ruff check .
uv run pytest
```

Also validate the Docker Compose file if Docker is available.

### Completion response

Return:

1. What you implemented
2. Files added/changed
3. Exact commands to set up and run
4. Tests/validation actually executed and their result
5. Any limitation or environment-specific issue
6. Updated Phase 0 checklist state
7. Recommended next task: Phase 1, but do not implement it yet

Do not claim completion if the tests or setup verification failed.
