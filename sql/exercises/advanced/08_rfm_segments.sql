-- Q: Which customers fall into which RFM bucket (recency, frequency, monetary)?
-- Assumptions: computed over non-cancelled orders against the history end
--   (max placed_at). Quartile scoring via NTILE(4): 4 = best. Composite = R*100+F*10+M.
-- Edge cases: quartiles are relative to the active customer base, not absolute
--   thresholds — fine for segmentation, not for targeting SLAs.
WITH params AS (
    SELECT max(placed_at) AS as_of FROM orders
),
rfm AS (
    SELECT
        o.customer_id,
        extract(day FROM (params.as_of - max(o.placed_at)))::int AS recency_days,
        count(*)                                                 AS frequency,
        sum(o.total_amount)                                      AS monetary
    FROM orders o
    CROSS JOIN params
    WHERE o.status <> 'CANCELLED'
    GROUP BY o.customer_id, params.as_of
),
scored AS (
    SELECT
        customer_id,
        recency_days,
        frequency,
        monetary::numeric(16, 2) AS monetary,
        ntile(4) OVER (ORDER BY recency_days DESC) AS r_score,  -- recent = high score
        ntile(4) OVER (ORDER BY frequency)         AS f_score,
        ntile(4) OVER (ORDER BY monetary)          AS m_score
    FROM rfm
)
SELECT
    customer_id,
    recency_days,
    frequency,
    monetary,
    r_score * 100 + f_score * 10 + m_score AS rfm_composite,
    CASE
        WHEN r_score = 4 AND f_score >= 3 THEN 'champion'
        WHEN r_score >= 3 AND f_score = 1 THEN 'new'
        WHEN r_score <= 2 AND f_score >= 3 THEN 'at_risk'
        WHEN r_score <= 2 AND f_score <= 2 THEN 'dormant'
        ELSE 'regular'
    END                                    AS rfm_segment
FROM scored
ORDER BY rfm_composite DESC
LIMIT 50;
