"""Catalog reads for the console: raw Postgres metadata, Delta schemas, ER edges.

Postgres metadata is served by `FakeConnection` (information_schema shapes), and
Delta schemas are read from hand-written ``_delta_log`` commits, so nothing here
needs a database or a Spark session.
"""

import json
from pathlib import Path

import psycopg
import pytest

from quickcart.api import catalog
from quickcart.api.catalog import (
    CatalogError,
    delta_log_columns,
    delta_tables,
    entity_relationships,
    foreign_keys,
    list_tables,
    postgres_tables,
    preview_postgres,
    schema_summary,
    validate_table_name,
)
from tests.unit.api.fakes import FakeConnectFactory, FakeSpark

pytestmark = pytest.mark.unit

COLUMN_ROWS = [
    {
        "table_name": "orders",
        "column_name": "order_id",
        "data_type": "bigint",
        "is_nullable": "NO",
    },
    {
        "table_name": "orders",
        "column_name": "customer_id",
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
    },
    {  # duplicate row (information_schema emits one per column pair)
        "from_table": "orders",
        "from_column": "customer_id",
        "to_table": "customers",
        "to_column": "customer_id",
    },
    {  # target outside the allow-list is dropped
        "from_table": "orders",
        "from_column": "event_id",
        "to_table": "order_events",
        "to_column": "event_id",
    },
]


def information_schema_factory(**kwargs) -> FakeConnectFactory:
    def responder(statement: str) -> tuple[list[str], list[dict]]:
        if "information_schema.columns" in statement:
            return list(COLUMN_ROWS[0]), COLUMN_ROWS
        if "information_schema.table_constraints" in statement:
            return list(FK_ROWS[0]), FK_ROWS
        return ["order_id"], [{"order_id": 1}]

    return FakeConnectFactory(responder=responder, **kwargs)


def write_delta_table(root: Path, layer: str, name: str, fields: list[dict]) -> Path:
    path = root / layer / name
    log_dir = path / "_delta_log"
    log_dir.mkdir(parents=True)
    commit = {
        "metaData": {
            "id": name,
            "format": {"provider": "parquet"},
            "schemaString": json.dumps({"type": "struct", "fields": fields}),
        }
    }
    (log_dir / "00000000000000000000.json").write_text(
        json.dumps({"commitInfo": {"operation": "WRITE"}}) + "\n" + json.dumps(commit) + "\n",
        encoding="utf-8",
    )
    return path


def field(name: str, type_: object = "long", nullable: bool = True) -> dict:
    return {"name": name, "type": type_, "nullable": nullable, "metadata": {}}


class TestPostgresMetadata:
    def test_columns_are_grouped_per_table(self) -> None:
        tables = postgres_tables(information_schema_factory())
        assert [table["name"] for table in tables] == ["customers", "orders"]
        orders = next(table for table in tables if table["name"] == "orders")
        assert orders["layer"] == "raw"
        assert orders["location"] == "public.orders"
        assert orders["columns"] == [
            {"name": "order_id", "type": "bigint", "nullable": False},
            {"name": "customer_id", "type": "bigint", "nullable": False},
        ]

    def test_only_allow_listed_tables_are_requested(self) -> None:
        connect_factory = information_schema_factory()
        postgres_tables(connect_factory)
        params = connect_factory.last.events[-1][2]
        assert "orders" in params[0]
        assert "order_events" not in params[0]

    def test_foreign_keys_are_deduplicated_and_filtered(self) -> None:
        assert foreign_keys(information_schema_factory()) == [
            {
                "from_table": "orders",
                "from_column": "customer_id",
                "to_table": "customers",
                "to_column": "customer_id",
            }
        ]

    def test_er_response_shape(self) -> None:
        er = entity_relationships(information_schema_factory())
        assert [table["name"] for table in er["tables"]] == ["customers", "orders"]
        assert er["edges"][0]["from_table"] == "orders"
        assert set(er["edges"][0]) == {"from_table", "from_column", "to_table", "to_column"}

    def test_er_reports_an_unreachable_database(self) -> None:
        connect_factory = FakeConnectFactory(
            connect_error=psycopg.OperationalError("connection refused")
        )
        with pytest.raises(CatalogError) as exc:
            entity_relationships(connect_factory)
        assert exc.value.status_code == 503


class TestPreview:
    def test_raw_preview_reads_one_extra_row_to_detect_truncation(self) -> None:
        rows = [{"order_id": i} for i in range(51)]
        connect_factory = FakeConnectFactory(columns=["order_id"], rows=rows)
        preview = preview_postgres("orders", limit=50, connect_factory=connect_factory)
        assert connect_factory.last.statements[1] == "SELECT * FROM orders LIMIT 51"
        assert preview["row_count"] == 50
        assert preview["truncated"] is True
        assert preview["source"] == "postgres"
        assert preview["layer"] == "raw"

    def test_unknown_raw_table_is_404(self) -> None:
        with pytest.raises(CatalogError) as exc:
            validate_table_name("raw", "order_events")
        assert exc.value.status_code == 404

    @pytest.mark.parametrize("name", ["../../etc/passwd", "Orders", "silver orders", ""])
    def test_lakehouse_table_names_are_pattern_checked(self, name: str) -> None:
        with pytest.raises(CatalogError, match="invalid table name"):
            validate_table_name("silver", name)

    def test_unknown_layer_rejected(self) -> None:
        with pytest.raises(CatalogError, match="unknown layer"):
            catalog.validate_layer("platinum")

    def test_lakehouse_preview_without_spark_is_503(self, tmp_path: Path) -> None:
        write_delta_table(tmp_path, "silver", "silver_orders", [field("order_id")])
        with pytest.raises(CatalogError) as exc:
            catalog.preview_delta(
                "silver", "silver_orders", spark=None, data_root=tmp_path
            )
        assert exc.value.status_code == 503

    def test_lakehouse_preview_caps_rows_and_reports_truncation(self, tmp_path: Path) -> None:
        write_delta_table(tmp_path, "silver", "silver_orders", [field("order_id")])
        spark = FakeSpark(["order_id"], [{"order_id": i} for i in range(10)])
        preview = catalog.preview_delta(
            "silver", "silver_orders", limit=3, spark=spark, data_root=tmp_path
        )
        assert preview["columns"] == ["order_id"]
        assert preview["row_count"] == 3
        assert preview["truncated"] is True
        assert preview["source"] == "lakehouse"
        assert preview["elapsed_ms"] >= 0

    def test_missing_lakehouse_table_is_404(self, tmp_path: Path) -> None:
        with pytest.raises(CatalogError) as exc:
            catalog.preview_delta("gold", "gold_missing", spark=None, data_root=tmp_path)
        assert exc.value.status_code == 404


class TestDeltaSchema:
    def test_columns_come_from_the_delta_log(self, tmp_path: Path) -> None:
        path = write_delta_table(
            tmp_path,
            "silver",
            "silver_orders",
            [field("order_id"), field("total_amount", "decimal(12,2)", nullable=False)],
        )
        assert delta_log_columns(path) == [
            {"name": "order_id", "type": "long", "nullable": True},
            {"name": "total_amount", "type": "decimal(12,2)", "nullable": False},
        ]

    def test_nested_types_are_named_not_expanded(self, tmp_path: Path) -> None:
        path = write_delta_table(
            tmp_path,
            "gold",
            "gold_nested",
            [field("payload", {"type": "struct", "fields": []})],
        )
        assert delta_log_columns(path) == [
            {"name": "payload", "type": "struct", "nullable": True}
        ]

    def test_directory_without_a_delta_log_is_not_a_table(self, tmp_path: Path) -> None:
        (tmp_path / "silver" / "not_delta").mkdir(parents=True)
        write_delta_table(tmp_path, "silver", "silver_orders", [field("order_id")])
        assert [table["name"] for table in delta_tables(tmp_path)] == ["silver_orders"]

    def test_tables_are_listed_per_layer(self, tmp_path: Path) -> None:
        write_delta_table(tmp_path, "bronze", "bronze_orders", [field("order_id")])
        write_delta_table(tmp_path, "silver", "silver_orders", [field("order_id")])
        write_delta_table(tmp_path, "gold", "gold_customer_360", [field("customer_id")])
        listed = [(table["layer"], table["name"]) for table in delta_tables(tmp_path)]
        assert listed == [
            ("bronze", "bronze_orders"),
            ("silver", "silver_orders"),
            ("gold", "gold_customer_360"),
        ]

    def test_missing_schema_falls_back_to_spark(self, tmp_path: Path) -> None:
        """A log with no metaData action (checkpoint-only) still yields columns."""
        path = tmp_path / "silver" / "silver_empty"
        (path / "_delta_log").mkdir(parents=True)
        spark = FakeSpark(["order_id"])
        assert delta_log_columns(path) == []
        assert catalog.delta_columns(path, spark) == [
            {"name": "order_id", "type": "bigint", "nullable": True}
        ]
        assert spark.loaded == [str(path)]


class TestListTables:
    def test_raw_and_lakehouse_tables_are_combined(self, tmp_path: Path) -> None:
        write_delta_table(tmp_path, "silver", "silver_orders", [field("order_id")])
        listing = list_tables(
            connect_factory=information_schema_factory(), data_root=tmp_path
        )
        layers = {table["layer"] for table in listing["tables"]}
        assert layers == {"raw", "silver"}
        assert listing["notes"] == []

    def test_unreachable_postgres_degrades_with_a_note(self, tmp_path: Path) -> None:
        write_delta_table(tmp_path, "gold", "gold_customer_360", [field("customer_id")])
        listing = list_tables(
            connect_factory=FakeConnectFactory(
                connect_error=psycopg.OperationalError("connection refused")
            ),
            data_root=tmp_path,
        )
        assert [table["layer"] for table in listing["tables"]] == ["gold"]
        assert any("raw layer unavailable" in note for note in listing["notes"])

    def test_empty_data_root_is_reported(self, tmp_path: Path) -> None:
        listing = list_tables(
            connect_factory=information_schema_factory(), data_root=tmp_path
        )
        assert any("no Delta tables" in note for note in listing["notes"])


class TestSchemaSummary:
    def test_postgres_summary_lists_columns(self) -> None:
        text, tables, notes = schema_summary(
            "postgres", connect_factory=information_schema_factory()
        )
        assert "- orders(order_id bigint, customer_id bigint)" in text
        assert tables == ["customers", "orders"]
        assert notes == []

    def test_postgres_summary_degrades_to_names(self) -> None:
        text, tables, notes = schema_summary(
            "postgres",
            connect_factory=FakeConnectFactory(
                connect_error=psycopg.OperationalError("connection refused")
            ),
        )
        assert "- orders" in text
        assert "proposals" in tables
        assert any("column names unavailable" in note for note in notes)

    def test_lakehouse_summary_covers_silver_and_gold_only(self, tmp_path: Path) -> None:
        write_delta_table(tmp_path, "bronze", "bronze_orders", [field("order_id")])
        write_delta_table(tmp_path, "silver", "silver_orders", [field("order_id")])
        write_delta_table(tmp_path, "gold", "gold_customer_360", [field("customer_id")])
        _, tables, notes = schema_summary("lakehouse", data_root=tmp_path)
        assert tables == ["silver_orders", "gold_customer_360"]
        assert notes == []

    def test_lakehouse_summary_notes_an_empty_data_root(self, tmp_path: Path) -> None:
        _, tables, notes = schema_summary("lakehouse", data_root=tmp_path)
        assert tables == []
        assert any("no silver/gold Delta tables" in note for note in notes)
