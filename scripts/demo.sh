#!/usr/bin/env bash
# QuickCart scripted end-to-end demo (kit/07 §9, kit/03 Phase 15).
#
# Runs the full acceptance scenario: verify services -> seed -> lakehouse ->
# streaming -> CDC -> ML training -> RAG eval -> API health, then prints the
# manual UI steps. Re-runnable: seeding is conditional, pipeline writes are
# MERGE/upsert based, and ML retraining simply adds new runs.
#
# Usage: scripts/demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# --- environment -------------------------------------------------------------
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${JAVA_HOME:-}" ] && command -v brew >/dev/null 2>&1; then
  BREW_JAVA="$(brew --prefix openjdk@17 2>/dev/null || true)"
  [ -n "$BREW_JAVA" ] && export JAVA_HOME="$BREW_JAVA"
fi

PG_USER="${POSTGRES_USER:-quickcart_app}"
PG_DB="${POSTGRES_DB:-quickcart}"
API_PORT="${APP_PORT:-8000}"
PIDS=()

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

cleanup() {
  if [ "${#PIDS[@]}" -eq 0 ]; then
    return
  fi
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  PIDS=()
}
trap cleanup EXIT

pg_psql() { # run SQL via the compose postgres container (no local psql needed)
  docker exec "$(docker compose ps -q postgres)" psql -U "$PG_USER" -d "$PG_DB" "$@"
}

service_running() {
  [ -n "$(docker compose ps -q "$1" 2>/dev/null)" ]
}

# --- step 1: verify service profiles ----------------------------------------
step "1/9 Verifying docker compose profiles (core, storage, streaming, ml, ai)"
REQUIRED_SERVICES=(postgres seaweedfs redpanda debezium mlflow qdrant)
MISSING=()
for svc in "${REQUIRED_SERVICES[@]}"; do
  service_running "$svc" || MISSING+=("$svc")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  info "Missing services: ${MISSING[*]}"
  info "Start them with:"
  info "  docker compose --profile core --profile storage --profile streaming --profile ml --profile ai up -d"
  exit 1
fi
info "All required services are running."

# Event topics and the Debezium connector are idempotent to (re)create.
if ! docker exec "$(docker compose ps -q redpanda)" rpk topic list | grep -q "quickcart.order-events.v1"; then
  info "Creating Redpanda topics..."
  docker exec "$(docker compose ps -q redpanda)" rpk topic create quickcart.order-events.v1 --partitions 3 --replicas 1
  docker exec "$(docker compose ps -q redpanda)" rpk topic create quickcart.app-events.v1 --partitions 3 --replicas 1
  docker exec "$(docker compose ps -q redpanda)" rpk topic create quickcart.rider-events.v1 --partitions 3 --replicas 1
fi
if ! curl -sf http://127.0.0.1:8083/connectors/quickcart-orders-cdc >/dev/null 2>&1; then
  info "Registering Debezium connector..."
  bash infrastructure/debezium/register_connector.sh
fi

# --- step 2: seed -------------------------------------------------------------
step "2/9 Ensuring the operational database is seeded"
if ! ORDER_COUNT="$(pg_psql -tAc 'SELECT count(*) FROM orders' 2>/dev/null | tr -d '[:space:]')"; then
  info "Schema not migrated yet — applying migrations with make db-init"
  make db-init
  ORDER_COUNT=0
fi
info "orders in PostgreSQL: $ORDER_COUNT"
if [ "${ORDER_COUNT:-0}" -lt 1000 ]; then
  info "Seeding reference data + 100k order history (seed 42)..."
  make seed
else
  info "Already seeded — skipping make seed."
fi

# --- step 3: raw export + lakehouse ------------------------------------------
step "3/9 Exporting raw tables and building Bronze -> Silver -> Gold"
make export-raw
make lakehouse

# --- step 4: streaming ---------------------------------------------------------
step "4/9 Streaming: 30 live order events through Redpanda into Bronze"
uv run python -m quickcart.ingestion.streaming &
PIDS+=($!)
sleep 5 # let the consumer initialise its checkpoint and query
uv run python -m quickcart.simulator.realtime --rate 2 --orders 30
sleep 8 # let the 3-second trigger commit the final micro-batches
info "Stopping streaming consumer..."
kill -INT "${PIDS[$((${#PIDS[@]} - 1))]}" 2>/dev/null || true
cleanup

# --- step 5: CDC ---------------------------------------------------------------
step "5/9 CDC: update an order in PostgreSQL and capture it downstream"
ORDER_ID="$(pg_psql -tAc 'SELECT max(order_id) FROM orders' | tr -d '[:space:]')"
info "Cancelling order $ORDER_ID in the source database..."
pg_psql -c "UPDATE orders SET status = 'CANCELLED', updated_at = now() WHERE order_id = $ORDER_ID"
sleep 5 # Debezium poll interval + event propagation
uv run python -m quickcart.ingestion.cdc consume --once
uv run python -m quickcart.ingestion.cdc apply
info "CDC event for order $ORDER_ID applied to Silver."

# --- step 6: ML training ---------------------------------------------------------
step "6/9 Training delivery, demand, and anomaly models (MLflow: ${MLFLOW_TRACKING_URI:-http://127.0.0.1:5000})"
uv run python - <<'PY'
import os

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.spark import build_spark
from quickcart.ml.anomaly_model import detect_anomalies
from quickcart.ml.demand_model import train_demand_model
from quickcart.ml.delivery_model import train_delivery_model

spark = build_spark("quickcart-demo-ml")
root = get_settings().data_root
uri = os.environ.get("MLFLOW_TRACKING_URI")
try:
    for name, fn in (
        ("delivery", train_delivery_model),
        ("demand", train_demand_model),
        ("anomaly", detect_anomalies),
    ):
        result = fn(spark, root, tracking_uri=uri)
        print(f"[demo] {name}: {sorted(result.keys())}")
finally:
    spark.stop()
PY

# --- step 7: RAG (optional until Phase 12 code is present) ----------------------
step "7/9 RAG index build + retrieval evaluation"
if [ -d src/quickcart/rag ]; then
  uv run python -m quickcart.rag.evaluation
else
  info "src/quickcart/rag not present yet — skipping RAG step."
fi

# --- step 8: API health -----------------------------------------------------------
step "8/9 FastAPI service health check"
if [ -d src/quickcart/api ]; then
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    curl -s "http://127.0.0.1:${API_PORT}/health"; echo
    info "API already running on :${API_PORT}."
  else
    info "Starting API in the background..."
    uv run python -m quickcart.api &
    PIDS+=($!)
    for _ in $(seq 1 30); do
      if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    curl -sf "http://127.0.0.1:${API_PORT}/health"
    echo
  fi
else
  info "src/quickcart/api not present yet — skipping API step."
fi

# --- step 9: manual follow-ups -----------------------------------------------------
step "9/9 Demo complete"
info "Manual steps:"
info "  - Streamlit dashboard:  uv run streamlit run dashboard/app.py   -> http://localhost:8501"
info "  - Next.js frontend:     cd frontend && npm run dev   -> http://localhost:3000"
info "  - MLflow UI:            open ${MLFLOW_TRACKING_URI:-http://127.0.0.1:5000}"
info "  - Redpanda console:     http://localhost:8080"
