-- Q: What is each rider's utilization (deliveries completed vs cancelled while assigned)?
-- Assumptions: utilization = delivered / (delivered + cancelled) per rider; riders
--   without delivery rows excluded (they never got an assignment in the window).
-- Edge cases: NULL rider_id (no rider available) aggregated under a sentinel row.
SELECT
    coalesce(r.rider_id::text, 'UNASSIGNED')                          AS rider,
    count(*) FILTER (WHERE d.status = 'DELIVERED')                    AS delivered,
    count(*) FILTER (WHERE d.status = 'CANCELLED')                    AS cancelled,
    round(
        count(*) FILTER (WHERE d.status = 'DELIVERED')::numeric
        / count(*),
        4
    )                                                                 AS utilization_rate
FROM deliveries d
LEFT JOIN riders r ON r.rider_id = d.rider_id
GROUP BY coalesce(r.rider_id::text, 'UNASSIGNED')
ORDER BY delivered DESC;
