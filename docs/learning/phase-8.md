# Phase 8 — PostgreSQL CDC with Debezium

## What was built

- `wal_level=logical` on the postgres container (compose command), migration
  `V003__cdc_publication.sql` creating publication `quickcart_pub` for
  orders/inventory/payments. Effect-deterministic: schema resets silently
  empty a surviving publication (dropping tables removes them from it), so
  the migration rebuilds it on every fresh schema.
- Debezium Connect `quay.io/debezium/connect:3.6.3.Final` (kit pins the
  software version 3.6.3.Final; current images publish to Quay — Docker Hub
  stops at 3.0.0) in the streaming profile; connector config
  `infrastructure/debezium/connector_orders.json` registered idempotently via
  `register_connector.py` (PUT /connectors/{name}/config, credentials
  substituted from env).
- `src/quickcart/ingestion/cdc.py`: structured-streaming consumer landing the
  Debezium envelope largely as received into `bronze_orders_cdc` /
  `bronze_inventory_cdc` / `bronze_payments_cdc` with `_topic/_partition/
  _offset` lineage; a dedicated adapter normalizes the envelope per kit/04 §7
  (operation, business key, before/after JSON, source ts/LSN) so Silver stays
  decoupled; `apply_cdc_to_silver` reduces to the latest op per key and
  MERGEs into Silver (hard-delete policy for `d` ops — Bronze remains the
  audit trail; tombstone alternative documented here).

## Verification executed (kit/07 Phase 8)

Integration test: connector registered and RUNNING; snapshot (`r`) rows
landed (500 on smoke); an UPDATE (status→CANCELLED), an INSERT, and a DELETE
propagated within the timeout; Silver apply reflected all three — the
inserted-then-deleted order absent, the updated status CANCELLED; re-apply is
a no-op. **All gates PASS.** Unit tests cover the envelope adapter (c/u/d
mapping, before/after payloads, LSN).

## What was learned

- Debezium 3.x renamed `database.server.name` → `topic.prefix`.
- `DROP SCHEMA public CASCADE` does not drop publications, but dropping
  TABLES empties them — the naive "idempotent by name" migration then skips
  re-creation and streaming silently sees nothing. Effect-deterministic DDL
  beats name-idempotence here.
- Delta 4.4 merge metrics are `numTargetRowsInserted/Updated/Deleted` —
  the old `numInsertedRows` names silently read as zero.

## Known limitations

- Deletes are hard deletes on Silver (policy, documented); time-travel on
  Delta recovers prior state if ever needed.
- Only orders/inventory/payments are captured (kit/03 §8: start small).
