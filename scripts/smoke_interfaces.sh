#!/usr/bin/env bash
# Final integration smoke: FastAPI up, live agent answer, frontend build+serve.
set -uo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="$(brew --prefix openjdk@17)"
export OLLAMA_MODEL=qwen3:4b

echo "=== 1. API health + status"
uv run python -m quickcart.api > /tmp/api_smoke.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break; sleep 2; done
curl -s http://127.0.0.1:8000/health; echo
curl -s http://127.0.0.1:8000/api/v1/system/status | head -c 400; echo

echo "=== 2. Live agent question (real qwen3:4b + Gold + Qdrant)"
curl -s -X POST http://127.0.0.1:8000/api/v1/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Which store has the highest late delivery rate, and is there a company document about handling delivery incidents?"}' | head -c 1200; echo

echo "=== 3. Proposals lifecycle via API"
PROP=$(curl -s -X POST http://127.0.0.1:8000/api/v1/proposals \
  -H 'Content-Type: application/json' \
  -d '{"proposal_type": "RESTOCK", "entity_scope": {"store_id": 1, "product_id": 1, "quantity": 25}, "recommended_action": "Restock 25 units", "reason": "smoke test", "evidence": ["demo"]}')
echo "$PROP" | head -c 300; echo
PID_=$(echo "$PROP" | python3 -c "import json,sys; print(json.load(sys.stdin)['proposal_id'])")
curl -s -X POST "http://127.0.0.1:8000/api/v1/proposals/$PID_/approve" \
  -H 'Content-Type: application/json' -d '{"approver": "smoke-test"}' | head -c 300; echo
curl -s "http://127.0.0.1:8000/api/v1/proposals/$PID_/audit" | head -c 400; echo

kill $API_PID 2>/dev/null
echo "=== 4. Frontend production build"
cd frontend && npm run build 2>&1 | grep -E "Compiled|error" | head -2
echo "SMOKE_DONE"
