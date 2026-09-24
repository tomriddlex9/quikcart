# Phase 6 — S3-compatible object storage (SeaweedFS)

## What was built

- `storage` compose profile: SeaweedFS 3.85 with S3 API on 127.0.0.1:8333
  (healthcheck + named volume), bucket bootstrap via
  `infrastructure/seaweedfs/bootstrap_bucket.sh` (idempotent PUT).
- Spark S3A wiring in `lakehouse/common/spark.py`: hadoop-aws 3.4.2 +
  aws-sdk bundle fetched via Ivy (cached after first run), endpoint +
  path-style + credentials from Settings only (kit/06 §9).
- Storage-backend abstraction: `lakehouse/common/paths.table_location()`
returns a local path or an `s3a://bucket/layer/table` URI; Bronze/Silver/Gold
loaders write and read through it — **zero branching in transformation code**.
- `Settings` gained `s3_endpoint/s3_access_key/s3_secret_key/s3_bucket`
fed by `S3_*` env vars (`.env.example` documented).

## Verification executed

- `tests/integration/test_s3_backend.py` (integration, skips without the
  profile): drives the whole `pipeline all` in a subprocess with
  `QUICKCART_STORAGE_BACKEND=s3`; the run's own read-backs (Silver←Bronze,
  Gold←Silver) prove Delta tables are writable and readable through the S3
  endpoint. **PASS.**

## What was learned

- Spark's `spark.jars.packages` is last-write-wins: naively adding the S3A
  packages clobbered Delta's — `configure_spark_with_delta_pip(extra_packages=...)`
  exists precisely to merge them.
- SeaweedFS accepts any credentials by default; the project still keeps them
  in env configuration only, so pointing at a real endpoint is a config edit,
  not a code edit.

## Known limitations

- Raw exports remain local files; only the lakehouse moves to S3.
- Existence pre-checks are skipped on the S3 backend (load errors surface
  naturally from Spark).
