# QuickCart dashboards (`/solution`)

A focused version of QuickCart: two personas, three sub-personas each, one dashboard per sub-persona. It runs on the frontend alone (no backend, database or Docker) and shows **only the bundled dummy data**. Any widget the dummy data cannot fill is shown as **"No data yet"**. Nothing is invented.

## Run it

| Step | How |
|---|---|
| Start | Double-click `start-solution.cmd` in the repo root. It builds once (2–3 minutes), starts the app and opens `http://localhost:3000/solution`. |
| Stop | Close the command window. |
| After changing code | `start-solution.cmd rebuild` |
| Needs | Node.js 20+ and `npm ci` already run in `frontend/`. Internet only for the map background (OpenStreetMap). |

`/solution` opens without login (see `frontend/middleware.ts`).

## Layout

- **Header:** a **Business | Operations** switch.
- **Left menu:** the three dashboards for the current side.
- **Page header:** the dashboard's question and the dummy-data date.

Direct addresses: `/solution?role=revenue`, `/solution?role=store`, `/solution?view=ops`, `/solution?view=ops&role=inventory`, `/solution?view=ops&role=data`.

## Where the data comes from

The full platform has two dummy-data sets: one for the business console and one for the ops console. Each persona here uses the set its console uses, so each persona is consistent within itself. The store lists differ between the two personas.

| Persona | Dummy data | Stores | Date |
|---|---|---|---|
| Business | `frontend/lib/business/demo-business.ts` (via `demoBusinessPayload`) | 8 neighbourhood stores (Koramangala, HSR Layout, Bandra West…) | 7 Oct 2026 |
| Operations | `frontend/lib/demo.ts`, `geo-demo.ts`, `live-types.ts`, `layer-cube-types.ts`, `model-cards.ts` | 10 stores, one per city | 22 Sep 2026 |

`frontend/lib/solution-data.ts` only reads, joins (store id → city) and formats these.

## Dashboards

✅ filled from dummy data · ⬜ "No data yet"

### Business

| Dashboard | Widgets |
|---|---|
| **Leadership** (Meera Kapoor) | ✅ Today vs same day last week: sales, orders, average basket, on-time, cancellations, delivery time, items about to run out, active and repeat customers · ✅ sales, last 14 days · ✅ monthly target pacing, net sales, discounts, refunds · ✅ needs-attention list · ⬜ demand forecast |
| **Business & Revenue Manager** (Karan Mehta) | ✅ sales, basket, active and repeat customers · ✅ scorecard of all 8 stores; click a store for its hourly and 14-day sales · ✅ sales by store, city and category · ✅ bestsellers · ✅ customers and top customers |
| **Store Manager** (Priya Nair) | ✅ store picker for all 8 stores (opens on Jayanagar) · ✅ the selected store's KPIs vs last week, sales by hour and last 14 days · ✅ all stores at a glance (click to switch) · ✅ running-low products for all stores, the selected store first · ✅ orders in progress and riders (all stores) · ⬜ orders likely to be late · ⬜ store demand forecast |

### Operations

| Dashboard | Widgets |
|---|---|
| **Operations Manager** (Rohit Shah) | ✅ orders, GMV, late, cancellations, deliveries in progress, payment failures, open tickets · ✅ orders and cancellations, last 30 days · ✅ store performance + late-rate map · ✅ live orders per minute and order status · ✅ 5 anomalies · ✅ late-delivery prediction explained (order #88041: probability vs the store's usual late rate, outcome, what the model looks at) · ✅ late-delivery risk by city (a stated rule, not the ML model) · ⬜ open orders at risk |
| **Inventory & Planning** (Ishita Das) | ✅ products below reorder, emergency restocks, forecast error, restocks waiting · ✅ inventory risk with stock cover, risk and restock quantity (where a proposal exists) · ✅ demand forecast vs actual (table and chart) · ✅ restock and action proposals · ⬜ demand forecast over time |
| **Data & Model Health** (Tom Riddle) | ✅ quality score, refresh lag, quarantine, Gold rows · ✅ medallion pipeline: rows, tables and steps per layer · ✅ pipeline stages · ✅ recent activity · ✅ models: type, baseline, candidate, metrics · ⬜ latest model scores · ⬜ model accuracy over time · ⬜ data quality over time |

## Choices made on the dummy data

- **Sales trends show one series.** In the dummy data, sales move in step with orders, so two series would draw on top of each other.
- **Slow movers are not shown.** In the business dummy data they repeat the bestseller products.
- **Emergency restock** = stock cover under 4 hours, the threshold in the Inventory SOP (`src/quickcart/rag/fixtures/inventory_sop.md`).
- **Late-rate colours** on the ops map and table: red above 9%, amber above the network average, green at or below it.
- **Late-delivery risk by city** is a rule, labelled as such on the page. *High*: late rate above 9% or an open delivery-time alert. *Medium*: late rate above the network average. *Low*: otherwise. The dummy data has only one ML-scored order, so per-order predictions stay in the "Open orders at risk" panel until the model runs.
- **Chart animations are off,** so charts are always fully drawn, including after a window resize or a projector switch.

## Files

| File | Purpose |
|---|---|
| `frontend/app/solution/page.tsx` | Route |
| `frontend/components/solution/solution-page.tsx` | Header, persona switch, left menu, page header |
| `frontend/components/solution/business-pages.tsx` | Leadership, Business & Revenue Manager, Store Manager |
| `frontend/components/solution/ops-pages.tsx` | Operations Manager, Inventory & Planning, Data & Model Health |
| `frontend/components/solution/widgets.tsx` | Panel, empty panel, KPI tiles, trend and bar charts, bar list, status badge, table |
| `frontend/components/solution/network-map-leaflet.tsx` | City map |
| `frontend/lib/solution-data.ts` | Reads and joins the dummy data; menu |
| `frontend/middleware.ts` | One line: `/solution` needs no session |
| `start-solution.cmd` | Build-once-and-start script |

Nothing else in the existing app was changed.

## Filling the empty widgets later

The empty widgets correspond to outputs of the real pipeline and models: demand forecasts over time, per-order late predictions, hourly late-delivery breakdowns, model scores from MLflow, and data-quality history. Once the backend runs, these dashboards can read the platform's API (`/api/v1/...`) instead of the dummy data.
