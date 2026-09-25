# QuickCart console overhaul — master plan

Date: 2026-09-25  
Status: execute immediately (user: plan then build without asking)

## Design direction

Quick-commerce **ops floor console**, not a SaaS marketing dashboard.

| Token | Choice |
|---|---|
| Color | Cool paper / ink: light `#F3F5F7` bg, `#0E1218` ink; dark `#0B0E12` bg, `#E8EDF2` ink; accent steel-blue `#3B6FA0` (not purple) |
| Type | Geist Sans + Geist Mono (already wired) |
| Layout | Dense instrument panel; team lens switches which instruments light up |
| Motion | Skeletons + measure fills + cube morphs; respect `prefers-reduced-motion` / UI toggle |

Avoid: purple gradients, cream+terracotta, broadsheet, emoji chrome, identical soft cards everywhere.

## Workstreams (parallel)

### W1 — Simulation control plane (API + writer)
- Postgres table or file-backed `sim_control`: `running`, `orders_per_minute`, `cancel_rate`, `payment_fail_rate`, `inventory_churn`, `rider_ping_hz`, `ticket_rate`, `burst_factor`
- `GET/POST /api/v1/sim/status|start|stop|config`
- `live_writer` polls control every 2s and adjusts rate/behavior
- Frontend ControlDock: start/stop, sliders, impact preview (orders→PG→bronze lag)

### W2 — Theme + UI modifiers + team lens
- `next-themes` ThemeProvider (light/dark/system)
- Preferences: density (`comfortable|compact`), radius, accent (`steel|teal|amber`), reduced motion, nav compact
- Persist in `localStorage` (`qc_prefs_v1`)
- Team lens: `ops | data | ml | support | exec` reshapes home modules + sidebar emphasis
- Preferences sheet in AppShell header

### W3 — Home command center
- KPI wall: GMV, orders, AOV, cancel %, late %, stockouts, active riders, payment fail, ticket open, anomaly count, forecast accuracy, proposal pending
- Charts: orders+GMV trend, store bar, status mix, cancel/late dual axis, inventory risk sparkline, live 15m area
- Activity log: SSE + pipeline + proposals + anomalies merged
- Skeleton-first loading for every block
- Team lens filters which blocks show

### W4 — Layers + Cube (medallion showcase)
- `/layers` ops impact workbench
- `/cube` Three.js OLAP cube
- APIs `/api/v1/layers/*`, `/api/v1/cube/*`
- Lineage expansion for weather/news/riders/tickets/escalations

### W5 — Skeleton + polish pass
- Shared `ChartSkeleton`, `KpiSkeleton`, `LogSkeleton`, `TableSkeleton`
- Apply across live/ml/database/overview

### W6 — Medallion contracts (backend)
- Expand `lineage_map`, news ingest stub, schemas stubs, register routes

## Acceptance
- [x] Light/dark toggle works; prefs persist
- [x] Team lens changes home composition
- [x] Home shows ≥12 KPIs, ≥5 charts, live log
- [x] Skeletons visible on slow/demo path
- [x] Sim start/stop + rate slider changes writer behavior (or demos impact when writer offline)
- [x] `/layers` and `/cube` navigable
- [x] `npm run typecheck` clean; unit tests for sim + layers APIs
- [x] Vercel prod redeployed (https://frontend-gamma-ruddy-66.vercel.app)
