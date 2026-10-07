# ADR-002 — Business experience and RBAC

## Status

Accepted.

## Context

QuickCart today has a technical ops console (`frontend/` routes at `/`, `components/app-shell.tsx`) and a hardcoded cookie gate (`frontend/lib/session.ts`, `frontend/middleware.ts`) with no backend identity. Non-technical business personas (PRD P5–P9) need a separate plain-language experience, while Ops and Inventory managers keep the existing console. Spark SQL and agent tools have no row-level security, so letting business roles run free-form SQL would leak scoped data. Proposal approval currently accepts a free-text approver field, which cannot bind accountability to a real user.

## Decision

- Ship **one Next.js app with two experiences**: ops at `/`, business under `/b/*` with `BusinessShell`, role-based post-login landing.
- Introduce real identity in Postgres (`V007__identity.sql`, package `src/quickcart/identity/`): users, roles, permissions, scopes (`company` | `city` | `store` | `category`), preferences, sessions, audit (channel: web / agent / voice).
- Authenticate with argon2 password hashes and an HS256 JWT in an httpOnly `qc_session` cookie. FastAPI dependencies `get_principal()`, `require_permission()`, and `scope_filter()` enforce every business, assistant, and voice tool call. Frontend middleware verifies JWT (`jose`) and rewrites `/qc-api/*` same-origin.
- Roles: `business_exec`, `city_manager`, `store_manager`, `category_manager`, `leadership`, `ops_manager`, `inventory_manager`, `admin`. Business roles never receive `sql:execute` or `copilot:sql_tool`. Approver identity comes from the principal. Admins do not approve by default.
- Seed one demo user per persona; public demo mode may offer a read-only persona picker with voice off.

## Consequences

### Positive

- Server-enforced scope closes prompt-only and cache-key leakage paths
- Clear landing and IA for non-technical managers without breaking the ops teaching console
- Auditable approvals bound to real users

### Negative

- Migration and middleware work before Business UI can ship
- Demo/login UX becomes slightly heavier than the hardcoded gate
- Permission matrix must stay covered by automated tests

## Follow-up

Phase 16 B1 implements identity; B3+ consume it. See design spec `docs/superpowers/specs/2026-10-07-business-experience-design.md` and FR-033/FR-034.
