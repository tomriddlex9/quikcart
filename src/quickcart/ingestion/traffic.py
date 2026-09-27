"""Traffic / ETA delay ingestion (OSRM public API with rush-hour fallback)."""

from __future__ import annotations

import json
import math
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect, fetch_all

log = structlog.get_logger(__name__)

FIXTURE_PATH = Path("tests/fixtures/traffic_fixture.json")
OSRM_ROUTE_URL = (
    "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}"
    "?overview=false"
)
IST = ZoneInfo("Asia/Kolkata")
FREE_FLOW_KMH = 28.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def rush_hour_multiplier(when: datetime) -> float:
    local = when.astimezone(IST)
    hour = local.hour
    if hour in (8, 9, 17, 18, 19):
        return 1.55
    if hour in (7, 10, 16, 20):
        return 1.25
    return 1.0


def baseline_eta_sec(distance_km: float) -> int:
    return max(60, int((distance_km / FREE_FLOW_KMH) * 3600))


def rush_hour_delay_sec(distance_km: float, when: datetime) -> tuple[int, int]:
    baseline = baseline_eta_sec(distance_km)
    actual = int(baseline * rush_hour_multiplier(when))
    return actual, max(0, actual - baseline)


def fetch_osrm_duration_sec(
    lat1: float, lon1: float, lat2: float, lon2: float, url_template: str = OSRM_ROUTE_URL
) -> int | None:
    url = url_template.format(lat1=lat1, lon1=lon1, lat2=lat2, lon2=lon2)
    with urllib.request.urlopen(url, timeout=15) as response:
        payload = json.loads(response.read())
    if payload.get("code") != "Ok":
        return None
    routes = payload.get("routes") or []
    if not routes:
        return None
    return int(routes[0]["duration"])


def load_fixture(path: Path = FIXTURE_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def ingest_traffic(
    data_root: Path | None = None,
    day: date | None = None,
    fixture: bool = False,
) -> Path:
    settings = get_settings()
    root = data_root or settings.data_root
    day = day or date.today()
    target_dir = root / "raw" / "traffic" / f"load_date={day.isoformat()}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "traffic.json"
    if target.exists():
        log.info("traffic.already_present", path=str(target))
        return target

    rows: list[dict] = []
    used_fixture = fixture
    now = datetime.now(UTC)
    if not fixture:
        try:
            with connect(autocommit=True) as conn:
                stores = fetch_all(
                    conn,
                    "SELECT store_id, city, latitude, longitude FROM stores ORDER BY store_id",
                )
            for store in stores:
                lat = float(store["latitude"])
                lon = float(store["longitude"])
                # Destination: ~3 km offset simulates a typical delivery radius probe.
                dest_lat = lat + 0.025
                dest_lon = lon + 0.025
                distance = haversine_km(lat, lon, dest_lat, dest_lon)
                baseline = baseline_eta_sec(distance)
                source = "rush-hour-model"
                try:
                    duration = fetch_osrm_duration_sec(lat, lon, dest_lat, dest_lon)
                except OSError:
                    duration = None
                if duration is not None:
                    source = "osrm"
                    eta_delay = max(0, duration - baseline)
                    actual = duration
                else:
                    actual, eta_delay = rush_hour_delay_sec(distance, now)
                rows.append(
                    {
                        "store_id": store["store_id"],
                        "city": store["city"],
                        "observed_at": now.replace(microsecond=0).isoformat(),
                        "baseline_eta_sec": baseline,
                        "actual_eta_sec": actual,
                        "eta_delay_sec": eta_delay,
                        "distance_km": round(distance, 3),
                        "source": source,
                        "_ingested_at": now.isoformat(),
                    }
                )
        except (OSError, KeyError, json.JSONDecodeError, TypeError, ValueError) as exc:
            log.warning("traffic.fallback_to_fixture", reason=str(exc))
            used_fixture = True
    else:
        used_fixture = True

    if used_fixture:
        rows = load_fixture()

    with target.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    log.info("traffic.ingested", rows=len(rows), fixture=used_fixture, path=str(target))
    return target


def main() -> int:
    path = ingest_traffic()
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
