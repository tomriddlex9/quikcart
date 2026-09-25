#!/usr/bin/env bash
# Create a short-lived QuickCart demo EC2 in ap-south-1 (Mumbai).
# Default: t3.xlarge (4 vCPU / 16 GiB) — enough for compose + API + Next + Streamlit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${STATE_DIR}/.state.env"
REGION="${AWS_REGION:-ap-south-1}"
INSTANCE_TYPE="${QC_AWS_INSTANCE_TYPE:-t3.xlarge}"
NAME_TAG="${QC_AWS_NAME:-quickcart-demo}"
KEY_NAME="${QC_AWS_KEY_NAME:-quickcart-demo}"
SG_NAME="${QC_AWS_SG_NAME:-quickcart-demo-sg}"
# Ubuntu 24.04 LTS amd64 — update via SSM param if this AMI ages out
AMI_ID="${QC_AWS_AMI_ID:-}"

export PATH="/usr/bin:/bin:/opt/homebrew/bin:$PATH"
export AWS_DEFAULT_REGION="$REGION"

need_identity() {
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "No AWS credentials. Run: aws login --region ${REGION}" >&2
    echo "Or: aws configure" >&2
    exit 1
  fi
}

need_identity
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account=${ACCOUNT} Region=${REGION} Type=${INSTANCE_TYPE}"

if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  if [[ -n "${INSTANCE_ID:-}" ]]; then
    EXISTING="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || true)"
    if [[ "$EXISTING" == "running" || "$EXISTING" == "pending" ]]; then
      echo "Instance ${INSTANCE_ID} already ${EXISTING}. Reusing."
      PUBLIC_IP="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
      echo "PUBLIC_IP=${PUBLIC_IP}"
      exit 0
    fi
  fi
fi

if [[ -z "$AMI_ID" ]]; then
  AMI_ID="$(aws ssm get-parameters \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)"
fi
echo "AMI=${AMI_ID}"

mkdir -p "${STATE_DIR}/.secrets"
KEY_PATH="${STATE_DIR}/.secrets/${KEY_NAME}.pem"
chmod 700 "${STATE_DIR}/.secrets"

if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  aws ec2 create-key-pair --key-name "$KEY_NAME" --query 'KeyMaterial' --output text >"$KEY_PATH"
  chmod 400 "$KEY_PATH"
  echo "Created key pair ${KEY_NAME} -> ${KEY_PATH}"
else
  if [[ ! -f "$KEY_PATH" ]]; then
    echo "Key pair ${KEY_NAME} exists in AWS but local PEM missing at ${KEY_PATH}." >&2
    echo "Delete the remote key or restore the PEM, then re-run." >&2
    exit 1
  fi
fi

SG_ID="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${SG_NAME}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
  VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text)"
  SG_ID="$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "QuickCart demo (SSH + HTTP showcase ports)" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)"
  # SSH
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port 22 --cidr 0.0.0.0/0 >/dev/null
  # Showcase ports (tighten after demo if you keep the box)
  for port in 80 443 3000 8000 8501 5000 6333; do
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null || true
  done
  echo "Created security group ${SG_ID}"
fi

USER_DATA="$(cat <<'EOF'
#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git openjdk-17-jre-headless
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker ubuntu
# uv for Python host processes
curl -LsSf https://astral.sh/uv/install.sh | sudo -u ubuntu sh
EOF
)"

INSTANCE_ID="$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --count 1 \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":40,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME_TAG}},{Key=project,Value=quickcart},{Key=purpose,Value=demo}]" \
  --user-data "$USER_DATA" \
  --query 'Instances[0].InstanceId' --output text)"

echo "Waiting for ${INSTANCE_ID} to be running + status OK..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID" || true

PUBLIC_IP="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"

cat >"$STATE_FILE" <<EOF
REGION=${REGION}
ACCOUNT=${ACCOUNT}
INSTANCE_ID=${INSTANCE_ID}
INSTANCE_TYPE=${INSTANCE_TYPE}
PUBLIC_IP=${PUBLIC_IP}
KEY_NAME=${KEY_NAME}
KEY_PATH=${KEY_PATH}
SG_ID=${SG_ID}
AMI_ID=${AMI_ID}
NAME_TAG=${NAME_TAG}
EOF

echo "Wrote ${STATE_FILE}"
echo "PUBLIC_IP=${PUBLIC_IP}"
echo "SSH: ssh -i ${KEY_PATH} ubuntu@${PUBLIC_IP}"
echo "Next: ./scripts/aws_demo/02_deploy.sh"
