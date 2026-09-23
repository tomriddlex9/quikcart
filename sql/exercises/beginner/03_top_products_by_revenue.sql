-- Q: What are the top 10 products by revenue?
-- Assumptions: revenue = sum(order_items.line_total); includes items from
--   cancelled orders (their items were still picked) — see metrics.md for the
--   delivered-only alternative.
-- Edge cases: ties broken by units sold, then product_id for determinism.
SELECT
    p.product_id,
    p.sku,
    p.name,
    sum(oi.line_total)::numeric(14, 2) AS revenue,
    sum(oi.quantity)                   AS units_sold
FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
GROUP BY p.product_id, p.sku, p.name
ORDER BY revenue DESC, units_sold DESC, p.product_id
LIMIT 10;
