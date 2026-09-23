-- Q: Who are the top 10 customers by lifetime spend?
-- Assumptions: spend = sum(total_amount) over non-cancelled orders.
-- Edge cases: synthetic customers carry no PII, only customer_code.
SELECT
    c.customer_id,
    c.customer_code,
    sum(o.total_amount)::numeric(16, 2) AS lifetime_spend,
    count(o.order_id)                   AS orders
FROM customers c
JOIN orders o
    ON o.customer_id = c.customer_id
   AND o.status <> 'CANCELLED'
GROUP BY c.customer_id, c.customer_code
ORDER BY lifetime_spend DESC, c.customer_id
LIMIT 10;
