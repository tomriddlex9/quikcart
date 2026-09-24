#!/usr/bin/env bash
# Create the lakehouse bucket on the local S3-compatible endpoint (Phase 6).
# Idempotent: S3 returns 200 for an existing bucket on PUT.
set -euo pipefail

ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:8333}"
BUCKET="${S3_BUCKET:-quickcart-lakehouse}"

code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${ENDPOINT}/${BUCKET}")
if [ "$code" != "200" ] && [ "$code" != "409" ]; then
    echo "bucket creation failed: HTTP $code" >&2
    exit 1
fi
echo "bucket ready: ${ENDPOINT}/${BUCKET}"
