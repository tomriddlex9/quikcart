-- Q: How many riders are anchored to each store?
-- Assumptions: riders.home_store_id is the anchor; status is the end-of-history
--   snapshot and is ignored here.
-- Edge cases: every store has riders by construction; LEFT JOIN keeps this robust.
SELECT
    s.store_id,
    s.store_code,
    count(r.rider_id) AS riders
FROM stores s
LEFT JOIN riders r ON r.home_store_id = s.store_id
GROUP BY s.store_id, s.store_code
ORDER BY riders DESC, s.store_id;
