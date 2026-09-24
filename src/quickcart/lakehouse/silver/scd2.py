"""SCD Type 2 dimensions (kit/03 §5.5) for customer addresses and prices.

`apply_scd2` is a pure DataFrame→DataFrame transform over a dimension that
carries the standard SCD2 columns:

    business key, valid_from, valid_to, is_current, attribute columns

Contract:
- `changes` carries one row per business key with the FULL dimension payload
  (every column except valid_from/valid_to/is_current, which this function
  sets). If several changes for one key arrive in a batch, the latest by
  `order_column` wins — rerunning the same batch is a no-op (kit/03 FR-009).
- `effective_time` is supplied by the caller (never hidden wall-clock), so
  replays are deterministic.

Transitions:
- new key             → insert, valid_from = effective_time, is_current
- attribute change    → close current (valid_to = effective_time,
                        is_current = False) and open the new version
- no attribute change → keep the current row untouched
"""

from datetime import datetime
from functools import reduce

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F


def apply_scd2(
    existing: DataFrame,
    changes: DataFrame,
    key: str,
    attributes: list[str],
    effective_time: datetime,
    order_column: str = "updated_at",
) -> DataFrame:
    current = existing.filter("is_current")
    history = existing.filter("not is_current")

    window = Window.partitionBy(key).orderBy(F.col(order_column).desc())
    staged = (
        changes.withColumn("_rn", F.row_number().over(window))
        .filter("_rn = 1")
        .drop("_rn")
    )

    same_attributes = reduce(
        lambda a, b: a & b,
        [F.col(f"t.{name}").eqNullSafe(F.col(f"s.{name}")) for name in attributes],
    )
    has_change = F.col(f"s.{key}").isNotNull()

    compared = current.alias("t").join(staged.alias("s"), key, "left")
    unchanged = compared.filter(has_change & same_attributes).select("t.*")
    closed = (
        compared.filter(has_change & ~same_attributes)
        .select("t.*")
        .withColumn("valid_to", F.lit(effective_time))
        .withColumn("is_current", F.lit(False))
    )
    carried = current.join(staged.select(key), key, "left_anti")
    changed_versions = compared.filter(has_change & ~same_attributes).select("s.*")
    new_keys = staged.join(current.select(key), key, "left_anti")
    opened = (
        changed_versions.unionByName(new_keys)
        .withColumn("valid_from", F.lit(effective_time))
        .withColumn("valid_to", F.lit(None).cast("timestamp"))
        .withColumn("is_current", F.lit(True))
    )

    columns = existing.columns
    return (
        history.unionByName(closed.select(*columns))
        .unionByName(unchanged.select(*columns))
        .unionByName(carried.select(*columns))
        .unionByName(opened.select(*columns))
    )
