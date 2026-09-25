#!/usr/bin/env bash
# Terminate the demo instance (and rely on DeleteOnTermination for the root volume).
set -euo pipefail

STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "No state file — nothing to destroy."
  exit 0
fi
# shellcheck disable=SC1090
source "$STATE_FILE"

echo "Terminating ${INSTANCE_ID} (${PUBLIC_IP}) in ${REGION}..."
aws ec2 terminate-instances --region "$REGION" --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$INSTANCE_ID"
echo "Terminated."

# Optional cleanup of demo SG + key (commented by default — recreate is fine)
# aws ec2 delete-security-group --group-id "$SG_ID" || true
# aws ec2 delete-key-pair --key-name "$KEY_NAME" || true

mv "$STATE_FILE" "${STATE_FILE}.destroyed.$(date +%Y%m%d%H%M%S)"
echo "Billing for compute should stop now. Confirm in AWS Billing console."
