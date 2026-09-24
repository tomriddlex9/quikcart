"""Silver loader: Bronze → Silver Delta tables + quarantine + quality summary.

Writes are full overwrites: Silver is derived deterministically from Bronze,
so reruns are idempotent by construction (kit/03 FR-009). Quarantined rows
are never silently dropped (kit/05 §10) — they land in
`data/quarantine/<table>_quarantine` with `_error_codes`,
`_error_messages`, `_quarantined_at`. Per-run rule trigger counts are
unioned into `data/quarantine/quality_summary` (kit/02 §9: every rule has
an observable metric).

Tables are cleaned in dependency order so FK-existence rules see the
cleaned reference dimensions (stores → customers → products → riders →
inventory → orders → items → payments → deliveries → movements).
"""

from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import table_location, table_path
from quickcart.lakehouse.silver.transforms import CLEANERS, FK_REFS, SILVER_TABLE

ORDER = [
    "bronze_stores",
    "bronze_customers",
    "bronze_products",
    "bronze_riders",
    "bronze_inventory",
    "bronze_orders",
    "bronze_order_items",
    "bronze_payments",
    "bronze_deliveries",
    "bronze_inventory_movements",
]


def _read_bronze(spark: SparkSession, root: Path | None, table: str):
    if get_settings().storage_backend != "s3":
        path = table_path("bronze", table, root)
        if not path.exists():
            raise FileNotFoundError(f"missing {table}; run the bronze step first")
    return spark.read.format("delta").load(table_location("bronze", table, root))


def run_silver(spark: SparkSession, root: Path | None = None) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = {}
    silver_frames: dict[str, object] = {}
    summaries = []
    for bronze_table in ORDER:
        cleaner = CLEANERS[bronze_table]
        bronze = _read_bronze(spark, root, bronze_table)

        refs = {
            arg: silver_frames[ref_table]
            for arg, ref_table in FK_REFS.get(bronze_table, {}).items()
        }
        clean, quarantine, summary = cleaner(bronze, **refs)
        summary = summary.withColumn("entity", F.lit(SILVER_TABLE[bronze_table]))
        summaries.append(summary)

        silver_table = SILVER_TABLE[bronze_table]
        clean.write.format("delta").mode("overwrite").save(
            table_location("silver", silver_table, root)
        )
        quarantine.write.format("delta").mode("overwrite").save(
            table_location("quarantine", f"{silver_table}_quarantine", root)
        )
        silver_frames[silver_table] = clean
        stats[silver_table] = {
            "clean_rows": clean.count(),
            "quarantined_rows": quarantine.count(),
            "bronze_rows": bronze.count(),
        }

    combined = summaries[0]
    for extra in summaries[1:]:
        combined = combined.unionByName(extra)
    combined.write.format("delta").mode("overwrite").save(
        table_location("quarantine", "quality_summary", root)
    )
    return stats


def silver_quality_gate(stats: dict[str, dict[str, int]]) -> list[str]:
    """Critical gate (kit/06 §7): no silver table may come back empty, and
    quarantine may not exceed a fifth of the input without investigation."""
    failures = []
    for table, counts in stats.items():
        if counts["clean_rows"] == 0:
            failures.append(f"{table}: clean output is empty")
        if counts["quarantined_rows"] > counts["bronze_rows"] * 0.2:
            failures.append(
                f"{table}: quarantined {counts['quarantined_rows']} of {counts['bronze_rows']} rows"
            )
    return failures
