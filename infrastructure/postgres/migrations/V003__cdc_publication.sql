-- V003 — CDC publication for Debezium (kit/03 §8.1).
-- wal_level=logical is supplied by the postgres container command (compose);
-- the app user is the container superuser locally, so publication + slot
-- creation work without extra grants.
--
-- Effect-deterministic (not name-idempotent): schema resets drop and recreate
-- the underlying tables, which silently empties a surviving publication — so
-- every migration run (including post-reset replays) rebuilds the publication
-- to guarantee it covers the current tables.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'quickcart_pub') THEN
        DROP PUBLICATION quickcart_pub;
    END IF;
    CREATE PUBLICATION quickcart_pub FOR TABLE orders, inventory, payments;
END
$$;
