"""Lakehouse execution path for POST /api/v1/sql/execute, against real Spark.

Uses the shared `spark_session` fixture and a tiny Delta table written to a tmp
data root, so the parts a fake cannot prove — temp-view registration per
allow-listed table, Spark's own column names, and how a Spark failure is
translated — are exercised for real.
"""

import threading
from decimal import Decimal
from pathlib import Path

import pytest

from quickcart.api.sql_guard import SqlGuardError
from quickcart.api.sql_service import SqlExecutionError, execute_lakehouse

pytestmark = pytest.mark.unit


@pytest.fixture(scope="module")
def lakehouse_root(spark_session, tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("console_lakehouse")
    rows = [
        (1, 10, "DELIVERED", Decimal("556.50")),
        (2, 10, "CANCELLED", Decimal("300.00")),
        (3, 20, "DELIVERED", Decimal("700.00")),
        (4, 20, "DELIVERED", Decimal("120.25")),
    ]
    df = spark_session.createDataFrame(
        rows, "order_id: bigint, store_id: bigint, status: string, total_amount: decimal(12,2)"
    )
    df.write.format("delta").save(str(root / "silver" / "silver_orders"))
    return root


def test_select_returns_columns_and_json_safe_rows(spark_session, lakehouse_root: Path) -> None:
    result = execute_lakehouse(
        "SELECT order_id, total_amount FROM silver_orders WHERE store_id = 10",
        spark=spark_session,
        data_root=lakehouse_root,
    )
    assert result.source == "lakehouse"
    assert result.columns == ["order_id", "total_amount"]
    assert sorted(row["order_id"] for row in result.rows) == [1, 2]
    assert result.rows[0]["total_amount"] == pytest.approx(556.50)
    assert result.row_count == 2
    assert result.truncated is False
    assert result.elapsed_ms > 0


def test_aggregate_over_a_registered_view(spark_session, lakehouse_root: Path) -> None:
    result = execute_lakehouse(
        "SELECT store_id, count(*) AS orders FROM silver_orders GROUP BY store_id",
        spark=spark_session,
        data_root=lakehouse_root,
    )
    assert result.columns == ["store_id", "orders"]
    assert {row["store_id"]: row["orders"] for row in result.rows} == {10: 2, 20: 2}


def test_request_limit_caps_rows_and_flags_truncation(
    spark_session, lakehouse_root: Path
) -> None:
    result = execute_lakehouse(
        "SELECT order_id FROM silver_orders", spark=spark_session, limit=2, data_root=lakehouse_root
    )
    assert result.row_count == 2
    assert result.truncated is True


def test_write_is_refused_before_spark_runs(spark_session, lakehouse_root: Path) -> None:
    with pytest.raises(SqlGuardError):
        execute_lakehouse(
            "DELETE FROM silver_orders", spark=spark_session, data_root=lakehouse_root
        )


def test_unbuilt_table_is_404(spark_session, lakehouse_root: Path) -> None:
    with pytest.raises(SqlExecutionError) as exc:
        execute_lakehouse(
            "SELECT * FROM gold_not_built_yet", spark=spark_session, data_root=lakehouse_root
        )
    assert exc.value.status_code == 404
    assert "not built yet" in exc.value.detail


def test_spark_failure_is_reported_as_400(spark_session, lakehouse_root: Path) -> None:
    with pytest.raises(SqlExecutionError) as exc:
        execute_lakehouse(
            "SELECT nope FROM silver_orders", spark=spark_session, data_root=lakehouse_root
        )
    assert exc.value.status_code == 400
    assert "nope" in exc.value.detail


class _BlockingSpark:
    """Spark stand-in whose query blocks until its job group is cancelled."""

    def __init__(self) -> None:
        self.cancelled: list[str] = []
        self.groups: list[str] = []
        self._released = threading.Event()

    # reader / session surface
    @property
    def read(self) -> "_BlockingSpark":
        return self

    def format(self, _: str) -> "_BlockingSpark":
        return self

    def load(self, _: str) -> "_BlockingSpark":
        return self

    def createOrReplaceTempView(self, _: str) -> None:
        return None

    @property
    def sparkContext(self) -> "_BlockingSpark":
        return self

    def setJobGroup(self, group: str, _: str) -> None:
        self.groups.append(group)

    def cancelJobGroup(self, group: str) -> None:
        self.cancelled.append(group)
        self._released.set()

    def sql(self, _: str) -> "_BlockingSpark":
        self._released.wait(10)
        raise RuntimeError("job cancelled")


def test_timeout_cancels_the_job_group(tmp_path: Path) -> None:
    (tmp_path / "silver" / "silver_orders" / "_delta_log").mkdir(parents=True)
    spark = _BlockingSpark()
    with pytest.raises(SqlExecutionError) as exc:
        execute_lakehouse(
            "SELECT * FROM silver_orders",
            spark=spark,
            data_root=tmp_path,
            timeout_seconds=0.05,
        )
    assert exc.value.status_code == 504
    assert "timed out" in exc.value.detail
    assert spark.cancelled == spark.groups


def test_missing_spark_is_503(lakehouse_root: Path) -> None:
    with pytest.raises(SqlExecutionError) as exc:
        execute_lakehouse(
            "SELECT * FROM silver_orders", spark=None, data_root=lakehouse_root
        )
    assert exc.value.status_code == 503
