-- Q: How do daily delivery minutes trend, and how does each day compare to the prior day?
-- Assumptions: ride minutes = picked_up_at → delivered_at over DELIVERED deliveries;
--   LAG gives the prior day's average; LEAD is shown for the forward view.
-- Edge cases: the first day has NULL prior values; cancelled deliveries excluded.
WITH daily AS (
    SELECT
        date_trunc('day', o.placed_at) AS day,
        avg(extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60.0) AS avg_ride_minutes,
        count(*) AS deliveries
    FROM deliveries d
    JOIN orders o ON o.order_id = d.order_id
    WHERE d.status = 'DELIVERED'
    GROUP BY 1
)
SELECT
    day::date,
    deliveries,
    round(avg_ride_minutes::numeric, 2)                                    AS avg_ride_minutes,
    round(lag(avg_ride_minutes)  OVER (ORDER BY day)::numeric, 2)          AS prior_day_minutes,
    round(lead(avg_ride_minutes) OVER (ORDER BY day)::numeric, 2)          AS next_day_minutes,
    round(avg_ride_minutes::numeric
          - lag(avg_ride_minutes) OVER (ORDER BY day)::numeric, 2)         AS delta_vs_prior,
    round(
        (avg_ride_minutes / nullif(lag(avg_ride_minutes) OVER (ORDER BY day), 0) - 1) * 100,
        2
    )                                                                      AS pct_change_vs_prior
FROM daily
ORDER BY day;
