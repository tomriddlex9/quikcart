"""Single central SparkSession builder (kit/03 §3.2).

All Spark configuration lives here so transformation code never carries
infrastructure settings. ``test=True`` produces a lightweight local session
suitable for unit tests.
"""

import os
import subprocess
from pathlib import Path

from pyspark.sql import SparkSession

from quickcart.config.settings import get_settings


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
    settings = get_settings()
    builder = (
        SparkSession.builder.appName(app_name)
        .master("local[*]")
        .config("spark.sql.session.timeZone", "UTC")
        # Spark 4's Python timestamp collection honours the JVM default TZ;
        # pin it so local IST/macOS hosts do not shift wall-clock fields.
        .config("spark.driver.extraJavaOptions", "-Duser.timezone=UTC")
        .config("spark.executor.extraJavaOptions", "-Duser.timezone=UTC")
    )
    if delta:
        # delta-spark's wheel ships no JVM jars; configure_spark_with_delta_pip
        # wires the matching Maven coordinates onto the builder (cached by Ivy
        # after the first run) and sets the Delta catalog/extensions. Extra
        # connectors ride along via extra_packages so nothing gets clobbered.
        from delta import configure_spark_with_delta_pip

        extra_packages = ["org.apache.spark:spark-sql-kafka-0-10_2.13:4.2.0"]
        if settings.storage_backend == "s3":
            # S3A support is not bundled with Spark (kit/06 §9 — credentials
            # come only from configuration).
            extra_packages.extend(
                [
                    "org.apache.hadoop:hadoop-aws:3.4.2",
                    "software.amazon.awssdk:bundle:2.25.60",
                ]
            )
        builder = configure_spark_with_delta_pip(builder, extra_packages=extra_packages)
        builder = builder.config(
            "spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension"
        ).config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
    if settings.storage_backend == "s3":
        builder = builder.config(
            "spark.hadoop.fs.s3a.endpoint", settings.s3_endpoint
        ).config("spark.hadoop.fs.s3a.access.key", settings.s3_access_key).config(
            "spark.hadoop.fs.s3a.secret.key", settings.s3_secret_key
        ).config("spark.hadoop.fs.s3a.path.style.access", "true").config(
            "spark.hadoop.fs.s3a.aws.credentials.provider",
            "org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider",
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
