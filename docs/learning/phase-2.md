# Phase 2 — SQL analytics foundation

## What was built

A 30-question SQL exercise catalog over the operational schema, plus the metric
dictionary that pins business definitions before Spark exists.

- `sql/exercises/beginner/` (10): revenue by store, orders by day/hour, top products,
  payment statuses, cancellations, top customers, basket size, riders per store,
  active promotions.
- `sql/exercises/intermediate/` (10): AOV by store/category, repeat rate, rider
  utilization, SLA by hour, promotion redemption, stock movements, category share
  (windowed), payment failure rates, fulfillment segment timing, weekend vs weekday.
- `sql/exercises/advanced/` (10): monthly cohort retention, order funnel, rolling 7-day
  revenue, WoW cancellation change, RANK **and** ROW_NUMBER within category, store
  percentile, inventory cover days, RFM segments, LAG/LEAD day-over-day delivery
  minutes, late-delivery leaderboard with `percentile_cont`.
- Every file carries a header: business question, assumptions, edge cases
  (kit/05 §4.7). Runner: `src/quickcart/sql/runner.py` (discover → execute →
  row-count gate + static construct coverage).
- `docs/data_dictionary/metrics.md`: GMV (cancelled excluded, refunds included),
  AOV, cancellation rate, late-delivery rate, payment failure rate, repeat rate,
  stock cover, funnel stages, time conventions.

## How to run / test

```bash
uv run pytest tests/integration/test_sql_exercises.py   # executes all 30 + gates
uv run python -c "from quickcart.sql.runner import run_all; print(run_all().passed)"
```

## Verification executed

- All 30 exercises execute with ≥1 row on both smoke (500 orders) and full
  (97,824 orders) datasets.
- Coverage: 15 joins, 28 aggregations, 20 CTEs, 7 window functions, ROW_NUMBER,
  RANK, LAG, LEAD, 1 rolling window, 2 cohort/funnel, 11 conditional aggregations
  (`FILTER (WHERE ...)`).

## What was learned

- Ambiguity bites twice: a cohort query with `GROUP BY cohort_month` collided
  across two CTEs — qualify every derived column through the query path.
- `FILTER (WHERE ...)` beats `SUM(CASE ...)` for readable conditional aggregates.
- RANK vs ROW_NUMBER is a tie-semantics lesson, not just syntax — the exercise set
  demonstrates both side by side.

## Known limitations

- Cohort retention is limited to m1/m2 to keep queries reviewable; full-month
  matrices are a Gold-mart concern (Phase 4+).
- Inventory cover uses a 14-day movement window; the hourly-grain mart formalises
  this later.
