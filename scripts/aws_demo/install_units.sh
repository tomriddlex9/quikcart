#!/usr/bin/env bash
# Install/reload the QuickCart demo services on the EC2 host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR="${ROOT}/scripts/aws_demo/systemd"
UNITS=(
  quickcart-api.service
  quickcart-live-writer.service
  quickcart-live-worker.service
  quickcart-next.service
  quickcart-streamlit.service
)

for unit in "${UNITS[@]}"; do
  if [[ ! -f "${UNIT_DIR}/${unit}" ]]; then
    echo "Missing unit: ${UNIT_DIR}/${unit}" >&2
    exit 1
  fi
  sudo install -m 0644 "${UNIT_DIR}/${unit}" "/etc/systemd/system/${unit}"
done

sudo systemctl daemon-reload
sudo systemctl enable --now "${UNITS[@]}"
# `enable --now` leaves already-running units untouched. Restart so a redeploy
# always picks up the newly synced code, environment, frontend build, and units.
sudo systemctl restart "${UNITS[@]}"
sudo systemctl --no-pager --full status "${UNITS[@]}" | sed -n '1,90p'
