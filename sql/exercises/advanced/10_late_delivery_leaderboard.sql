-- Q: Which stores have the worst late-delivery record (leaderboard with lateness detail)?
-- Assumptions: late = DELIVERED with delivered_at > promised_by; lateness minutes
--   averaged and p90-estimated via percentile_cont; late rate over the delivered base.
-- Edge cases: stores with very few deliveries get unstable rates — a minimum-volume
--   guard (HAVING) keeps the leaderboard honest.
WITH delivered AS (
    SELECT
        o.store_id,
        d.delivered_at > d.promised_by AS is_late,
        extract(epoch FROM (d.delivered_at - d.promised_by)) / 60.0 AS minutes_vs_promise
    FROM deliveries d
    JOIN orders o ON o.order_id = d.order_id
    WHERE d.status = 'DELIVERED'
)
SELECT
    s.store_code,
    count(*)                                                             AS deliveries,
    count(*) FILTER (WHERE is_late)                                      AS late_deliveries,
    round(count(*) FILTER (WHERE is_late)::numeric / count(*), 4)        AS late_rate,
    round(avg(minutes_vs_promise) FILTER (WHERE is_late)::numeric, 2)    AS avg_lateness_minutes,
    round(percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes_vs_promise)::numeric, 2)
                                                                         AS p90_lateness_minutes
FROM delivered
JOIN stores s ON s.store_id = delivered.store_id
GROUP BY s.store_code
HAVING count(*) >= 20
ORDER BY late_rate DESC, avg_lateness_minutes DESC;
