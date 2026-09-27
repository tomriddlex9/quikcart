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

# Login + boot loading match quikcart.tomriddle.in (middleware requires session).
# Set QUICKCART_PUBLIC_DEMO=1 only for an intentionally open showcase.
DEPLOY_ARGS=(
  --prod
  --yes
  --cwd "${ROOT}/frontend"
  --scope siddhants-projects-3e205b41
  -e "NEXT_PUBLIC_API_BASE=${API_BASE}"
  -e "NEXT_PUBLIC_STREAMLIT_URL=${STREAMLIT_URL}"
  --build-env "NEXT_PUBLIC_API_BASE=${API_BASE}"
  --build-env "NEXT_PUBLIC_STREAMLIT_URL=${STREAMLIT_URL}"
)
if [[ "${QUICKCART_PUBLIC_DEMO:-0}" == "1" ]]; then
  DEPLOY_ARGS+=(
    -e "QUICKCART_PUBLIC_DEMO=1"
    -e "NEXT_PUBLIC_PUBLIC_DEMO=1"
    --build-env "NEXT_PUBLIC_PUBLIC_DEMO=1"
    --build-env "QUICKCART_PUBLIC_DEMO=1"
  )
fi

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
  # Expand CORS on the API host for the Vercel origin without wiping other env keys
  # (XAI_API_KEY, custom domains, etc.).
  ORIGIN="${URL%/}"
  echo "Updating AWS API CORS to allow ${ORIGIN}"
  ssh -i "$KEY_PATH" -o StrictHostKeyChecking=accept-new ubuntu@"$PUBLIC_IP" \
    ORIGIN="$ORIGIN" PUBLIC_IP="$PUBLIC_IP" bash <<'EOF'
set -euo pipefail
cd ~/quikcart
touch .env.aws-demo
python3 - <<'PY'
import os
from pathlib import Path

path = Path(".env.aws-demo")
env: dict[str, str] = {}
if path.exists():
    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value

origin = os.environ["ORIGIN"].rstrip("/")
public_ip = os.environ["PUBLIC_IP"]
extra = [
    origin,
    "https://quikcartapp.tomriddle.in",
    "https://quikcart.tomriddle.in",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    f"http://{public_ip}:3000",
]
existing = [p.strip() for p in env.get("QUICKCART_CORS_ORIGINS", "").split(",") if p.strip()]
merged: list[str] = []
seen: set[str] = set()
for item in existing + extra:
    if item not in seen:
        seen.add(item)
        merged.append(item)
env["QUICKCART_CORS_ORIGINS"] = ",".join(merged)
env.setdefault("APP_HOST", "0.0.0.0")
env.setdefault("OLLAMA_MODEL", "qwen2.5:1.5b")
env.setdefault("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
path.write_text("".join(f"{k}={v}\n" for k, v in env.items()))
print("CORS=", env["QUICKCART_CORS_ORIGINS"])
print("has_xai=", "yes" if env.get("XAI_API_KEY", "").strip() else "no")
PY
sudo systemctl restart quickcart-api
sleep 2
curl -sf http://127.0.0.1:8000/health
echo
EOF
fi

echo
echo "Console (Vercel): ${URL:-see /tmp/qc-vercel-deploy.log}"
echo "API (AWS):        ${API_BASE}/health"
echo "Streamlit (AWS):  ${STREAMLIT_URL}"
