"""Silver loader: Bronze → Silver Delta tables + quarantine tables.

Writes are full overwrites: Silver is derived deterministically from Bronze,
so reruns are idempotent by construction (kit/03 FR-009). Quarantined rows
are never silently dropped (kit/05 §10) — they land in
`data/quarantine/<table>_quarantine` with `_error_codes`,
`_error_messages`, `_quarantined_at`.
"""

from pathlib import Path

from pyspark.sql import SparkSession

from quickcart.lakehouse.common.paths import table_path
from quickcart.lakehouse.silver.transforms import CLEANERS, SILVER_TABLE


def run_silver(spark: SparkSession, root: Path | None = None) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = {}
    for bronze_table, cleaner in CLEANERS.items():
        bronze_path = table_path("bronze", bronze_table, root)
        if not bronze_path.exists():
            raise FileNotFoundError(f"missing {bronze_table}; run the bronze step first")
        bronze = spark.read.format("delta").load(str(bronze_path))
        clean, quarantine = cleaner(bronze)

        silver_table = SILVER_TABLE[bronze_table]
        clean.write.format("delta").mode("overwrite").save(
            str(table_path("silver", silver_table, root))
        )
        quarantine.write.format("delta").mode("overwrite").save(
            str(table_path("quarantine", f"{silver_table}_quarantine", root))
        )
        stats[silver_table] = {
            "clean_rows": clean.count(),
            "quarantined_rows": quarantine.count(),
            "bronze_rows": bronze.count(),
        }
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
