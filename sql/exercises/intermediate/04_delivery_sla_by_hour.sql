-- Q: How does delivery SLA performance vary by order hour?
-- Assumptions: on-time = delivered_at <= promised_by over DELIVERED deliveries;
--   hour taken from the order's placed_at.
-- Edge cases: cancelled deliveries excluded (they have no delivered_at).
SELECT
    extract(hour FROM o.placed_at)                                   AS hour_of_day,
    count(*)                                                         AS deliveries,
    round(avg(extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60.0), 2) AS avg_ride_minutes,
    count(*) FILTER (WHERE d.delivered_at <= d.promised_by)          AS on_time,
    round(
        count(*) FILTER (WHERE d.delivered_at <= d.promised_by)::numeric / count(*),
        4
    )                                                                AS on_time_rate
FROM deliveries d
JOIN orders o ON o.order_id = d.order_id
WHERE d.status = 'DELIVERED'
GROUP BY 1
ORDER BY 1;
