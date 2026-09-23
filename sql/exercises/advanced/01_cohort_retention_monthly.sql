-- Q: What is monthly cohort retention (do month-0 customers order in later months)?
-- Assumptions: cohort = month of the customer's first order; retained = placed an
--   order in cohort_month + n. Denominator = cohort size. Percentages rounded to 2dp.
-- Edge cases: recent cohorts have fewer elapsed months (NULL = not yet observable);
--   a customer is counted once per (cohort, month-offset) pair.
WITH first_orders AS (
    SELECT
        customer_id,
        date_trunc('month', min(placed_at)) AS cohort_month
    FROM orders
    GROUP BY customer_id
),
activity AS (
    SELECT DISTINCT
        f.customer_id,
        f.cohort_month,
        months_between.month_offset
    FROM first_orders f
    JOIN orders o
        ON o.customer_id = f.customer_id
    JOIN LATERAL (
        SELECT (extract(year FROM o.placed_at) - extract(year FROM f.cohort_month)) * 12
             + (extract(month FROM o.placed_at) - extract(month FROM f.cohort_month)) AS month_offset
    ) months_between ON TRUE
)
SELECT
    f.cohort_month::date                                   AS cohort_month,
    count(DISTINCT f.customer_id)                        AS cohort_size,
    count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 1) AS retained_m1,
    count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 2) AS retained_m2,
    round(
        count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 1)::numeric
        / count(DISTINCT f.customer_id),
        4
    )                                                    AS retention_m1,
    round(
        count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 2)::numeric
        / count(DISTINCT f.customer_id),
        4
    )                                                    AS retention_m2
FROM first_orders f
LEFT JOIN activity a
    ON a.customer_id = f.customer_id
GROUP BY f.cohort_month
ORDER BY f.cohort_month;
