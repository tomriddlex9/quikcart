# Phase 16 — Business Experience

## What was built

A second, non-technical console for business personas under `/b/*`, alongside the existing ops console at `/`.

- **Identity & RBAC** (`V007`): users, roles, scopes, JWT sessions, demo persona login.
- **Semantic metrics + serving read model** (`V008`): plain-language metric registry, Postgres `serving.*` snapshots, `/api/v1/b/*` API.
- **Business UI**: onboarding, Today, Stores, Products, Delivery, Money, Targets, Customers, Actions, Ask, Learn, Reports, Settings.
- **Assistant v2**: Gemini native tool loop with verified answer cards; Ollama fallback pipeline; `/api/v1/assistant/tools/{name}`.
- **Voice (opt-in)**: Matrix Orb + SVG character, Gemini Live ephemeral tokens (`VOICE_ENABLED` + `GEMINI_API_KEY`).
- **Data waves** (`V009`–`V018`): costs/targets/refunds/wastage/promos/ratings, alerts, suppliers, rider shifts, proposals v2, CDC publication.
- **Simulator backfill**: `python -m quickcart.simulator.business`
- **Alerts engine**: `python -m quickcart.business.alerts`

## How to run

```bash
make core-up && make db-init && make seed-smoke
uv run python -m quickcart.identity.seed
uv run python -m quickcart.simulator.business
uv run python -m quickcart.business.snapshot
uv run python -m quickcart.business.alerts
uv run python -m quickcart.api   # :8000
cd frontend && npm run dev       # :3000

# After API is up, measure Today latency (target p95 < 150 ms):
uv run python -m quickcart.business.bench_today
# Local smoke measurement (2026-10-07): mean 8.3 ms, p95 10.0 ms — pass.
```

Demo logins (password `quickcart`): `exec@quickcart.local`, `city.blr@quickcart.local`, `store8@quickcart.local`, …

Business ⌘K opens Ask/jump; prefix with `?` to ask. Metric tiles expose “Ask about this”.

Set `VOICE_ENABLED=true` and `GEMINI_API_KEY` for the talking character.

## Gold marts (business wave)

Additive Delta marts (beyond the Phase 4 core five):

- `gold_store_scorecard_daily`, `gold_margin_daily`, `gold_category_daily`
- `gold_wastage_daily` (empty until `silver_wastage_events` exists)
- `gold_customer_health_daily`, `gold_promo_daily`

`python -m quickcart.business.snapshot` also upserts `serving.margin_daily` from Postgres.

## Hardening

```bash
make clean-clone-check          # uv sync + ruff + unit pytest + frontend typecheck/vitest
cd frontend && npm run test:e2e:install && npm run test:e2e   # needs API :8000 + Next :3000
```

## Limitations

- Non-RESTOCK proposal types stub-execute (audit only) until full applicators land.
- `silver_wastage_events` / `silver_order_ratings` are optional; Gold writes empty wastage until CDC silver lands.
- Playwright browsers are installed locally (`npm run test:e2e:install`); CI runs typecheck + vitest.
- English only in this release.

## Rare UI credit

The Matrix Orb is modelled on [Rare UI Matrix Orb](https://www.rareui.com/components/matrixorb). Attribution is shown in Settings → About and the Ask page footer.
