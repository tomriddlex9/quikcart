# QuickCart Business Experience — Design Spec

Date: 2026-10-07  
Status: approved (Phase B0 governance)  
Plan source: Business Manager Experience (do not edit the plan file)  
Related: `kit/02_PRD.md` (P5–P9, FR-033–FR-045), ADR-002/003/004, Phase 16 in `kit/03_IMPLEMENTATION_PLAN.md`

## 1. Decisions locked in

- **One app, two experiences.** Ops console stays at `/` (`frontend/app/`, `components/app-shell.tsx`) for Ops/Inventory. Business experience lives under `/b/*` with its own `BusinessShell`. Role decides post-login landing.
- **Visual language unchanged.** Keep Geist + steel-blue tokens in `frontend/app/globals.css` and shadcn base-nova. Add only `--status-good`, `--status-watch`, `--status-bad`.
- **AI presence.** Rare UI Matrix Orb everywhere; voice character = orb body + monochrome SVG face (eyes + mouth driven by audio level). Push-to-talk default; hands-free optional.
- **English only** for UI and assistant in the first release.
- **Gemini opt-in** (ADR-004): text + Live voice when `GEMINI_API_KEY` is set; otherwise Ollama text fallback and voice hidden. Preserves ADR-001 local-first.
- **Safety:** AI may only draft PENDING proposals. Approval requires an on-screen tap by a permitted user — never voice alone.
- **Benchmarks are settings.** Simulator ~50 orders/store/day and 25–40 min delivery promises are below real q-comm; status uses same-weekday-last-week / 4-week average and configurable targets, not absolute industry hardcodes.

## 2. Personas (P5–P9)

| ID | Role | Tech comfort | Primary screens | Example questions |
|---|---|---|---|---|
| P5 | Business Executive (front-line) | 2/5 | `/b/today`, `/b/actions`, `/b/ask` | Why did Bengaluru sales drop? What needs me before noon? |
| P6 | City Business Manager | 3/5 | `/b/stores`, `/b/targets`, `/b/money` | Am I on track this month? Pause this promo? |
| P7 | Dark Store Manager | 2/5 | `/b/stores/[id]`, `/b/products`, mobile tabs | What runs out in 4 hours? Which orders will be late? |
| P8 | Category Manager | 3/5 | `/b/products`, category filters | Are bestsellers available? Did the promo lift units? |
| P9 | Leadership / CXO | 2/5 | `/b/today`, `/b/reports`, voice | City comparison? MTD vs target? |

Ops personas (P2–P3, Admin) keep the existing console. Full PRD write-ups: `kit/02_PRD.md` §5.

**Roles:** `business_exec`, `city_manager`, `store_manager`, `category_manager`, `leadership`, `ops_manager`, `inventory_manager`, `admin`.  
**Scopes:** `company` | `city` | `store` | `category` — enforced server-side on every REST, agent, and voice tool call (never prompt-only).  
**Key rules:** business roles never get `sql:execute` / `copilot:sql_tool`; approver = logged-in principal; admins cannot approve.

## 3. Information architecture (`/b/*`)

| Route | Purpose |
|---|---|
| `/b/welcome` | Onboarding wizard |
| `/b/today` | Home / morning briefing |
| `/b/stores`, `/b/stores/[id]` | League table + store scorecard |
| `/b/products` | Running low / Best sellers / Slow movers |
| `/b/delivery`, `/b/money`, `/b/customers` | Health / revenue waterfall / cohorts |
| `/b/actions` | Suggestions inbox (maps to `/proposals` via ExperienceSwitcher) |
| `/b/targets`, `/b/reports` | V1 pacing + digests |
| `/b/ask` | Full assistant surface |
| `/b/learn` | Guided journeys + glossary |
| `/b/settings` | Prefs + Rare UI credit |
| `/admin/users` | Identity admin |

Desktop: left rail. Mobile: bottom tabs (Today, Stores, Ask orb centre, Actions, More). `ControlDock` is **not** mounted under `/b` (frees bottom-right for the character). Ops pages move under `frontend/app/(ops)/` without URL changes; business under `frontend/app/(business)/b/`.

## 4. Onboarding (7 steps, ~3 min, resumable)

1. Welcome → 2. Pick role → 3. Pick stores/city (pre-filled) → 4. Pin ≤4 headline metrics → 5. Meet assistant (explain mic before browser prompt) → 6. First guided question → real answer card → 7. Set morning briefing time.  
Persisted in `user_preferences`. “Getting started” checklist remains on Today until done.

## 5. Guided journeys A–E

Pattern: each step has a question title; system navigates to the real screen, `Spotlight` dims the rest, ≤2-sentence explanation with the user’s numbers; `JourneyPanel` (side sheet / mobile bottom sheet) holds Back/Next; progress server-saved; voice can narrate.

- **A** How did my store do yesterday? (sales → delivery → bestsellers → today actions) — MVP  
- **B** Find products about to run out and restock → PENDING proposal — MVP  
- **C** Why are deliveries late? (hour → store → pack vs ride → riders → flag ops) — MVP  
- **D** Did my promo work? — V1 (needs redemptions)  
- **E** Prepare my weekly review → auto-drafted report — V1  

## 6. Today layout (top → bottom)

1. Greeting + scope chip + “Updated N min ago”  
2. Morning briefing (Listen / Ask follow-up)  
3. Four `MetricTile`s  
4. Needs your attention (≤5; action + snooze)  
5. Store leaderboard  
6. Today-vs-usual chart  
7. Quick-question chips  
8. Continue: journey-in-progress + checklist  

Every tile: plain name, ₹ lakh/crore value, sentence vs same weekday last week, Good/Watch/Problem (colour+icon+word), ⓘ explainer, “Ask about this”.

**Content rules:** GMV→Sales, AOV→Average basket, SKU→Product, anomaly→Unusual change, forecast→Expected, proposal→Suggestion. Never show Gold/Delta/SQL/IDs/UTC/JSON/probabilities. Answer first; compare to a past period; show as-of; end alerts with a suggested action.

## 7. Assistant answer contract

Model writes words; server renders numbers.

```text
AnswerDraft { headline (refs only e.g. {{c1.value}}), bullets≤3,
  cards[]: kpi|trend|compare|table|risk_list|proposal, follow_ups≤3 }
```

Provenance: every numeric ref must resolve to a tool result; one repair attempt then cards-only. SSE adds `tool_start` / `card` / `followups` (legacy clients still work). Surfaces: `/b/ask`, ⌘K Ask (`?` prefix), “Ask about this” with structured `context`, voice (same conversation via `AssistantProvider`). Tools: `get_metric`, `compare_stores`, `explain_metric_change`, `get_briefing`, `get_alerts`, `get_targets_progress`, `draft_action` (PENDING), `build_report` — all RBAC+scope clamped in `ToolRegistry.execute` (`src/quickcart/agents/`).

## 8. Voice / Matrix Orb / SVG character

- Vendor orb: `npx shadcn@latest add swamimalode07/rare-ui/matrix-orb` → `frontend/components/ui/matrix-orb.tsx`; extend `speaking` + `levelSource`; credit rareui.com in dock footer, `/b/settings` About, README.  
- `POST /api/v1/voice/session` mints single-use ephemeral tokens (`src/quickcart/voice/`); browser WSS to Gemini Live; PCM in 16 kHz / out 24 kHz; toolCall → `POST /api/v1/assistant/tools/{name}` with cookie; cards pushed on-screen.  
- Orb map: connecting/thinking/tool → `thinking`; mic open → `listening` (input RMS); model speaking → `speaking` (output RMS). Levels via ref store (not React state). Reduced motion: static orb + open/closed mouth.  
- Fallback: no key / blocked WS / denied mic → text-only banner; optional Web Speech → text assistant → `speechSynthesis`.

## 9. Semantic registry + serving read model

- **Registry:** `src/quickcart/semantics/metrics.yaml` + `registry.py` — key, plain label, formula, unit, Gold source, direction, thresholds, explainers, synonyms, drivers. Shared by API, agent, UI glossary, generated `docs/data_dictionary/metrics.md`. Fixes duplicate late-rate formulas.  
- **Serving (ADR-003):** `V008` tables `serving.metric_daily|hourly`, `store_scorecard`, `category_daily`, `snapshot_runs`. Job `src/quickcart/business/snapshot.py` after `gold_refresh` in `src/quickcart/live/worker.py` (+ Airflow). Business API reads Postgres, not Spark. Target: `/b/today` p95 &lt; 150 ms locally (measured).  
- **Business API:** `src/quickcart/api/business/` under `/api/v1/b/` — `today`, store scorecards/detail, products, delivery/customers health, money, targets, alerts, journey steps, reports, `metrics/{key}/explain`. Payload shape `MetricValue {label, value, display, delta_pct, compare_to, status, explanation, as_of}`; explanations are templates, not LLM text.

## 10. Migrations V007–V018 (summary)

| Migration | Contents |
|---|---|
| V007 identity | users, roles, permissions, scopes, preferences, sessions, audit |
| V008 serving | serving read-model tables |
| V009 costs/margin | `product_costs`, `order_items.unit_cost` |
| V010 targets/budgets | targets, budgets |
| V011 refunds/wastage | refunds, inventory_batches, wastage_events |
| V012 promo redemptions | promotion_redemptions, promo budget |
| V013 ratings/NPS | order_ratings, nps_responses |
| V014 alerts | alert_rules, alerts, notifications |
| V015 procurement | suppliers, POs, GRNs |
| V016 rider shifts | planned/actual shifts, no-shows |
| V017 assistant/reports/proposals v2 | sessions/messages, llm_usage, saved_reports, widened proposal types |
| V018 CDC | publish new tables |

Simulator: `src/quickcart/simulator/business.py`. New Gold marts in `src/quickcart/lakehouse/gold/marts.py` (scorecard, margin waterfall, category, wastage, customer health, promo, rider productivity, supplier performance).

## 11. Phased delivery B1–B8

| Phase | Goal |
|---|---|
| **B0** | This governance package (docs only) |
| **B1** | Identity & RBAC (`src/quickcart/identity/`, JWT middleware, `/qc-api` rewrite) |
| **B2** | Metric registry + serving snapshot + `/api/v1/b/*` |
| **B3** | Business shell, onboarding, Today/core screens, journeys A–C, Vitest |
| **B4** | Assistant v2 (google-genai tool loop, cards, provenance, Ask UX, eval set) |
| **B5** | Orb + SVG face + Gemini Live + tool bridge + fallbacks |
| **B6** | Data wave 1 (V009–V013) + Targets/Money margin + journey D |
| **B7** | Data wave 2 (V014–V018) + notifications + proposals v2 + journey E |
| **B8** | Playwright, a11y, CI lint/typecheck, docs, clean-clone |

## 12. Success metrics

- Onboarding completion ≥ 80% of first-run demo users  
- Time-to-first-answer (guided or Ask) &lt; 60 s  
- `/b/today` p95 &lt; 150 ms (local, measured)  
- Business eval set: ≥ 90% tool/card accuracy, 100% answer-contract compliance, **zero** scope leaks  
- Voice session success (setup → first audio) when key present; graceful hide when absent  
- Proposal approval always from principal; never auto-approved by voice  

## 13. Open assumptions

1. Simulator seeds targets (4-week avg × 1.05–1.15) and costs; `target:write` users may edit.  
2. Approval limits start as unit thresholds per role; value-based limits after cost data (V1).  
3. `QUICKCART_PUBLIC_DEMO` → persona picker, read-only sessions, voice off.  
4. Digests: in-app first; email via local Mailpit SMTP (not a paid ESP).  
5. Hindi UI deferred; voice may still understand Hinglish via Gemini when enabled.  
6. Rare UI licence: keep copyright + visible rareui.com credit.
