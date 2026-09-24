"""quickcart_daily_lakehouse — batch medallion refresh (kit/03 §9).

Task chain: export raw → bronze → silver (quality gate) → gold. The silver
step exits non-zero when the quarantine gate trips, which blocks the gold
publish task by ordinary all-success dependency semantics (kit/07 Phase 9:
"intentional quality failure blocks dependent publish task"). Streaming and
CDC remain independent long-running services — Airflow never schedules them.
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.bash import BashOperator

PROJECT = "/opt/airflow/project"

default_args = {
    "owner": "quickcart",
    "retries": 2,
    "retry_delay": timedelta(minutes=1),
}

with DAG(
    dag_id="quickcart_daily_lakehouse",
    description="Export raw → Bronze → Silver (quality gate) → Gold",
    schedule=None,  # learning project: trigger manually / via dags test
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args=default_args,
    tags=["quickcart", "lakehouse"],
) as dag:
    export_raw = BashOperator(
        task_id="export_raw",
        bash_command=(
            f"cd {PROJECT} && uv run --all-groups python -m quickcart.ingestion.export"
        ),
    )
    bronze = BashOperator(
        task_id="build_bronze",
        bash_command=(
            f"cd {PROJECT} && uv run --all-groups python -m quickcart.lakehouse.pipeline bronze"
        ),
    )
    silver = BashOperator(
        task_id="build_silver_quality_gate",
        bash_command=(
            f"cd {PROJECT} && uv run --all-groups python -m quickcart.lakehouse.pipeline silver"
        ),
    )
    gold = BashOperator(
        task_id="publish_gold",
        bash_command=(
            f"cd {PROJECT} && uv run --all-groups python -m quickcart.lakehouse.pipeline gold"
        ),
    )

    export_raw >> bronze >> silver >> gold
