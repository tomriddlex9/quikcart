"""Delta MERGE and SCD2 tests (kit/07 Phase 5 acceptance)."""

from datetime import datetime

import pytest
from pyspark.sql import functions as F

from quickcart.lakehouse.common.merge import delete_keys, upsert
from quickcart.lakehouse.silver.scd2 import apply_scd2

pytestmark = pytest.mark.unit

EFFECTIVE = datetime(2026, 9, 23, 12, 0, 0)


def _dim(spark, rows):
    return spark.createDataFrame(
        rows,
        "address_id: bigint, customer_id: bigint, city: string, postal_code: string, "
        "valid_from: timestamp, valid_to: timestamp, is_current: boolean, updated_at: timestamp",
    )


def test_merge_inserts_new_key_and_updates_existing(spark_session, tmp_path) -> None:
    initial = spark_session.createDataFrame(
        [(1, "Mumbai", "400001")], "store_id: bigint, city: string, postal_code: string"
    )
    target = tmp_path / "dim"
    initial.write.format("delta").save(str(target))

    new_rows = spark_session.createDataFrame(
        [(1, "Mumbai", "400002"), (2, "Delhi", "110001")],
        "store_id: bigint, city: string, postal_code: string",
    )
    metrics = upsert(spark_session, target, new_rows, "store_id")
    assert metrics == {"inserted": 1, "updated": 1, "deleted": 0}

    stored = spark_session.read.format("delta").load(str(target))
    by_key = {r["store_id"]: r for r in stored.collect()}
    assert by_key[1]["postal_code"] == "400002"
    assert by_key[2]["city"] == "Delhi"

    # Rerunning with the same source is state-idempotent: Delta counts the
    # matched rows as "updated" even though values are identical, and the
    # table contents do not change.
    again = upsert(spark_session, target, new_rows, "store_id")
    assert again == {"inserted": 0, "updated": 2, "deleted": 0}
    stored_after = spark_session.read.format("delta").load(str(target))
    assert {r["store_id"]: r["postal_code"] for r in stored_after.collect()} == {
        r["store_id"]: r["postal_code"] for r in stored.collect()
    }


def test_merge_delete_keys(spark_session, tmp_path) -> None:
    initial = spark_session.createDataFrame(
        [(1, "A"), (2, "B")], "store_id: bigint, city: string"
    )
    target = tmp_path / "dim_del"
    initial.write.format("delta").save(str(target))
    keys = spark_session.createDataFrame([(1,)], "store_id: bigint")
    metrics = delete_keys(spark_session, target, keys, "store_id")
    assert metrics == {"deleted": 1}
    stored = spark_session.read.format("delta").load(str(target))
    remaining = [r["store_id"] for r in stored.collect()]
    assert remaining == [2]


def test_scd2_closes_old_and_opens_new(spark_session) -> None:
    existing = _dim(
        spark_session,
        [(1, 100, "Mumbai", "400001", datetime(2026, 1, 1), None, True, datetime(2026, 1, 1))],
    )
    changes = spark_session.createDataFrame(
        [(1, 100, "Pune", "411001", datetime(2026, 9, 1))],
        "address_id: bigint, customer_id: bigint, city: string, postal_code: string, "
        "updated_at: timestamp",
    )
    result = apply_scd2(
        existing, changes, key="address_id", attributes=["city", "postal_code"],
        effective_time=EFFECTIVE, order_column="updated_at",
    ).collect()
    assert len(result) == 2
    closed = next(r for r in result if not r["is_current"])
    opened = next(r for r in result if r["is_current"])
    assert closed["city"] == "Mumbai"
    assert closed["valid_to"] == EFFECTIVE
    assert opened["city"] == "Pune"
    assert opened["valid_from"] == EFFECTIVE
    assert opened["valid_to"] is None


def test_scd2_rerun_is_noop_and_new_key_inserts(spark_session) -> None:
    existing = _dim(
        spark_session,
        [(1, 100, "Mumbai", "400001", datetime(2026, 1, 1), None, True, datetime(2026, 1, 1))],
    )
    change = spark_session.createDataFrame(
        [(1, 100, "Pune", "411001", datetime(2026, 9, 1))],
        "address_id: bigint, customer_id: bigint, city: string, postal_code: string, "
        "updated_at: timestamp",
    )
    first = apply_scd2(
        existing, change, key="address_id", attributes=["city", "postal_code"],
        effective_time=EFFECTIVE,
    )
    # Rerunning the same batch must not create another version.
    second = apply_scd2(
        first, change, key="address_id", attributes=["city", "postal_code"],
        effective_time=EFFECTIVE,
    )
    assert second.filter("is_current").count() == 1
    assert second.count() == 2

    # A brand-new key opens its own current row.
    new_key = spark_session.createDataFrame(
        [(2, 200, "Delhi", "110001", datetime(2026, 9, 20))],
        "address_id: bigint, customer_id: bigint, city: string, postal_code: string, "
        "updated_at: timestamp",
    )
    third = apply_scd2(
        second, new_key, key="address_id", attributes=["city", "postal_code"],
        effective_time=EFFECTIVE,
    )
    assert third.filter("is_current").count() == 2
    assert third.filter("address_id = 2").first()["city"] == "Delhi"


def test_scd2_no_attribute_change_keeps_row(spark_session) -> None:
    existing = _dim(
        spark_session,
        [(1, 100, "Mumbai", "400001", datetime(2026, 1, 1), None, True, datetime(2026, 1, 1))],
    )
    same = spark_session.createDataFrame(
        [(1, 100, "Mumbai", "400001", datetime(2026, 9, 1))],
        "address_id: bigint, customer_id: bigint, city: string, postal_code: string, "
        "updated_at: timestamp",
    )
    result = apply_scd2(
        existing, same, key="address_id", attributes=["city", "postal_code"],
        effective_time=EFFECTIVE,
    ).collect()
    assert len(result) == 1
    assert result[0]["is_current"] is True
    assert result[0]["valid_to"] is None


def test_broadcast_plan_difference(spark_session, tmp_path) -> None:
    """Plan evidence for the broadcast experiment on tiny frames."""
    from quickcart.lakehouse.learning.jobs import explain_text

    big = spark_session.range(0, 1000).withColumn("key", (F.col("id") % 50).cast("int"))
    small = spark_session.range(0, 50).withColumn("key", F.col("id").cast("int"))
    spark_session.conf.set("spark.sql.autoBroadcastJoinThreshold", -1)
    try:
        smj = big.join(small, "key")
        assert "SortMergeJoin" in explain_text(smj)
    finally:
        spark_session.conf.unset("spark.sql.autoBroadcastJoinThreshold")
    bmj = big.join(F.broadcast(small), "key")
    assert "BroadcastHashJoin" in explain_text(bmj)


def test_partitioned_read_shows_partition_filters(spark_session, tmp_path) -> None:
    from quickcart.lakehouse.learning.jobs import explain_text

    df = spark_session.range(0, 200).withColumn("d", F.col("id") % 10)
    path = tmp_path / "partitioned"
    df.write.partitionBy("d").parquet(str(path))
    filtered = spark_session.read.parquet(str(path)).filter("d = 3")
    plan = explain_text(filtered)
    assert "PartitionFilters" in plan
    assert "= 3" in plan  # the pushed equality predicate, visible in the plan text
