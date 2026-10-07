-- V018 — publish the business-wave tables to CDC (Phase B6/B7).
-- Same effect-deterministic rebuild as V003/V006: drop and recreate quickcart_pub so a schema
-- reset (which empties a surviving publication) can never leave it stale. Keeps everything V006
-- published and adds the transactional tables from V011-V017 (all have primary keys, so
-- UPDATE/DELETE replicate). Reference-style tables (costs, targets, rules) are not published.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'quickcart_pub') THEN
        DROP PUBLICATION quickcart_pub;
    END IF;
    CREATE PUBLICATION quickcart_pub FOR TABLE
        orders, inventory, payments, order_items, deliveries,
        refunds, promotion_redemptions, order_ratings, nps_responses,
        inventory_batches, wastage_events,
        alerts, notifications,
        purchase_orders, purchase_order_lines, goods_receipts, goods_receipt_lines,
        rider_shifts;
END
$$;
