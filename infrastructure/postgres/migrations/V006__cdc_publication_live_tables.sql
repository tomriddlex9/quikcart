-- V006 — Expand Debezium publication for live writer tables.
-- Adds order_items + deliveries so CDC mirrors the live simulator surface.
-- Rebuilds the publication the same way V003 does (effect-deterministic).

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'quickcart_pub') THEN
        DROP PUBLICATION quickcart_pub;
    END IF;
    CREATE PUBLICATION quickcart_pub FOR TABLE
        orders, inventory, payments, order_items, deliveries;
END
$$;
