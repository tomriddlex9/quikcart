#!/usr/bin/env bash
# Verify public services, live growth/SSE, and EC2 memory headroom.
set -euo pipefail

STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "Missing ${STATE_FILE}. Run 01_create.sh and 02_deploy.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$STATE_FILE"
: "${PUBLIC_IP:?PUBLIC_IP is missing from ${STATE_FILE}}"
: "${KEY_PATH:?KEY_PATH is missing from ${STATE_FILE}}"

IP="$PUBLIC_IP"
FAIL=0
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/quickcart-verify.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
SSH=(
  ssh -i "$KEY_PATH"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=20
  ubuntu@"$IP"
)

check() {
  local name="$1" url="$2" output="${3:-${TMP_DIR}/${name}.body}" code
  if code="$(curl -sS -o "$output" -w '%{http_code}' \
    --connect-timeout 10 --max-time 60 "$url")"; then
    :
  else
    code=000
  fi
  if [[ "$code" == 200 || "$code" == 304 ]]; then
    echo "OK   ${name} (${code}) ${url}"
  else
    echo "FAIL ${name} (${code}) ${url}"
    FAIL=$((FAIL + 1))
  fi
}

check_api_v1_health() {
  local v1_url="http://${IP}:8000/api/v1/health"
  local legacy_url="http://${IP}:8000/health"
  local output="${TMP_DIR}/api-v1-health.body" code url_used
  code="$(curl -sS -o "$output" -w '%{http_code}' \
    --connect-timeout 10 --max-time 30 "$v1_url" 2>/dev/null || echo 000)"
  url_used="$v1_url"
  if [[ "$code" == 404 ]]; then
    code="$(curl -sS -o "$output" -w '%{http_code}' \
      --connect-timeout 10 --max-time 30 "$legacy_url" 2>/dev/null || echo 000)"
    url_used="${legacy_url} (fallback; /api/v1/health missing)"
  fi
  if [[ "$code" == 200 ]]; then
    echo "OK   api-v1-health (${code}) ${url_used}"
  else
    echo "FAIL api-v1-health (${code}) ${url_used}"
    FAIL=$((FAIL + 1))
  fi
}

check_sql_generate() {
  local url="http://${IP}:8000/api/v1/sql/generate"
  local output="${TMP_DIR}/sql-generate.json" code verdict
  code="$(curl -sS -o "$output" -w '%{http_code}' \
    --connect-timeout 10 --max-time 120 \
    -H 'Content-Type: application/json' \
    -d '{"question":"how many orders exist?","source":"postgres"}' \
    "$url" 2>/dev/null || echo 000)"
  if [[ "$code" != 200 ]]; then
    echo "FAIL sql-generate (${code}) ${url}"
    FAIL=$((FAIL + 1))
    return 0
  fi
  verdict="$(python3 - "$output" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
allowed = bool(payload.get("allowed"))
degraded = bool(payload.get("degraded"))
if allowed or degraded:
    print("ok")
else:
    print("bad")
PY
)"
  if [[ "$verdict" == ok ]]; then
    echo "OK   sql-generate (${code}) ${url}"
  else
    echo "FAIL sql-generate (${code}) ${url} (expected allowed or degraded)"
    FAIL=$((FAIL + 1))
  fi
}

check_streamlit_if_reachable() {
  local url="http://${IP}:8501"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    --connect-timeout 5 --max-time 20 "$url" 2>/dev/null || echo 000)"
  if [[ "$code" == 200 || "$code" == 304 ]]; then
    echo "OK   streamlit (${code}) ${url}"
  elif [[ "$code" == 000 ]]; then
    echo "WARN streamlit unreachable (${code}) ${url}"
  else
    echo "FAIL streamlit (${code}) ${url}"
    FAIL=$((FAIL + 1))
  fi
}

check_api_v1_health
check health "http://${IP}:8000/health"
check sim-status "http://${IP}:8000/api/v1/sim/status"
check_sql_generate
check console "http://${IP}:3000"
check_streamlit_if_reachable
check live-snapshot "http://${IP}:8000/api/v1/live/snapshot"
check live-pipeline-1 "http://${IP}:8000/api/v1/live/pipeline" "${TMP_DIR}/pipeline-1.json"

if [[ "$FAIL" -gt 0 ]]; then
  echo "${FAIL} endpoint checks failed; skipping live assertions." >&2
  exit 1
fi

read_pipeline_counts() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
counts = payload.get("counts", {})
postgres_orders = int(counts.get("postgres", {}).get("orders", 0) or 0)
bronze_total = sum(int(value or 0) for value in counts.get("bronze", {}).values())
print(postgres_orders, bronze_total)
PY
}

read -r postgres_1 bronze_1 < <(read_pipeline_counts "${TMP_DIR}/pipeline-1.json")
echo "Waiting 60 seconds to prove the live pipeline is advancing..."
sleep 60
check live-pipeline-2 "http://${IP}:8000/api/v1/live/pipeline" "${TMP_DIR}/pipeline-2.json"
if [[ "$FAIL" -eq 0 ]]; then
  read -r postgres_2 bronze_2 < <(read_pipeline_counts "${TMP_DIR}/pipeline-2.json")
  if (( postgres_2 > postgres_1 || bronze_2 > bronze_1 )); then
    echo "OK   live growth (postgres.orders ${postgres_1}->${postgres_2}, bronze ${bronze_1}->${bronze_2})"
  else
    echo "FAIL no live growth (postgres.orders ${postgres_1}->${postgres_2}, bronze ${bronze_1}->${bronze_2})"
    FAIL=$((FAIL + 1))
  fi
fi

set +e
curl -fsS -N --connect-timeout 5 --max-time 10 \
  "http://${IP}:8000/api/v1/live/stream" >"${TMP_DIR}/live.sse"
sse_curl_status=$?
set -e
if [[ "$sse_curl_status" -ne 0 && "$sse_curl_status" -ne 28 ]]; then
  echo "FAIL SSE request exited ${sse_curl_status}"
  FAIL=$((FAIL + 1))
else
  sse_events="$(awk '/^data:/{ count++ } END { print count + 0 }' "${TMP_DIR}/live.sse")"
  if (( sse_events >= 2 )); then
    echo "OK   SSE emitted ${sse_events} data events in 10 seconds"
  else
    echo "FAIL SSE emitted ${sse_events} data events; expected at least 2"
    FAIL=$((FAIL + 1))
  fi
fi

echo "Remote memory headroom:"
free_output="$("${SSH[@]}" free -m)"
echo "$free_output"
available_mb="$(awk '$1 == "Mem:" { print $7 }' <<<"$free_output")"
swap_mb="$(awk '$1 == "Swap:" { print $2 }' <<<"$free_output")"
minimum_available_mb="${QC_MIN_AVAILABLE_MB:-512}"
if (( available_mb >= minimum_available_mb && swap_mb >= 3500 )); then
  echo "OK   memory available=${available_mb}MiB swap=${swap_mb}MiB"
else
  echo "FAIL memory available=${available_mb}MiB swap=${swap_mb}MiB"
  FAIL=$((FAIL + 1))
fi

if (( FAIL > 0 )); then
  echo "${FAIL} verification checks failed." >&2
  exit 1
fi
echo "All live demo checks passed against ${IP}."
