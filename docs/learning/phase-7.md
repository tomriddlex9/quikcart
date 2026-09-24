# Phase 7 — Streaming with Redpanda

## What was built

- `streaming` compose profile: Redpanda v24.3.6 (single broker, split
  PLAINTEXT/EXTERNAL listeners) + Redpanda Console v2.8.0 on 127.0.0.1:8080.
- Topics `quickcart.order-events.v1`, `quickcart.app-events.v1`,
  `quickcart.rider-events.v1` (3 partitions each; created via `rpk`, also by
  `make streaming-up`).
- Live producer `src/quickcart/simulator/realtime.py`: order lifecycle events
  (ORDER_PLACED → PAYMENT_COMPLETED → ORDER_DELIVERED) on the kit/04 §4
  envelope with deterministic `uuid5` event IDs, configurable rate, graceful
  SIGINT/SIGTERM shutdown.
- Structured Streaming consumer `src/quickcart/ingestion/streaming.py`:
  Kafka → parsed events → `data/bronze/bronze_order_events` (Delta, append)
  with `_topic/_partition/_offset/_broker_ingested_at` lineage; malformed JSON
  → `data/quarantine/bronze_order_events_malformed` with the same lineage;
  checkpoint under `data/checkpoints/`.
- Late-event policy (kit/03 §7.5): a **persistent watermark** (running max
  `event_time`, stored beside the checkpoint) drops events older than
  `watermark − 10 minutes`, counted in `_late_dropped` logs — mirroring
  Spark's `withWatermark` semantics across foreachBatch restarts.

## Verification executed (kit/07 Phase 7)

Integration test against the live broker (fresh topic per run): 60 events
consumed; **checkpoint restart resumes with zero reprocessing** (90 distinct
partition/offset lineage after phase 2); replayed event IDs append to Bronze
but the derived order set stays deduplicated (30 distinct); a 2-hour-old event
is dropped per policy; malformed JSON lands in quarantine with raw payload.
**All gates PASS.** 3 unit tests cover the batch transforms (parse split,
watermark drop, sink routing) without a broker.

## What was learned

- Redpanda-in-Docker pitfall: advertising `127.0.0.1` works from the host but
  breaks sibling containers — split listeners (`PLAINTEXT://redpanda:9092`
  internal, `EXTERNAL://127.0.0.1:9092` host) are the fix.
- `processAllAvailable` only drains what was visible at call time — the test
  pump polls until the expected condition instead of assuming one pass.
- Realtime events must be stamped at **emission**: simulated future
  timestamps (delivery +32 min) made every other event in the batch look
  "late" under the watermark.

## Known limitations

- The watermark is a documented manual mirror of Spark's native watermark
  (correct across restarts; the native `withWatermark` form is demo-only).
- Consumer is foreachBatch-based; exactly-once business semantics are claimed
  only at the derived (Silver/Gold) layer per kit/05 §11.
