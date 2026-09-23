-- Q: What is the total revenue (GMV) per store?
-- Assumptions: GMV = sum(orders.total_amount) across all non-cancelled orders
--   (cancelled orders never reached fulfillment; refunds stay counted as realised GMV).
--   See docs/data_dictionary/metrics.md.
-- Edge cases: stores with zero orders still appear via RIGHT JOIN; NULL → 0.
SELECT
    s.store_id,
    s.store_code,
    s.name AS store_name,
    count(o.order_id)                          AS orders,
    coalesce(sum(o.total_amount), 0)::numeric(14, 2) AS gmv
FROM stores s
LEFT JOIN orders o
    ON o.store_id = s.store_id
   AND o.status <> 'CANCELLED'
GROUP BY s.store_id, s.store_code, s.name
ORDER BY gmv DESC;
