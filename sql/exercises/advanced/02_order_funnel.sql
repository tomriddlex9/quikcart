-- Q: What does the order funnel look like (payment → fulfillment → delivery)?
-- Assumptions: stages are terminal states in the seeded history. Payment-success =
--   orders with at least one CAPTURED payment; delivered/cancelled are order statuses.
--   The funnel is reported as counts plus step-over-step conversion.
-- Edge cases: payment-failure cancellations never reach fulfillment (no delivery row).
WITH stages AS (
    SELECT
        count(*) AS placed,
        count(*) FILTER (WHERE status IN ('DELIVERED', 'REFUNDED', 'CANCELLED')) AS resolved,
        count(*) FILTER (WHERE status IN ('DELIVERED', 'REFUNDED')) AS fulfilled,
        count(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
        count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
        count(*) FILTER (WHERE status = 'REFUNDED') AS refunded
    FROM orders
)
SELECT
    placed,
    fulfilled,
    delivered,
    cancelled,
    refunded,
    round(fulfilled::numeric / placed, 4)  AS placed_to_fulfilled,
    round(delivered::numeric / fulfilled, 4) AS fulfilled_to_delivered,
    round(cancelled::numeric / placed, 4)  AS cancellation_rate
FROM stages;
