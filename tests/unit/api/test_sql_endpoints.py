"""HTTP contract tests for the console SQL + catalog endpoints.

`create_app` is built with an injected connection factory, a fake local model
and a tmp data root, so the whole request path (validation, guard, execution
adapter, response model) runs without PostgreSQL, Ollama or Spark.
"""

import json
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from quickcart.api.app import create_app
from tests.unit.api.fakes import FakeConnectFactory, FakeLLM

pytestmark = pytest.mark.unit

COLUMN_ROWS = [
    {
        "table_name": "orders",
        "column_name": "order_id",
        "data_type": "bigint",
        "is_nullable": "NO",
    },
    {
        "table_name": "customers",
        "column_name": "customer_id",
        "data_type": "bigint",
        "is_nullable": "NO",
    },
]
FK_ROWS = [
    {
        "from_table": "orders",
        "from_column": "customer_id",
        "to_table": "customers",
        "to_column": "customer_id",
    }
]
ORDER_ROWS = [{"order_id": 1, "status": "PLACED"}]


def responder(statement: str) -> tuple[list[str], list[dict]]:
    if "information_schema.columns" in statement:
        return ["table_name", "column_name", "data_type", "is_nullable"], COLUMN_ROWS
    if "information_schema.table_constraints" in statement:
        return ["from_table", "from_column", "to_table", "to_column"], FK_ROWS
    return ["order_id", "status"], ORDER_ROWS


def delta_table(root: Path, layer: str, name: str, columns: list[str]) -> None:
    log_dir = root / layer / name / "_delta_log"
    log_dir.mkdir(parents=True)
    schema = {
        "type": "struct",
        "fields": [
            {"name": column, "type": "long", "nullable": True, "metadata": {}}
            for column in columns
        ],
    }
    (log_dir / "00000000000000000000.json").write_text(
        json.dumps({"metaData": {"id": name, "schemaString": json.dumps(schema)}}) + "\n",
        encoding="utf-8",
    )


@pytest.fixture
def connect_factory() -> FakeConnectFactory:
    return FakeConnectFactory(responder=responder)


@pytest.fixture
def client(connect_factory: FakeConnectFactory, tmp_path: Path):
    delta_table(tmp_path, "silver", "silver_orders", ["order_id"])
    delta_table(tmp_path, "gold", "gold_customer_360", ["customer_id"])
    app = create_app(
        data_root=tmp_path,
        proposal_service=object(),  # never used by these routes
        connect_factory=connect_factory,
        llm=FakeLLM("SELECT order_id FROM orders"),
    )
    with TestClient(app) as test_client:
        yield test_client


class TestSqlExecute:
    def test_postgres_select_returns_the_result_envelope(self, client) -> None:
        response = client.post(
            "/api/v1/sql/execute",
            json={"source": "postgres", "sql": "SELECT order_id, status FROM orders"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["source"] == "postgres"
        assert body["columns"] == ["order_id", "status"]
        assert body["rows"] == ORDER_ROWS
        assert body["row_count"] == 1
        assert body["truncated"] is False
        assert body["elapsed_ms"] >= 0

    def test_write_is_rejected_with_400_and_a_reason(self, client) -> None:
        response = client.post(
            "/api/v1/sql/execute",
            json={"source": "postgres", "sql": "DELETE FROM orders"},
        )
        assert response.status_code == 400
        assert "only a single SELECT" in response.json()["detail"]

    def test_non_allow_listed_table_is_rejected(self, client) -> None:
        response = client.post(
            "/api/v1/sql/execute",
            json={"source": "postgres", "sql": "SELECT * FROM pg_catalog.pg_tables"},
        )
        assert response.status_code == 400

    def test_unknown_source_is_a_422(self, client) -> None:
        response = client.post(
            "/api/v1/sql/execute",
            json={"source": "duckdb", "sql": "SELECT * FROM orders"},
        )
        assert response.status_code == 422

    def test_unreachable_database_is_503(self, tmp_path: Path) -> None:
        app = create_app(
            data_root=tmp_path,
            proposal_service=object(),
            connect_factory=FakeConnectFactory(
                connect_error=psycopg.OperationalError("connection refused")
            ),
        )
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/sql/execute",
                json={"source": "postgres", "sql": "SELECT * FROM orders"},
            )
        assert response.status_code == 503


class TestSqlGenerate:
    def test_candidate_sql_is_returned_without_execution(self, client, connect_factory) -> None:
        response = client.post(
            "/api/v1/sql/generate",
            json={"source": "postgres", "question": "list order ids"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["sql"] == "SELECT order_id FROM orders LIMIT 500"
        assert body["valid"] is True
        assert body["degraded"] is False
        # Only the schema lookup ran; the candidate was never executed.
        assert all(
            "information_schema" in statement
            for statement in connect_factory.last.statements
            if statement.lower().startswith(("select", "with"))
        )

    def test_unavailable_model_degrades_with_http_200(self, tmp_path: Path) -> None:
        app = create_app(
            data_root=tmp_path,
            proposal_service=object(),
            connect_factory=FakeConnectFactory(responder=responder),
            llm=FakeLLM(error=RuntimeError("ollama chat failed: connection refused")),
        )
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/sql/generate",
                json={"source": "postgres", "question": "how many orders?"},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["degraded"] is True
        assert body["valid"] is False
        assert any("local model call failed" in note for note in body["notes"])


class TestCatalog:
    def test_tables_cover_raw_and_lakehouse_layers(self, client) -> None:
        response = client.get("/api/v1/catalog/tables")
        assert response.status_code == 200
        tables = response.json()["tables"]
        by_layer = {table["layer"] for table in tables}
        assert by_layer == {"raw", "silver", "gold"}
        orders = next(table for table in tables if table["name"] == "orders")
        assert orders["columns"] == [
            {"name": "order_id", "type": "bigint", "nullable": False}
        ]

    def test_raw_preview_uses_the_read_only_path(self, client, connect_factory) -> None:
        response = client.get("/api/v1/catalog/tables/raw/orders/preview?limit=10")
        assert response.status_code == 200
        body = response.json()
        assert body["rows"] == ORDER_ROWS
        assert body["source"] == "postgres"
        assert connect_factory.last.read_only is True

    def test_unknown_layer_is_a_422(self, client) -> None:
        assert client.get("/api/v1/catalog/tables/platinum/orders/preview").status_code == 422

    def test_table_outside_the_allow_list_is_404(self, client) -> None:
        response = client.get("/api/v1/catalog/tables/raw/order_events/preview")
        assert response.status_code == 404

    def test_preview_limit_above_the_cap_is_a_422(self, client) -> None:
        assert (
            client.get("/api/v1/catalog/tables/raw/orders/preview?limit=5000").status_code == 422
        )

    def test_er_graph_exposes_foreign_key_edges(self, client) -> None:
        response = client.get("/api/v1/catalog/er")
        assert response.status_code == 200
        body = response.json()
        assert {table["name"] for table in body["tables"]} == {"orders", "customers"}
        assert body["edges"] == FK_ROWS


def test_console_origin_may_post_sql(client) -> None:
    """CORS still covers the new POST routes for the Next.js console."""
    preflight = client.options(
        "/api/v1/sql/execute",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "POST" in preflight.headers["access-control-allow-methods"]

    response = client.post(
        "/api/v1/sql/execute",
        json={"source": "postgres", "sql": "SELECT order_id, status FROM orders"},
        headers={"Origin": "http://localhost:3000"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
