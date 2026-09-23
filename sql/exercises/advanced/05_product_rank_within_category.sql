-- Q: How do products rank within their category by revenue (top 3 per category)?
-- Assumptions: RANK over category ordered by revenue desc; ties share a rank and can
--   yield more than 3 rows per category. ROW_NUMBER with a deterministic tiebreaker is
--   shown alongside — same window shape, different tie semantics.
-- Edge cases: RANK vs ROW_NUMBER divergence is itself the lesson; compare both columns.
WITH product_revenue AS (
    SELECT
        p.category,
        p.product_id,
        p.name,
        sum(oi.line_total) AS revenue,
        rank() OVER (PARTITION BY p.category ORDER BY sum(oi.line_total) DESC) AS revenue_rank
    FROM order_items oi
    JOIN products p ON p.product_id = oi.product_id
    GROUP BY p.category, p.product_id, p.name
)
SELECT
    category,
    product_id,
    name,
    revenue::numeric(14, 2),
    revenue_rank,
    row_number() OVER (
        PARTITION BY category ORDER BY revenue DESC, product_id
    ) AS deterministic_rank
FROM product_revenue
WHERE revenue_rank <= 3
ORDER BY category, revenue_rank, product_id;
