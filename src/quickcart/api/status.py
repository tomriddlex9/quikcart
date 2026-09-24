"""System status assembly for GET /api/v1/system/status.

Honest, cheap checks only: service up/down via short TCP connect attempts,
Gold mart presence via local Path.exists on the data root, and phase progress
by parsing kit/TASKS.md checkboxes once at startup. Nothing here fabricates —
a service that refuses the connection reports "down", a mart that is not
built reports false.
"""

import os
import re
import socket
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import table_path

# The five Gold marts the platform promises downstream consumers (kit/03 §4).
GOLD_MARTS = (
    "gold_store_hourly_metrics",
    "gold_customer_360",
    "gold_inventory_health",
    "gold_delivery_performance",
    "gold_product_performance",
)

TASKS_PATH = Path(__file__).resolve().parents[3] / "kit" / "TASKS.md"

_PHASE_RE = re.compile(r"^## Phase (\d+) — (.+?)\s*$")
_TASK_RE = re.compile(r"^- \[([ x])\] ")


def service_up(host: str, port: int, timeout: float = 0.5) -> bool:
    """One TCP connect attempt; False on any OS-level refusal/timeout."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _host_port(url_or_hostport: str, default_port: int) -> tuple[str, int]:
    raw = url_or_hostport.strip()
    if "://" in raw:
        parsed = urlparse(raw)
        return parsed.hostname or "127.0.0.1", parsed.port or default_port
    host, _, port = raw.partition(":")
    return host or "127.0.0.1", int(port) if port else default_port


@lru_cache
def parse_phase_progress(tasks_path: Path = TASKS_PATH) -> list[dict[str, object]]:
    """kit/TASKS.md checkbox snapshot: [{phase, name, status}].

    status: "done" (all checked), "in_progress" (some), "pending" (none).
    Parsed once per process — the file is static between releases.
    """
    phases: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    if not tasks_path.exists():
        return phases
    for line in tasks_path.read_text(encoding="utf-8").splitlines():
        if match := _PHASE_RE.match(line):
            current = {
                "phase": int(match.group(1)),
                "name": match.group(2),
                "done": 0,
                "total": 0,
            }
            phases.append(current)
        elif current is not None and (match := _TASK_RE.match(line)):
            current["total"] = int(current["total"]) + 1
            if match.group(1) == "x":
                current["done"] = int(current["done"]) + 1
    for phase in phases:
        done, total = int(phase["done"]), int(phase["total"])
        phase["status"] = "done" if done == total else ("in_progress" if done else "pending")
        del phase["done"], phase["total"]
    return phases


def build_system_status(data_root: Path | None = None) -> dict[str, object]:
    settings = get_settings()
    root = data_root or settings.data_root
    redpanda_host, redpanda_port = _host_port(settings.redpanda_bootstrap_servers, 9092)
    qdrant_host, qdrant_port = _host_port(
        os.environ.get("QDRANT_URL", "http://127.0.0.1:6333"), 6333
    )
    mlflow_host, mlflow_port = _host_port(
        os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000"), 5000
    )
    return {
        "phases": parse_phase_progress(),
        "services": {
            "postgres": (
                "up" if service_up(settings.postgres_host, settings.postgres_port) else "down"
            ),
            "redpanda": "up" if service_up(redpanda_host, redpanda_port) else "down",
            "qdrant": "up" if service_up(qdrant_host, qdrant_port) else "down",
            "mlflow": "up" if service_up(mlflow_host, mlflow_port) else "down",
        },
        "data_root_tables": {
            mart: table_path("gold", mart, root).exists() for mart in GOLD_MARTS
        },
    }
