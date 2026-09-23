"""Single central SparkSession builder (kit/03 §3.2).

All Spark configuration lives here so transformation code never carries
infrastructure settings. ``test=True`` produces a lightweight local session
suitable for unit tests.
"""

import os
import subprocess
from pathlib import Path

from pyspark.sql import SparkSession


def ensure_java_home() -> None:
    """Best-effort JAVA_HOME for local macOS dev (keg-only openjdk@17).

    Spark shells out to `java`; if JAVA_HOME is unset we probe Homebrew's
    openjdk@17 prefix. No-op when JAVA_HOME already works or brew is absent.
    """
    if os.environ.get("JAVA_HOME"):
        return
    try:
        prefix = subprocess.check_output(
            ["brew", "--prefix", "openjdk@17"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return
    if prefix and (Path(prefix) / "bin/java").exists():
        os.environ["JAVA_HOME"] = prefix


def build_spark(
    app_name: str = "quickcart", *, test: bool = False, delta: bool = True
) -> SparkSession:
    ensure_java_home()
    builder = (
        SparkSession.builder.appName(app_name)
        .master("local[*]")
        .config("spark.sql.session.timeZone", "UTC")
    )
    if delta:
        # delta-spark's wheel ships no JVM jars; configure_spark_with_delta_pip
        # wires the matching Maven coordinates onto the builder (cached by Ivy
        # after the first run) and sets the Delta catalog/extensions.
        from delta import configure_spark_with_delta_pip

        builder = configure_spark_with_delta_pip(builder)
        builder = builder.config(
            "spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension"
        ).config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
    if test:
        builder = (
            builder.config("spark.ui.enabled", "false")
            .config("spark.sql.shuffle.partitions", "4")
            .config("spark.driver.memory", "1g")
            .config("spark.executor.memory", "1g")
        )
    spark = builder.getOrCreate()
    spark.sparkContext.setLogLevel("ERROR")
    return spark
