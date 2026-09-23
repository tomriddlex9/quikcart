-- Q: How many days of cover does each store/product have (on-hand vs recent demand)?
-- Assumptions: stock cover = on_hand_qty / average units sold per day over the last
--   14 days of the seeded history; NULL cover = no recent sales.
-- Edge cases: cover near zero highlights stockout risk — Phase 4's
--   gold_inventory_health mart formalises this; slow movers show very high cover.
WITH recent_sales AS (
    SELECT
        m.store_id,
        m.product_id,
        sum(-m.quantity_delta) AS units_sold,
        count(DISTINCT date_trunc('day', m.occurred_at)) AS selling_days
    FROM inventory_movements m
    WHERE m.movement_type = 'SALE'
      AND m.occurred_at >= (SELECT max(occurred_at) - interval '14 days' FROM inventory_movements)
    GROUP BY m.store_id, m.product_id
)
SELECT
    i.store_id,
    i.product_id,
    i.on_hand_qty,
    i.reorder_point,
    coalesce(rs.units_sold, 0)                                            AS units_sold_14d,
    round(coalesce(rs.units_sold, 0)::numeric / 14, 4)                    AS avg_daily_units,
    CASE
        WHEN coalesce(rs.units_sold, 0) = 0 THEN NULL
        ELSE round(i.on_hand_qty::numeric / (rs.units_sold::numeric / 14), 2)
    END                                                                   AS stock_cover_days
FROM inventory i
LEFT JOIN recent_sales rs
    ON rs.store_id = i.store_id
   AND rs.product_id = i.product_id
ORDER BY stock_cover_days ASC NULLS LAST, i.store_id, i.product_id
LIMIT 50;
