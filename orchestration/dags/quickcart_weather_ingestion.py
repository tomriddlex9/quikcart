"""quickcart_weather_ingestion — scheduled weather enrichment (kit/03 §9).

Uses the Open-Meteo free API with an automatic deterministic fixture
fallback (kit/02 FR-005) so the DAG succeeds without network access.
"""

from datetime import datetime

from airflow import DAG
from airflow.operators.bash import BashOperator

PROJECT = "/opt/airflow/project"

with DAG(
    dag_id="quickcart_weather_ingestion",
    description="Weather enrichment with local fixture fallback",
    schedule=None,
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args={"retries": 1},
    tags=["quickcart", "ingestion"],
) as dag:
    BashOperator(
        task_id="ingest_weather",
        bash_command=f"cd {PROJECT} && uv run --all-groups python -m quickcart.ingestion.weather",
    )
