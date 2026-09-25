#!/usr/bin/env bash
# Deploy the Next.js console to Vercel, pointed at the AWS demo API.
# Usage:
#   ./scripts/aws_demo/04_deploy_frontend_vercel.sh
# Optional:
#   VERCEL_TOKEN=... PUBLIC_IP=13.x.x.x ./scripts/aws_demo/04_deploy_frontend_vercel.sh
set -euo pipefail

STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"

if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi
PUBLIC_IP="${PUBLIC_IP:?PUBLIC_IP missing — run 01_create.sh or export PUBLIC_IP}"

API_BASE="${NEXT_PUBLIC_API_BASE:-http://${PUBLIC_IP}:8000}"
STREAMLIT_URL="${NEXT_PUBLIC_STREAMLIT_URL:-http://${PUBLIC_IP}:8501}"

cd "${ROOT}/frontend"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Installing vercel CLI via npx on demand..."
fi

echo "Deploying console to Vercel"
echo "  NEXT_PUBLIC_API_BASE=${API_BASE}"
echo "  NEXT_PUBLIC_STREAMLIT_URL=${STREAMLIT_URL}"

DEPLOY_ARGS=(
  --prod
  --yes
  --cwd "${ROOT}/frontend"
  -e "NEXT_PUBLIC_API_BASE=${API_BASE}"
  -e "NEXT_PUBLIC_STREAMLIT_URL=${STREAMLIT_URL}"
  -e "QUICKCART_PUBLIC_DEMO=1"
  -e "NEXT_PUBLIC_PUBLIC_DEMO=1"
  --build-env "NEXT_PUBLIC_API_BASE=${API_BASE}"
  --build-env "NEXT_PUBLIC_STREAMLIT_URL=${STREAMLIT_URL}"
  --build-env "NEXT_PUBLIC_PUBLIC_DEMO=1"
  --build-env "QUICKCART_PUBLIC_DEMO=1"
)

if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  DEPLOY_ARGS+=(--token "$VERCEL_TOKEN")
fi

# Capture URL from deploy output
URL="$(npx --yes vercel@60 "${DEPLOY_ARGS[@]}" 2>&1 | tee /tmp/qc-vercel-deploy.log | awk '/https:\/\/.*\.vercel\.app/ {print $NF}' | tail -1)"
if [[ -z "$URL" ]]; then
  URL="$(grep -Eo 'https://[^ ]+\.vercel\.app' /tmp/qc-vercel-deploy.log | tail -1 || true)"
fi

echo "VERCEL_URL=${URL}"
echo "VERCEL_URL=${URL}" >"${STATE_DIR}/.vercel.env"

if [[ -n "$URL" ]]; then
  # Expand CORS on the API host for the Vercel origin
  ORIGIN="${URL%/}"
  echo "Updating AWS API CORS to allow ${ORIGIN}"
  ssh -i "$KEY_PATH" -o StrictHostKeyChecking=accept-new ubuntu@"$PUBLIC_IP" bash <<EOF
set -euo pipefail
cd ~/quikcart
mkdir -p .
cat > .env.aws-demo <<ENV
APP_HOST=0.0.0.0
QUICKCART_CORS_ORIGINS=${ORIGIN},http://127.0.0.1:3000,http://localhost:3000,http://${PUBLIC_IP}:3000
OLLAMA_MODEL=qwen2.5:1.5b
OLLAMA_BASE_URL=http://127.0.0.1:11434
MLFLOW_TRACKING_URI=
ENV
sudo systemctl restart quickcart-api || (pkill -f 'quickcart.api|uvicorn quickcart' || true; sleep 1; nohup env APP_HOST=0.0.0.0 QUICKCART_CORS_ORIGINS='${ORIGIN},http://127.0.0.1:3000,http://localhost:3000' OLLAMA_MODEL=qwen2.5:1.5b uv run python -m quickcart.api > /tmp/qc-api.log 2>&1 &)
sleep 2
curl -sf http://127.0.0.1:8000/health
echo
EOF
fi

echo
echo "Console (Vercel): ${URL:-see /tmp/qc-vercel-deploy.log}"
echo "API (AWS):        ${API_BASE}/health"
echo "Streamlit (AWS):  ${STREAMLIT_URL}"
