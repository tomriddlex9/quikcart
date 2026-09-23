-- V002 — Query-driven indexes (kit/04_DATA_MODEL_AND_EVENTS.md §3).
-- Added after baseline access patterns of the simulator/validator were known.

CREATE INDEX idx_orders_store_placed      ON orders(store_id, placed_at);
CREATE INDEX idx_orders_customer_placed   ON orders(customer_id, placed_at);
CREATE INDEX idx_orders_status_placed     ON orders(status, placed_at);
CREATE INDEX idx_order_items_order        ON order_items(order_id);
CREATE INDEX idx_order_items_product      ON order_items(product_id);
CREATE INDEX idx_deliveries_rider_status  ON deliveries(rider_id, status);
CREATE INDEX idx_payments_order_status    ON payments(order_id, status);
CREATE INDEX idx_inv_movements_store_prod ON inventory_movements(store_id, product_id, occurred_at);
