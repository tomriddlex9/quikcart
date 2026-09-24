# Spark optimization experiments — measured results

Local workstation (Apple Silicon, Spark 4.2.0 `local[*]`, ~98k orders /
300k items). Median of 3 runs each; raw numbers in
`data/artifacts/phase5/optimization_results.json`. These are local-mode
measurements for learning, not cluster claims (kit/AGENTS.md: no unmeasured
performance claims).

## 1. Partition pruning — flat vs date-partitioned layout

| layout | median count time (1 day filter) | plan PartitionFilters |
|---|---|---|
| flat parquet | 70.9 ms | empty (`PartitionFilters: []`) |
| partitioned by `placed_date` | 45.5 ms | `[isnotnull(d), (d = 3)]` — files pruned |

~1.6x locally; the real win is reading 1/206 of the files. Lesson: the plan
must show **non-empty** PartitionFilters — the string "PartitionFilters"
appears even when empty, which is exactly the kind of false comfort to check
against.

## 2. Broadcast join — 300k items x 2k products

| strategy | median | plan |
|---|---|---|
| auto-broadcast disabled (sort-merge) | 402.7 ms | `SortMergeJoin` + two Exchanges |
| explicit `F.broadcast(products)` | 181.7 ms | `BroadcastHashJoin`, no shuffle on the small side |

~2.2x. Spark's auto threshold (10 MB) already broadcasts small tables by
default — disabling it demonstrates what the shuffle costs. Lesson:
broadcast the small dimension deliberately; don't rely on the heuristic for
production-critical joins.

## 3. Shuffle partitions — 200 (default) vs 8

| shuffle.partitions | median groupBy+count |
|---|---|
| 200 (default) | 94.4 ms |
| 8 (right-sized) | 81.3 ms |

Modest locally because data is tiny — 200 mostly-empty tasks are pure
scheduling overhead. Lesson: the default 200 targets clusters; right-size for
local/dev or small data.

## 4. Data skew — 80% of orders on one store

| aggregation | median | same result |
|---|---|---|
| plain `groupBy` | 95.0 ms | — |
| salted (hot key split into 10 buckets) | 77.9 ms | yes (asserted row equality) |

~1.2x locally; on a cluster the hot partition would dominate wall time.
Lesson: salting pre-aggregates the hot key in parallel, then combines —
results must be verified equal (the test does).

## 5. Small files — 124 files vs 4 files

| layout | files | median read+count |
|---|---|---|
| `repartition(200)` write | 124 | 56.9 ms |
| `repartition(4)` write | 4 | 30.4 ms |

~1.9x. A Delta `OPTIMIZE` compaction was also executed on the same data.
Lesson: many tiny files inflate scheduling + open cost; coalesce/compaction
is maintenance, not optional polish.
