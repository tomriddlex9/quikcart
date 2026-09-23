-- Q: How many orders were cancelled, per store?
-- Assumptions: status = 'CANCELLED' (covers payment-failure and customer cancels).
-- Edge cases: stores with zero cancellations included via LEFT JOIN.
SELECT
    s.store_id,
    s.store_code,
    count(o.order_id) AS cancelled_orders
FROM stores s
LEFT JOIN orders o
    ON o.store_id = s.store_id
   AND o.status = 'CANCELLED'
GROUP BY s.store_id, s.store_code
ORDER BY cancelled_orders DESC, s.store_id;
