# QuickCart Console

Showcase operations console for the QuickCart Intelligence Platform — a Next.js (App Router,
TypeScript, Tailwind CSS 4) frontend over the Phase 14 FastAPI service boundary.

Dark, console-styled UI with one job: make the local-first 15-phase platform legible and
prove it is real. Live data comes from the FastAPI service; every fetch failure falls back
to clearly-labeled synthetic demo data — never passed off as live.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (type-checked)
npm run start    # serve the production build
```

Point the console at a different API with:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

(`http://localhost:8000` is the default.)

## Pages

| Route | What it shows |
|---|---|
| `/` | KPI cards, orders-per-day trend (area + GMV line), GMV by store. Polls every 30s. |
| `/agent` | Chat console for the operations assistant: answers with evidence + tool trace, inline proposal approvals. Handles the 503 "agent not available" case honestly. |
| `/system` | Interactive system map — 18 hand-positioned nodes, SVG data-flow edges (CDC / streaming / batch / RAG / serving), click for role + phase + key facts. |
| `/tech` | Every pinned technology: version, role, phase introduced (from `kit/01` §4). |
| `/proposals` | Human approval queue: status filters, detail drawer, approve/reject with named approver, audit trail. |
| `/logs` | Service health, gold-table presence, phase checklist from `/api/v1/system/status`, quarantine note. |
| `/streamlit` | Home for the Phase 10 Streamlit dashboard (it sends `X-Frame-Options: DENY`, so it opens in a tab). |

## Contract alignment

Types in `lib/types.ts` mirror the FastAPI `/api/v1` contract. The API is consumed
defensively: unknown fields are ignored, missing collections render as empty states, and
errors are shown with what to do next.

## Design

Fraunces (display) + IBM Plex Mono (console body) via `next/font`. Warm-paper-on-ink
palette with amber/teal accents; hairline panels, no shadows. The map and tech grid are
generated from static data files (`lib/system-map.ts`, `lib/tech-stack.ts`) — no graph
libraries.
