# Metric dictionary

Definitions for every business metric used in the SQL exercise catalog
(kit/02 §10). Gold marts (Phase 4) must reuse these definitions; dashboards
(Phase 10) display them. Any metric not listed here needs a definition before
it appears in an analysis.

## Money and revenue

### GMV (gross merchandise value)
Sum of `orders.total_amount` over orders with `status <> 'CANCELLED'`.
Refunded orders **stay included** (the sale was realised; the refund is a
downstream event). Analyses that need net revenue must say so explicitly
(net revenue = GMV − refunds, where refunds = `total_amount` of
`status = 'REFUNDED'` orders).

### AOV (average order value)
`avg(total_amount)` over the same population as GMV. Always report the
population (per store, per category-mix order, per day) alongside the value.

### Discount cost
Sum of `orders.promo_discount` (promo-driven) — `item_discount` is reserved
for line-level promotions and is 0 in the current simulator.

## Rates

### Cancellation rate
`count(status = 'CANCELLED') / count(*)` over **all placed orders** in the
window. Numerator and denominator both from `orders`; event-time window from
`placed_at`.

### Late delivery rate
`count(delivered_at > promised_by) / count(*)` over **DELIVERED deliveries
only** (cancelled deliveries have no realised lateness). Promised SLA is the
store-level SLA baked into `promised_by` at order time (25–40 minutes).

### On-time rate
1 − late delivery rate (same population).

### Payment failure rate
`count(status = 'FAILED') / count(*)` over **payment attempts** (not orders —
an order can attempt twice). Per-method rates are comparable only with
attempt volumes alongside.

### Repeat rate
Customers with ≥ 2 orders / customers with ≥ 1 order, over the chosen window.

## Inventory

### Stock cover (days)
`on_hand_qty / average units sold per day` over a documented demand window
(exercise set: trailing 14 days of SALE movements). NULL when there are no
recent sales. Phase 4's `gold_inventory_health` uses an hourly grain.

## Funnel stages (exercise set)

- **placed**: all orders.
- **fulfilled**: `status IN ('DELIVERED', 'REFUNDED')` (payment succeeded and
  the order left the store).
- **delivered**: `status = 'DELIVERED'`.
- Side paths: **cancelled** (`'CANCELLED'`), **refunded** (`'REFUNDED'`).

## Time conventions

All event times are UTC (`placed_at`, `delivered_at`, …). "Day" =
`date_trunc('day', ...)` unless stated. Weeks are ISO weeks
(`date_trunc('week', ...)`). Cohorts are calendar months of first order.
