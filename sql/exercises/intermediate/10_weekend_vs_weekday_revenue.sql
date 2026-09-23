-- Q: How do weekends compare to weekdays in order volume and revenue?
-- Assumptions: isodow ≥ 6 = weekend (Saturday/Sunday); UTC days.
-- Edge cases: the seeded range need not contain equal weekend/weekday counts — the
--   per-day average normalises for that.
SELECT
    CASE WHEN extract(isodow FROM placed_at) >= 6 THEN 'weekend' ELSE 'weekday' END AS day_type,
    count(DISTINCT date_trunc('day', placed_at))                                    AS days,
    count(*)                                                                        AS orders,
    round(count(*)::numeric / count(DISTINCT date_trunc('day', placed_at)), 2)      AS avg_orders_per_day,
    sum(total_amount)::numeric(16, 2)                                               AS gmv,
    round(avg(total_amount)::numeric, 2)                                            AS aov
FROM orders
GROUP BY 1
ORDER BY 1;
