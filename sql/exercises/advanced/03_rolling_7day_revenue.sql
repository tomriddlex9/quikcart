-- Q: What is the trailing 7-day revenue per store (rolling window)?
-- Assumptions: revenue = sum(total_amount) of non-cancelled orders per UTC day;
--   the rolling window includes the current day and the 6 preceding days.
-- Edge cases: days before a store's first order yield 0 (ROWS frame with missing
--   dates only appears if the store-day exists — a full calendar spine is a mart
--   concern, not an OLTP exercise).
WITH daily AS (
    SELECT
        store_id,
        date_trunc('day', placed_at) AS day,
        sum(total_amount) AS revenue
    FROM orders
    WHERE status <> 'CANCELLED'
    GROUP BY store_id, date_trunc('day', placed_at)
)
SELECT
    store_id,
    day::date,
    revenue::numeric(14, 2) AS day_revenue,
    sum(revenue) OVER (
        PARTITION BY store_id
        ORDER BY day
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )::numeric(16, 2)       AS rolling_7d_revenue
FROM daily
ORDER BY store_id, day;
