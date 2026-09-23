-- Q: How effective is each promotion (redemption count, attached revenue, discount cost)?
-- Assumptions: redemption = order rows carrying promotion_id; discount cost =
--   sum(promo_discount); revenue = sum(total_amount) of non-cancelled redeemed orders.
-- Edge cases: promotions with zero redemptions still listed (LEFT JOIN from promotions).
SELECT
    p.promotion_id,
    p.name,
    p.promotion_type,
    count(o.order_id)                                       AS redemptions,
    count(o.order_id) FILTER (WHERE o.status <> 'CANCELLED') AS completed_redemptions,
    coalesce(sum(o.total_amount) FILTER (WHERE o.status <> 'CANCELLED'), 0)::numeric(16, 2) AS revenue,
    coalesce(sum(o.promo_discount), 0)::numeric(16, 2)      AS discount_cost
FROM promotions p
LEFT JOIN orders o ON o.promotion_id = p.promotion_id
GROUP BY p.promotion_id, p.name, p.promotion_type
ORDER BY redemptions DESC;
