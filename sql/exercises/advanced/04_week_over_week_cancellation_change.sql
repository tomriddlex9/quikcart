-- Q: How did this week's cancellations move versus the prior week (WoW %)?
-- Assumptions: ISO weeks; cancellation = orders.status 'CANCELLED'; week-over-week
--   change = (this_week - last_week) / last_week.
-- Edge cases: the first seeded week has no prior (NULL change); weeks with zero
--   prior cancellations report NULL rather than divide-by-zero.
WITH weekly AS (
    SELECT
        date_trunc('week', placed_at) AS week,
        count(*) FILTER (WHERE status = 'CANCELLED') AS cancellations,
        count(*) AS orders
    FROM orders
    GROUP BY 1
)
SELECT
    week::date                                                        AS week_start,
    orders,
    cancellations,
    lag(cancellations) OVER w                                         AS prior_week_cancellations,
    round(
        (cancellations - lag(cancellations) OVER w)::numeric
        / nullif(lag(cancellations) OVER w, 0),
        4
    )                                                                 AS wow_change
FROM weekly
WINDOW w AS (ORDER BY week)
ORDER BY week;
