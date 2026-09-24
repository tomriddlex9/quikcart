"""Phase 6 acceptance: the same pipeline runs unchanged against S3-compatible
storage (kit/07 Phase 6). The test drives the pipeline CLI in a subprocess
with QUICKCART_STORAGE_BACKEND=s3 so Spark gets a clean JVM with the S3A
packages; the pipeline's own read-backs (silver←bronze, gold←silver) prove
Delta tables are writable and readable through the S3 endpoint.

Requires: docker compose --profile storage up -d + bootstrap_bucket.sh.
"""

import os
import shutil
import subprocess
from datetime import date

import pytest

from quickcart.config.settings import get_settings
from quickcart.ingestion.export import export_all


def _storage_up() -> bool:
    settings = get_settings()
    if settings.storage_backend != "local":
        return True  # already configured for s3
    import urllib.request

    try:
        with urllib.request.urlopen(settings.s3_endpoint, timeout=2):
            return True
    except OSError:
        return False


@pytest.mark.integration
@pytest.mark.slow
def test_same_pipeline_on_s3_backend(seeded_db, tmp_path):
    if not _storage_up():
        pytest.skip("SeaweedFS S3 endpoint unreachable; run: make storage-up")

    # Raw exports stay on the local filesystem; only the lakehouse moves to S3.
    export_all(data_root=tmp_path, load_date=date(2026, 9, 23))

    env = os.environ.copy()
    env["QUICKCART_DATA_ROOT"] = str(tmp_path)
    env["QUICKCART_STORAGE_BACKEND"] = "s3"
    env.setdefault("JAVA_HOME", _java_home())

    result = subprocess.run(
        ["uv", "run", "python", "-m", "quickcart.lakehouse.pipeline", "all"],
        capture_output=True,
        text=True,
        env=env,
        timeout=900,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert "gold_store_hourly_metrics" in result.stderr + result.stdout
    assert "step_complete" in result.stderr + result.stdout


def _java_home() -> str:
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        return java_home
    brew = shutil.which("brew")
    if brew:
        return subprocess.check_output(
            [brew, "--prefix", "openjdk@17"], text=True
        ).strip()
    return ""
