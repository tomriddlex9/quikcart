"""Long-running live pipeline worker.

The worker owns one Spark session, two Structured Streaming queries, and a
small periodic Gold/inference refresh loop.
"""

from __future__ import annotations

import argparse
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
from pyspark.sql import SparkSession

from quickcart.config.settings import get_settings
from quickcart.ingestion.cdc import apply_cdc_to_silver, build_cdc_query
from quickcart.ingestion.streaming import build_consumer_query
from quickcart.lakehouse.common.spark import build_spark
from quickcart.lakehouse.gold.load import run_gold
from quickcart.live.contracts import PipelineStage, StageHeartbeat
from quickcart.live.heartbeat import write_heartbeat
from quickcart.live.scoring import score_unscored_orders
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)
TIMER_INTERVAL_SECONDS = 90.0


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _success(
    stage: PipelineStage,
    *,
    rows_in: int = 0,
    rows_out: int = 0,
    detail: dict[str, Any] | None = None,
) -> None:
    write_heartbeat(
        StageHeartbeat(
            stage=stage,
            last_run_at=_now(),
            rows_in=rows_in,
            rows_out=rows_out,
            detail=detail or {},
        )
    )


def _failure(stage: PipelineStage, error: Exception, **detail: Any) -> None:
    log.exception("live.stage_failed", stage=stage, error=str(error), **detail)
    write_heartbeat(
        StageHeartbeat(
            stage=stage,
            last_run_at=_now(),
            error=str(error),
            detail=detail,
        )
    )


def run_timer_step(spark: SparkSession, root: Path) -> dict[str, dict[str, Any]]:
    """Run one periodic Gold/scoring cycle; callable independently in tests."""
    result: dict[str, dict[str, Any]] = {}
    try:
        gold_counts = run_gold(spark, root)
        gold_rows = sum(gold_counts.values())
        result["gold_refresh"] = {"rows_out": gold_rows, "tables": gold_counts}
        _success("gold_refresh", rows_out=gold_rows, detail={"tables": gold_counts})
    except Exception as error:
        _failure("gold_refresh", error)
        raise

    try:
        scoring = score_unscored_orders(spark, root)
        result["ml_scoring"] = scoring
        _success(
            "ml_scoring",
            rows_in=scoring["rows_in"],
            rows_out=scoring["rows_out"],
            detail={"model": "delivery_delay_classifier"},
        )
    except Exception as error:
        _failure("ml_scoring", error)
        raise

    anomaly_note = {
        "status": "skipped",
        "reason": "full anomaly model retraining is not suitable for the 90-second live loop",
    }
    result["anomaly_detect"] = anomaly_note
    _success("anomaly_detect", detail=anomaly_note)
    return result


def _timer_loop(
    spark: SparkSession,
    root: Path,
    stop: threading.Event,
    errors: list[BaseException],
    interval_seconds: float = TIMER_INTERVAL_SECONDS,
) -> None:
    while not stop.is_set():
        try:
            run_timer_step(spark, root)
        except BaseException as error:
            errors.append(error)
            stop.set()
            return
        stop.wait(interval_seconds)


def _progress_value(progress: Any, key: str, default: Any = None) -> Any:
    if isinstance(progress, dict):
        return progress.get(key, default)
    return getattr(progress, key, default)


def _process_progress(
    spark: SparkSession,
    root: Path,
    order_query: Any,
    cdc_query: Any,
    seen_batches: dict[str, set[int]],
) -> None:
    for progress in order_query.recentProgress:
        batch_id = int(_progress_value(progress, "batchId", -1))
        if batch_id in seen_batches["orders"]:
            continue
        rows = int(_progress_value(progress, "numInputRows", 0))
        _success(
            "order_events_bronze",
            rows_in=rows,
            rows_out=rows,
            detail={"batch_id": batch_id},
        )
        seen_batches["orders"].add(batch_id)

    for progress in cdc_query.recentProgress:
        batch_id = int(_progress_value(progress, "batchId", -1))
        if batch_id in seen_batches["cdc"]:
            continue
        rows = int(_progress_value(progress, "numInputRows", 0))
        _success(
            "cdc_bronze",
            rows_in=rows,
            rows_out=rows,
            detail={"batch_id": batch_id},
        )
        try:
            metrics = apply_cdc_to_silver(spark, root, "bronze_orders_cdc")
            changed = sum(metrics.values())
            _success(
                "cdc_silver",
                rows_in=rows,
                rows_out=changed,
                detail={"batch_id": batch_id, **metrics},
            )
        except Exception as error:
            _failure("cdc_silver", error, batch_id=batch_id)
            raise
        seen_batches["cdc"].add(batch_id)


def _stop_query(query: Any) -> None:
    if query is not None and query.isActive:
        query.stop()


def run_worker(*, once: bool = False) -> int:
    settings = get_settings()
    root = settings.data_root
    spark = build_spark("quickcart-live-worker")
    spark.conf.set("spark.sql.shuffle.partitions", "4")
    order_query = None
    cdc_query = None
    stop = threading.Event()
    timer_errors: list[BaseException] = []
    timer: threading.Thread | None = None
    seen_batches = {"orders": set(), "cdc": set()}

    try:
        _success("worker", detail={"status": "starting"})
        order_query = build_consumer_query(
            spark,
            settings.redpanda_bootstrap_servers,
            root,
            root / "checkpoints" / "bronze_order_events",
        )
        cdc_query = build_cdc_query(
            spark,
            settings.redpanda_bootstrap_servers,
            root,
            root / "checkpoints" / "bronze_cdc",
        )
        if once:
            order_query.processAllAvailable()
            cdc_query.processAllAvailable()
            _process_progress(spark, root, order_query, cdc_query, seen_batches)
            run_timer_step(spark, root)
            _success("worker", detail={"status": "once_complete"})
            return 0

        timer = threading.Thread(
            target=_timer_loop,
            args=(spark, root, stop, timer_errors),
            name="quickcart-live-timer",
            daemon=True,
        )
        timer.start()
        _success("worker", detail={"status": "running"})
        while not stop.is_set():
            spark.streams.awaitAnyTermination(1)
            _process_progress(spark, root, order_query, cdc_query, seen_batches)
            if not order_query.isActive:
                error = order_query.exception() or RuntimeError(
                    "the order-events streaming query terminated unexpectedly"
                )
                _failure("order_events_bronze", error)
                raise error
            if not cdc_query.isActive:
                error = cdc_query.exception() or RuntimeError(
                    "the CDC streaming query terminated unexpectedly"
                )
                _failure("cdc_bronze", error)
                raise error
        if timer_errors:
            raise timer_errors[0]
        return 0
    except KeyboardInterrupt:
        log.info("live.worker_stopping")
        _success("worker", detail={"status": "stopping"})
        return 0
    except Exception as error:
        _failure("worker", error)
        raise
    finally:
        stop.set()
        if timer is not None:
            timer.join(timeout=5)
        _stop_query(order_query)
        _stop_query(cdc_query)
        spark.stop()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run QuickCart live streaming pipelines")
    parser.add_argument(
        "--once",
        action="store_true",
        help="process currently available records, refresh derived data, then exit",
    )
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)
    return run_worker(once=args.once)


if __name__ == "__main__":
    raise SystemExit(main())
