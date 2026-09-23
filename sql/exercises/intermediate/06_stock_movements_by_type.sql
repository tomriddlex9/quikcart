-- Q: What does the stock movement profile look like per store?
-- Assumptions: movement volumes by type; net units = sum(quantity_delta) should stay
--   near zero-sum apart from receipts vs sales (inventory stays non-negative by CHECK).
-- Edge cases: stores with no movements would still appear via stores LEFT JOIN.
SELECT
    s.store_code,
    m.movement_type,
    count(*)               AS movements,
    sum(m.quantity_delta)  AS net_units
FROM stores s
LEFT JOIN inventory_movements m ON m.store_id = s.store_id
GROUP BY s.store_code, m.movement_type
ORDER BY s.store_code, movements DESC;
