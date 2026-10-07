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

<!-- BEGIN GENERATED: business-experience-metrics (python -m quickcart.semantics.docs) -->

## Business experience metrics

Source of truth: `src/quickcart/semantics/metrics.yaml` (loaded by `quickcart.semantics.registry`). The business API (`/api/v1/b/*`), the serving snapshot, and the console glossary all use these definitions. Every metric is compared with the **same day last week** by default. Days are UTC.

| Metric | Plain meaning | Formula | Unit | Better when | Watch / bad |
|---|---|---|---|---|---|
| `sales_gmv` — Sales | Money customers spent on orders that were not cancelled. | Sum of order totals for every order that was not cancelled (refunds stay in). | rupees (₹) | higher | watch 15.0%, bad 30.0% (adverse change) |
| `orders` — Orders | How many orders customers placed, including ones later cancelled. | Count of orders placed in the period. | count | higher | watch 15.0%, bad 30.0% (adverse change) |
| `average_basket` — Average basket (AOV) | How much a typical successful order is worth. | Sales divided by the number of orders that were not cancelled. | rupees (₹) | higher | watch 10.0%, bad 20.0% (adverse change) |
| `cancel_rate` — Cancelled orders | Share of placed orders that were cancelled before delivery. | Cancelled orders divided by all orders placed. | percent (stored as a 0 to 1 fraction) | lower | watch 0.05, bad 0.1 (absolute) |
| `on_time_rate` — On-time deliveries | Share of delivered orders that reached the customer by the promised time. | 1 minus the late rate, where late rate = late deliveries divided by delivered orders. | percent (stored as a 0 to 1 fraction) | higher | watch 0.85, bad 0.75 (absolute) |
| `late_rate` — Late deliveries | Share of delivered orders that arrived after the promised time. | Deliveries that arrived after the promised time divided by delivered orders. | percent (stored as a 0 to 1 fraction) | lower | watch 0.15, bad 0.25 (absolute) |
| `avg_delivery_minutes` — Delivery time | Average minutes from the rider picking up the order to handing it over. | Average of (delivered time minus pick-up time) over delivered orders. | minutes | lower | watch 25.0, bad 35.0 (absolute) |
| `payment_failure_rate` — Failed payments | Share of payment attempts that failed. | Failed payment attempts divided by all payment attempts (one order can try twice). | percent (stored as a 0 to 1 fraction) | lower | watch 0.05, bad 0.1 (absolute) |
| `availability_bestsellers` — Bestsellers in stock *(partial)* | How often the 20 top-selling products are available above their reorder level. | 1 minus the share of (store, product) stock lines for the top 20 products by revenue in the last 7 days that sit at or below their reorder point. A proxy for shelf availability, not a measured fill rate. | percent (stored as a 0 to 1 fraction) | higher | watch 0.9, bad 0.8 (absolute) |
| `stockout_risk_count` — Products running low *(partial)* | Store-and-product lines whose stock is at or below the reorder level. | Count of inventory lines where on-hand stock is at or below the reorder point. | count | lower | watch 10.0, bad 30.0 (absolute) |
| `active_customers` — Active customers | Distinct customers who placed at least one order that was not cancelled. | Count of distinct customers with a non-cancelled order in the period. | count | higher | watch 15.0%, bad 30.0% (adverse change) |
| `repeat_rate` — Returning customers *(partial)* | Share of customers who ordered more than once in the last 30 days. | Customers with 2 or more orders divided by customers with 1 or more orders, over the trailing 30 days. | percent (stored as a 0 to 1 fraction) | higher | watch 10.0%, bad 25.0% (adverse change) |

Partial metrics:

- `availability_bestsellers`: Current-stock proxy; history builds up as daily snapshots accumulate.
- `stockout_risk_count`: Current-stock count; history builds up as daily snapshots accumulate.
- `repeat_rate`: Computed for the latest day and the same day last week only (trailing 30-day window).

On-time and late are one formula: `late_rate = late ÷ delivered` and `on_time_rate = 1 - late_rate`, over DELIVERED deliveries only.

<!-- END GENERATED: business-experience-metrics -->
