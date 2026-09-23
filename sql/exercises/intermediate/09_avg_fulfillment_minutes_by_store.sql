-- Q: What is the average end-to-end fulfillment time per store?
-- Assumptions: fulfillment = placed_at → delivered_at over DELIVERED deliveries;
--   also reports the pick (assigned→picked_up) and wait (placed→assigned) segments
--   so queueing vs riding time can be separated.
-- Edge cases: stores whose orders all cancelled show NULL averages (no delivered rows).
SELECT
    s.store_code,
    count(d.delivery_id) FILTER (WHERE d.status = 'DELIVERED')          AS delivered,
    round(avg(extract(epoch FROM (d.assigned_at  - o.placed_at)) / 60.0)
          FILTER (WHERE d.status = 'DELIVERED'), 2)                     AS avg_wait_minutes,
    round(avg(extract(epoch FROM (d.picked_up_at - d.assigned_at)) / 60.0)
          FILTER (WHERE d.status = 'DELIVERED'), 2)                     AS avg_pick_minutes,
    round(avg(extract(epoch FROM (d.delivered_at - o.placed_at)) / 60.0)
          FILTER (WHERE d.status = 'DELIVERED'), 2)                     AS avg_fulfillment_minutes
FROM stores s
LEFT JOIN orders o    ON o.store_id = s.store_id
LEFT JOIN deliveries d ON d.order_id = o.order_id
GROUP BY s.store_code
ORDER BY avg_fulfillment_minutes DESC NULLS LAST;
