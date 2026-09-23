-- Q: Where does each store sit in the network-wide performance distribution?
-- Assumptions: performance = non-cancelled GMV over the full seeded range;
--   PERCENT_RANK gives 0..1 position across stores; NTILE(4) quarters them.
-- Edge cases: with few stores the percentiles are coarse — interpretation matters
--   more than the exact number at this scale.
WITH store_gmv AS (
    SELECT
        s.store_id,
        s.store_code,
        coalesce(sum(o.total_amount) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS gmv
    FROM stores s
    LEFT JOIN orders o ON o.store_id = s.store_id
    GROUP BY s.store_id, s.store_code
)
SELECT
    store_id,
    store_code,
    gmv::numeric(16, 2)                                            AS gmv,
    round(percent_rank() OVER (ORDER BY gmv)::numeric, 4)          AS gmv_percentile,
    ntile(4) OVER (ORDER BY gmv)                                   AS performance_quartile
FROM store_gmv
ORDER BY gmv DESC;
