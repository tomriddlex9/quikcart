#!/usr/bin/env bash
# Install Ollama on the demo EC2 and pull a small model (default qwen2.5:1.5b).
# When QC_OLLAMA_INSTALL_REMOTE=1, runs on the current host (used from 02_deploy.sh).
set -euo pipefail

STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
ENV_FILE="${QC_AWS_DEMO_ENV_FILE:-/home/ubuntu/quikcart/.env.aws-demo}"
export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"
export OLLAMA_MODEL="$MODEL"
export OLLAMA_BASE_URL="$BASE_URL"

upsert_env_var() {
  local file="$1" key="$2" value="$3"
  if [[ ! -f "$file" ]]; then
    echo "${key}=${value}" >>"$file"
    return 0
  fi
  if grep -q "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    awk -v key="$key" -v value="$value" '
      BEGIN { replaced = 0 }
      $0 ~ "^" key "=" {
        print key "=" value
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) {
          print key "=" value
        }
      }
    ' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

write_ollama_env() {
  upsert_env_var "$ENV_FILE" OLLAMA_BASE_URL "$BASE_URL"
  upsert_env_var "$ENV_FILE" OLLAMA_MODEL "$MODEL"
}

run_install() {
  set -euo pipefail
  export PATH="$HOME/.local/bin:/usr/bin:/bin:$PATH"
  if ! command -v ollama >/dev/null 2>&1; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'UNIT'
[Service]
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now ollama
  ollama pull "${MODEL}"
  ollama list
  curl -sf "${BASE_URL}/api/tags" | head -c 400
  echo
  write_ollama_env
}

if [[ "${QC_OLLAMA_INSTALL_REMOTE:-}" == "1" ]]; then
  run_install
  echo "Ollama ready on $(hostname) with model ${MODEL}"
  exit 0
fi

if [[ ! -f "$STATE_FILE" ]]; then
  echo "Missing ${STATE_FILE}. Run 01_create.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$STATE_FILE"
: "${PUBLIC_IP:?PUBLIC_IP is missing from ${STATE_FILE}}"
: "${KEY_PATH:?KEY_PATH is missing from ${STATE_FILE}}"

ssh -i "$KEY_PATH" -o StrictHostKeyChecking=accept-new ubuntu@"$PUBLIC_IP" \
  env OLLAMA_MODEL="$MODEL" OLLAMA_BASE_URL="$BASE_URL" QC_AWS_DEMO_ENV_FILE="$ENV_FILE" bash -s <<'EOF'
set -euo pipefail
MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
ENV_FILE="${QC_AWS_DEMO_ENV_FILE:-/home/ubuntu/quikcart/.env.aws-demo}"
export PATH="$HOME/.local/bin:/usr/bin:/bin:$PATH"

upsert_env_var() {
  local file="$1" key="$2" value="$3"
  if [[ ! -f "$file" ]]; then
    echo "${key}=${value}" >>"$file"
    return 0
  fi
  if grep -q "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    awk -v key="$key" -v value="$value" '
      BEGIN { replaced = 0 }
      $0 ~ "^" key "=" {
        print key "=" value
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) {
          print key "=" value
        }
      }
    ' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

write_ollama_env() {
  upsert_env_var "$ENV_FILE" OLLAMA_BASE_URL "$BASE_URL"
  upsert_env_var "$ENV_FILE" OLLAMA_MODEL "$MODEL"
}

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'UNIT'
[Service]
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
ollama pull "${MODEL}"
ollama list
curl -sf "${BASE_URL}/api/tags" | head -c 400
echo
write_ollama_env
EOF

echo "Ollama ready on ${PUBLIC_IP} with model ${MODEL}"
