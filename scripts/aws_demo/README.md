# QuickCart AWS live demo

Short-lived EC2 showcase for the live QuickCart stack. The demo runs
PostgreSQL, Redpanda/Console, Debezium, and Qdrant in Docker; FastAPI, the
continuous writer/worker, Next.js, and Streamlit run as systemd services.
MLflow is deliberately not started. Training writes its optional tracking data
to `data/mlruns` on the instance.

The default `t3.xlarge` in Mumbai is not free. **Destroy the instance after the
demo.** PostgreSQL and Qdrant are publicly bound by the demo override, so use
the short-lived security group only; do not treat this as a production setup.

## Prerequisites

```bash
aws login --region ap-south-1   # or: aws configure
aws sts get-caller-identity
```

State (instance ID, public IP, key path, and security group) is stored in
`scripts/aws_demo/.state.env`, which is gitignored. If the instance already
exists, `02_deploy.sh` reuses that state and redeploys in place.

## Deploy and verify

From the repository root:

```bash
# Only needed when there is no reusable instance in .state.env.
./scripts/aws_demo/01_create.sh

# Safe to rerun: sync, seed a small history, rebuild the lakehouse/models/RAG,
# register Debezium, build Next.js, and restart all systemd services.
./scripts/aws_demo/02_deploy.sh

# Checks HTTP endpoints, 60-second pipeline growth, SSE events, and free -m.
./scripts/aws_demo/03_verify.sh
```

Public endpoints are printed by the deploy script:

- Next.js console: `http://PUBLIC_IP:3000`
- FastAPI and docs: `http://PUBLIC_IP:8000/health` and `/docs`
- Streamlit: `http://PUBLIC_IP:8501`
- Qdrant dashboard: `http://PUBLIC_IP:6333/dashboard`

The verification script specifically checks `/api/v1/live/snapshot`, samples
`/api/v1/live/pipeline` twice 60 seconds apart, and requires at least two
`data:` events from `/api/v1/live/stream` in ten seconds.

## Services and logs

The deploy installs these units from `scripts/aws_demo/systemd/`:

```text
quickcart-api
quickcart-live-writer
quickcart-live-worker
quickcart-next
quickcart-streamlit
```

Inspect them on the instance:

```bash
source scripts/aws_demo/.state.env
ssh -i "$KEY_PATH" "ubuntu@$PUBLIC_IP" \
  'systemctl --no-pager --full status quickcart-{api,live-writer,live-worker,next,streamlit}'
ssh -i "$KEY_PATH" "ubuntu@$PUBLIC_IP" \
  'journalctl -f -u quickcart-live-worker -u quickcart-live-writer'
```

For a lower-cost deployment, reduce the historical order count or skip the
anomaly model:

```bash
QC_DEMO_HISTORICAL_ORDERS=5000 QC_SKIP_ANOMALY=1 \
  ./scripts/aws_demo/02_deploy.sh
```

These variables must be exported for the remote command, for example:

```bash
export QC_DEMO_HISTORICAL_ORDERS=5000
export QC_SKIP_ANOMALY=1
./scripts/aws_demo/02_deploy.sh
```

## Tear down

```bash
# DESTROYS the instance and its volumes, stopping EC2/EBS billing.
./scripts/aws_demo/99_destroy.sh
```
