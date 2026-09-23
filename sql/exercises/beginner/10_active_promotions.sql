-- Q: Which promotions are active at the end of the seeded history?
-- Assumptions: is_active flag maintained by the simulator (window overlaps history end).
-- Edge cases: promotion value semantics depend on promotion_type (see metrics.md).
SELECT
    promotion_id,
    name,
    promotion_type,
    value,
    starts_at,
    ends_at,
    min_order_value,
    max_discount
FROM promotions
WHERE is_active
ORDER BY ends_at DESC;
