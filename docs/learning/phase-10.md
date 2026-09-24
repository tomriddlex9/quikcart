# Phase 10 — Analytics dashboard

## What was built

- `src/quickcart/lakehouse/readers.py`: `GoldReaders` — the single read path
  for Gold (KPI summary, orders trend, store comparison/hourly, inventory
  risk, delivery performance, top customers, product performance, quality
  summary). Streamlit (now) and FastAPI (Phase 14) share it — UI/API code
  never touches Spark sessions or paths directly.
- `dashboard/app.py` + `src/quickcart/dashboard_pages.py`: Streamlit app with
  pages Overview, Stores, Inventory, Delivery, Customers, Products,
  Pipeline & Quality — KPIs from Gold only, store filters, explicit empty
  states, Plotly charts. (Phase 14 later appended the Approvals page.)
- `dashboard` dependency group: streamlit, plotly, matplotlib.

## Verification executed (kit/07 Phase 10)

- KPIs from `GoldReaders.kpi_summary()` equal direct aggregates over
  `gold_store_hourly_metrics` (asserted test).
- Store filters never alter metric definitions (filtered rows only contain
  the chosen store; counts > 0).
- `inventory_risk` returns only `is_below_reorder_point` rows.
- Empty-Gold case fails loudly (no fabricated numbers) and every page
  renders against an injected fake-streamlit stand-in (no runtime needed).
- **All gates PASS.**

## What was learned

- Injecting the `st` module into page functions makes the whole UI testable
  without a Streamlit runtime — the pages accept any object with the few
  methods they use.
- KPI definitions live in exactly one place (`metrics.md` + readers), which
  is what makes the "dashboard matches SQL" gate a one-liner.

## Known limitations

- Charts render client-side via Plotly; no server-side caching beyond the
  Spark session.
- The dashboard is read-only by design — all mutations go through the
  FastAPI proposal flow (Phase 14).
