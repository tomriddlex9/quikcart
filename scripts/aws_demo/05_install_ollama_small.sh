#!/usr/bin/env bash
# Install Ollama on the demo EC2 and pull a small model (default qwen2.5:1.5b).
set -euo pipefail

STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
MODEL="${OLLAMA_MODEL:-qwen2.5:1.5b}"
export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"

# shellcheck disable=SC1090
source "$STATE_FILE"

ssh -i "$KEY_PATH" -o StrictHostKeyChecking=accept-new ubuntu@"$PUBLIC_IP" bash <<EOF
set -euo pipefail
export PATH="\$HOME/.local/bin:/usr/bin:/bin:\$PATH"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
# Prefer CPU-friendly small model; limit parallel runners on 8GB hosts
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'UNIT'
[Service]
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
# Pull may take several minutes
ollama pull ${MODEL}
ollama list
curl -sf http://127.0.0.1:11434/api/tags | head -c 400; echo
EOF

echo "Ollama ready on ${PUBLIC_IP} with model ${MODEL}"
