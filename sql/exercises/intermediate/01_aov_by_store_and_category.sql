-- Q: What is the average order value (AOV) per store and product category?
-- Assumptions: AOV = avg(orders.total_amount) over non-cancelled orders; a basket
--   contributes its category mix at order level (order counted once per category
--   present in its items).
-- Edge cases: category pairs with no orders omitted (INNER JOIN).
SELECT
    s.store_code,
    p.category,
    count(DISTINCT o.order_id)        AS orders,
    avg(o.total_amount)::numeric(12, 2) AS aov
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p     ON p.product_id = oi.product_id
JOIN stores s       ON s.store_id = o.store_id
WHERE o.status <> 'CANCELLED'
GROUP BY s.store_code, p.category
ORDER BY s.store_code, aov DESC;
