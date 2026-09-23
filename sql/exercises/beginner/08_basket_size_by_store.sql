-- Q: What is the average basket size (units per order) per store?
-- Assumptions: units = sum(order_items.quantity); orders with no items cannot exist
--   (the simulator never materialises them).
-- Edge cases: stores with zero orders included via LEFT JOIN.
SELECT
    s.store_id,
    s.store_code,
    round(avg(basket.units), 2) AS avg_units_per_order
FROM stores s
LEFT JOIN (
    SELECT o.store_id, o.order_id, sum(oi.quantity) AS units
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    GROUP BY o.store_id, o.order_id
) basket ON basket.store_id = s.store_id
GROUP BY s.store_id, s.store_code
ORDER BY s.store_id;
