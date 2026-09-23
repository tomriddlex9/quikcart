-- Q: How many orders were placed per day?
-- Assumptions: calendar day in UTC (timestamps are stored in UTC).
-- Edge cases: days with zero orders do not appear (no calendar spine in the OLTP DB).
SELECT
    date_trunc('day', placed_at)::date AS day,
    count(*)                           AS orders
FROM orders
GROUP BY 1
ORDER BY 1;
