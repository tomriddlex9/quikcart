#!/usr/bin/env bash
# Idempotently sync and deploy the live QuickCart demo to its existing EC2 host.
set -euo pipefail

STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${STATE_DIR}/../.." && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "Missing ${STATE_FILE}. Run 01_create.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$STATE_FILE"
: "${PUBLIC_IP:?PUBLIC_IP is missing from ${STATE_FILE}}"
: "${KEY_PATH:?KEY_PATH is missing from ${STATE_FILE}}"

SSH=(
  ssh -i "$KEY_PATH"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=20
  ubuntu@"$PUBLIC_IP"
)
RSYNC_SSH="ssh -i ${KEY_PATH} -o StrictHostKeyChecking=accept-new"

echo "Waiting for SSH on ${PUBLIC_IP}..."
for attempt in $(seq 1 60); do
  if "${SSH[@]}" 'echo ok' >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "SSH never became ready" >&2
    exit 1
  fi
  sleep 5
done

echo "Waiting for Docker..."
for attempt in $(seq 1 60); do
  if "${SSH[@]}" 'docker compose version' >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "Docker Compose is not ready; inspect cloud-init on the instance." >&2
    exit 1
  fi
  sleep 5
done

echo "Ensuring at least 4 GiB of swap..."
"${SSH[@]}" bash -s <<'REMOTE_SWAP'
set -euo pipefail
required_kb=$((4 * 1024 * 1024))
active_kb="$(awk 'NR > 1 { total += $3 } END { print total + 0 }' /proc/swaps)"
if (( active_kb < required_kb )); then
  swap_file=/quickcart.swap
  if [[ -e "$swap_file" && "$(stat -c %s "$swap_file")" -lt $((4 * 1024 * 1024 * 1024)) ]]; then
    sudo rm -f "$swap_file"
  fi
  if [[ ! -e "$swap_file" ]]; then
    sudo fallocate -l 4G "$swap_file" \
      || sudo dd if=/dev/zero of="$swap_file" bs=1M count=4096 status=progress
    sudo chmod 600 "$swap_file"
    sudo mkswap "$swap_file" >/dev/null
  fi
  if ! awk 'NR > 1 { print $1 }' /proc/swaps | grep -Fxq "$swap_file"; then
    sudo swapon "$swap_file"
  fi
  if ! grep -Fq "$swap_file none swap sw 0 0" /etc/fstab; then
    echo "$swap_file none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
fi
free -m
REMOTE_SWAP

echo "Syncing repository to /home/ubuntu/quikcart..."
"${SSH[@]}" 'mkdir -p /home/ubuntu/quikcart'
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.venv/' \
  --exclude '.env' \
  --exclude '.env.aws-demo' \
  --exclude 'data/' \
  --exclude 'mlruns/' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/.next/' \
  --exclude 'frontend/.env.production.local' \
  --exclude 'scripts/aws_demo/.state.env' \
  --exclude 'scripts/aws_demo/.secrets/' \
  -e "$RSYNC_SSH" \
  "${ROOT}/" "ubuntu@${PUBLIC_IP}:/home/ubuntu/quikcart/"

echo "Provisioning data, models, frontend, and long-running services..."
"${SSH[@]}" bash -s -- \
  "$PUBLIC_IP" \
  "${QC_DEMO_HISTORICAL_ORDERS:-12000}" \
  "${QC_SKIP_ANOMALY:-0}" <<'REMOTE'
set -euo pipefail
PUBLIC_IP="$1"
export QC_DEMO_HISTORICAL_ORDERS="$2"
export QC_SKIP_ANOMALY="$3"
cd /home/ubuntu/quikcart
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v node >/dev/null || [[ "$(node --version | tr -d v | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

cp -n .env.example .env
cat >.env.aws-demo <<EOF
APP_ENV=aws-demo
APP_HOST=0.0.0.0
APP_PORT=8000
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
QUICKCART_DATA_ROOT=/home/ubuntu/quikcart/data
QUICKCART_STORAGE_BACKEND=local
QUICKCART_CORS_ORIGINS=http://${PUBLIC_IP}:3000,http://127.0.0.1:3000
MLFLOW_TRACKING_URI=file:///home/ubuntu/quikcart/data/mlruns
NEXT_PUBLIC_API_BASE=http://${PUBLIC_IP}:8000
NEXT_PUBLIC_STREAMLIT_URL=http://${PUBLIC_IP}:8501
EOF
set -a
# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source .env.aws-demo
set +a

docker compose \
  --profile core \
  --profile streaming \
  --profile ai \
  -f docker-compose.yml \
  -f scripts/aws_demo/docker-compose.demo.yml \
  up -d

echo "Waiting for PostgreSQL health..."
postgres_id="$(docker compose \
  -f docker-compose.yml \
  -f scripts/aws_demo/docker-compose.demo.yml \
  ps -q postgres)"
for attempt in $(seq 1 60); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$postgres_id" 2>/dev/null || true)"
  [[ "$health" == healthy ]] && break
  if [[ "$attempt" -eq 60 ]]; then
    docker logs --tail 100 "$postgres_id" >&2
    echo "PostgreSQL did not become healthy." >&2
    exit 1
  fi
  sleep 5
done

uv sync --all-groups
uv run python -m quickcart.db.init

# Thirty days gives demand/anomaly features enough history while remaining
# small enough for a single demo host.
SEED_ARGS=(
  --seed 42
  --orders "$QC_DEMO_HISTORICAL_ORDERS"
  --start-date 2026-08-24
  --end-date 2026-09-22
)
uv run python -m quickcart.simulator.seed_reference "${SEED_ARGS[@]}"
uv run python -m quickcart.simulator.historical "${SEED_ARGS[@]}"
uv run python -m quickcart.ingestion
uv run python -m quickcart.lakehouse.pipeline all

echo "Training delivery and demand models..."
uv run python - <<'PY'
import os

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.spark import build_spark
from quickcart.ml.anomaly_model import detect_anomalies
from quickcart.ml.demand_model import train_demand_model
from quickcart.ml.delivery_model import train_delivery_model

spark = build_spark("quickcart-aws-demo-training")
settings = get_settings()
tracking_uri = os.environ.get("MLFLOW_TRACKING_URI")
try:
    for name, train in (
        ("delivery", train_delivery_model),
        ("demand", train_demand_model),
    ):
        result = train(spark, settings.data_root, tracking_uri=tracking_uri)
        print(f"{name} training complete: {result}")
    if os.environ.get("QC_SKIP_ANOMALY", "0") != "1":
        result = detect_anomalies(spark, settings.data_root, tracking_uri=tracking_uri)
        print(f"anomaly training complete: {result}")
    else:
        print("QC_SKIP_ANOMALY=1; anomaly training skipped")
finally:
    spark.stop()
PY

if [[ -f src/quickcart/rag/indexing.py ]]; then
  echo "Waiting for Qdrant before building the RAG index..."
  for attempt in $(seq 1 60); do
    curl -fsS http://127.0.0.1:6333/healthz >/dev/null 2>&1 && break
    if [[ "$attempt" -eq 60 ]]; then
      echo "Qdrant did not become ready." >&2
      exit 1
    fi
    sleep 3
  done
  uv run python -m quickcart.rag.indexing
fi

echo "Waiting for Debezium Connect..."
for attempt in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8083/connectors >/dev/null 2>&1 && break
  if [[ "$attempt" -eq 60 ]]; then
    echo "Debezium Connect did not become ready." >&2
    exit 1
  fi
  sleep 3
done
if [[ -x infrastructure/debezium/register_connector.sh ]]; then
  infrastructure/debezium/register_connector.sh
else
  uv run python infrastructure/debezium/register_connector.py
fi

cat >frontend/.env.production.local <<EOF
NEXT_PUBLIC_API_BASE=http://${PUBLIC_IP}:8000
NEXT_PUBLIC_STREAMLIT_URL=http://${PUBLIC_IP}:8501
EOF
npm --prefix frontend ci
npm --prefix frontend run build

chmod +x scripts/aws_demo/install_units.sh
scripts/aws_demo/install_units.sh

for endpoint in \
  http://127.0.0.1:8000/health \
  http://127.0.0.1:3000 \
  http://127.0.0.1:8501; do
  for attempt in $(seq 1 30); do
    curl -fsS "$endpoint" >/dev/null 2>&1 && break
    if [[ "$attempt" -eq 30 ]]; then
      echo "Service did not become ready: ${endpoint}" >&2
      sudo journalctl --no-pager -n 80 \
        -u quickcart-api \
        -u quickcart-next \
        -u quickcart-streamlit >&2
      exit 1
    fi
    sleep 2
  done
done
echo "Deploy complete on $(hostname)."
REMOTE

echo
echo "Public URLs (HTTP demo; no TLS):"
echo "  Console:   http://${PUBLIC_IP}:3000"
echo "  API:       http://${PUBLIC_IP}:8000/health"
echo "  Streamlit: http://${PUBLIC_IP}:8501"
echo "  Qdrant:    http://${PUBLIC_IP}:6333/dashboard"
echo
echo "Next: ./scripts/aws_demo/03_verify.sh"
echo "Destroy when done: ./scripts/aws_demo/99_destroy.sh"
