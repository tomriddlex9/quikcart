"""End-to-end lakehouse pipeline CLI (kit/03 §4.5).

```bash
uv run python -m quickcart.lakehouse.pipeline bronze
uv run python -m quickcart.lakehouse.pipeline silver   # gate: quality failures stop the run
uv run python -m quickcart.lakehouse.pipeline gold
uv run python -m quickcart.lakehouse.pipeline all      # == make lakehouse
```

Every step is a full-snapshot overwrite derived from the layer below, so
rerunning the whole pipeline is deterministic and idempotent (kit/03 FR-009).
"""

import argparse
from pathlib import Path

import structlog

from quickcart.config.settings import get_settings
from quickcart.lakehouse.bronze.load import run_bronze
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.gold.load import run_gold
from quickcart.lakehouse.silver.load import run_silver, silver_quality_gate
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)


def run_step(step: str, root: Path | None = None) -> dict:
    spark = build_spark(f"quickcart-pipeline-{step}")
    try:
        if step == "bronze":
            counts = run_bronze(spark, root)
            return {"counts": counts}
        if step == "silver":
            stats = run_silver(spark, root)
            failures = silver_quality_gate(stats)
            for table, counts in stats.items():
                log.info(
                    "silver.table",
                    table=table,
                    bronze=counts["bronze_rows"],
                    clean=counts["clean_rows"],
                    quarantined=counts["quarantined_rows"],
                )
            if failures:
                for failure in failures:
                    log.error("silver.gate_failure", detail=failure)
                raise SystemExit("silver quality gate failed: " + "; ".join(failures))
            return {"stats": stats}
        if step == "gold":
            counts = run_gold(spark, root)
            return {"counts": counts}
        raise ValueError(f"unknown step {step!r}")
    finally:
        spark.stop()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="QuickCart medallion pipeline")
    parser.add_argument("step", choices=["bronze", "silver", "gold", "all"])
    parser.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="override data root (defaults to QUICKCART_DATA_ROOT)",
    )
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)

    steps = ["bronze", "silver", "gold"] if args.step == "all" else [args.step]
    for step in steps:
        result = run_step(step, args.data_root)
        log.info("pipeline.step_complete", step=step, **result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
