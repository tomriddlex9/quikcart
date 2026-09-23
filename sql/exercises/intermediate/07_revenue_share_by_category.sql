-- Q: How does revenue split across product categories?
-- Assumptions: line-level revenue (order_items.line_total) attributed to categories;
--   share computed against the same population (all items, matching beginner Q3).
-- Edge cases: percentages rounded to 2dp; shares sum to ~1.0 modulo rounding.
SELECT
    p.category,
    sum(oi.line_total)::numeric(16, 2)                          AS revenue,
    round(
        sum(oi.line_total) / sum(sum(oi.line_total)) OVER (),
        4
    )                                                           AS revenue_share
FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
GROUP BY p.category
ORDER BY revenue DESC;
