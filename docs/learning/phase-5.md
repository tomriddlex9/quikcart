# Phase 5 — Data quality, MERGE, SCD2, Spark optimization

## What was built

- **Rule engine** (`src/quickcart/quality/`): reusable `Rule(rule_id, severity,
  predicate, message, failure_action)` + `apply_rules` → (clean, quarantine,
  summary). Silver transforms were refactored onto it; the per-run summary
  (rule trigger counts) is written to `data/quarantine/quality_summary`.
- **FK-existence rules** (kit/04 §11): DQ-ORDER-002/003, DQ-ITEM-002 — Silver now
  cleans in dependency order and passes cleaned reference frames; the stores
  dimension was added to Bronze/Silver (`bronze_stores`/`silver_stores`).
- **Failure injection** (`src/quickcart/quality/injection.py`): all ten kit/04 §12
  scenarios, opt-in and seeded, over exported raw CSVs.
- **Delta MERGE** (`lakehouse/common/merge.py`): generic `upsert`/`delete_keys`
  with operation-metrics returns; reruns are no-ops.
- **SCD2** (`lakehouse/silver/scd2.py`): pure `apply_scd2` over
  (key, attributes, valid_from, valid_to, is_current); batch contract = one
  change per key (latest by order column wins) → reruns are no-ops. Targeted at
  customer addresses and product prices.
- **Optimization experiments** (`lakehouse/learning/optimization.py`): five
  before/after benchmarks with plan evidence; results in
  `data/artifacts/phase5/optimization_results.json`, analysis in
  `docs/learning/spark-optimization.md`.

## Verification executed

- 11 data-quality tests: each injected scenario lands in quarantine with the
  expected rule IDs; duplicates collapse exactly once; the new-schema-field
  scenario is ignored by the explicit contract (not fatal).
- MERGE/SCD2 unit tests: insert-new-key, update-existing, delete, rerun-noop;
  SCD2 closes old + opens new, keeps unchanged, inserts new keys.
- Plan-difference tests: BroadcastHashJoin vs SortMergeJoin, non-empty
  PartitionFilters on partitioned reads only.
- Full suite: see final run in phase notes (all green).

## Known limitations

- FK rules collect reference keys to the driver (fine at local scale; a
  broadcast-semi-join variant would be the distributed answer — noted for the
  optimization chapter).
- Skew mitigation effect is modest on local `local[*]` with ~98k rows; the
  learning value is the plan/result equivalence, not the speedup.
