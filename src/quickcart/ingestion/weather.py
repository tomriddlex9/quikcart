"""Weather enrichment ingestion (kit/02 FR-005, kit/03 §9 weather DAG).

Fetches current weather per store city from a free public API (Open-Meteo,
no key required) and lands JSONL under
``data/raw/weather/load_date=YYYY-MM-DD/weather.json``.

Contract with tests (kit/02 §19): any network failure falls back to the
deterministic local fixture ``tests/fixtures/weather_fixture.json`` — the
pipeline never depends on the network being up.
"""

import json
import urllib.request
from datetime import UTC, date, datetime
from pathlib import Path

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect, fetch_all

log = structlog.get_logger(__name__)

FIXTURE_PATH = Path("tests/fixtures/weather_fixture.json")
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code"


def fetch_current_weather(
    latitude: float, longitude: float, url_template: str = OPEN_METEO_URL
) -> dict:
    with urllib.request.urlopen(
        url_template.format(lat=latitude, lon=longitude), timeout=15
    ) as response:
        return json.loads(response.read())


def condition_from_code(code: int) -> str:
    return {
        0: "CLEAR",
        1: "CLEAR",
        2: "CLEAR",
        3: "OVERCAST",
        45: "RAIN",
        48: "RAIN",
        51: "RAIN",
        53: "RAIN",
        55: "RAIN",
        61: "RAIN",
        63: "RAIN",
        65: "RAIN",
        71: "RAIN",
        73: "RAIN",
        75: "RAIN",
        80: "RAIN",
        81: "RAIN",
        82: "RAIN",
        95: "RAIN",
        96: "RAIN",
        99: "RAIN",
    }.get(code, "CLEAR")


def load_fixture(path: Path = FIXTURE_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def ingest_weather(
    data_root: Path | None = None,
    day: date | None = None,
    fixture: bool = False,
) -> Path:
    """Write today's weather JSONL; falls back to the fixture on any failure
    (or when `fixture=True`). Idempotent per day: an existing partition is
    returned as-is."""
    settings = get_settings()
    root = data_root or settings.data_root
    day = day or date.today()
    target_dir = root / "raw" / "weather" / f"load_date={day.isoformat()}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "weather.json"
    if target.exists():
        log.info("weather.already_present", path=str(target))
        return target

    rows: list[dict] = []
    used_fixture = False
    if not fixture:
        try:
            with connect(autocommit=True) as conn:
                stores = fetch_all(
                    conn, "SELECT store_id, city, latitude, longitude FROM stores"
                )
            for store in stores:
                payload = fetch_current_weather(float(store["latitude"]), float(store["longitude"]))
                current = payload["current"]
                rows.append(
                    {
                        "store_id": store["store_id"],
                        "city": store["city"],
                        "observed_at": current["time"],
                        "temperature_c": current["temperature_2m"],
                        "condition": condition_from_code(current["weather_code"]),
                        "source": "open-meteo",
                        "_ingested_at": datetime.now(UTC).isoformat(),
                    }
                )
        except (OSError, KeyError, json.JSONDecodeError) as exc:
            log.warning("weather.fallback_to_fixture", reason=str(exc))
            used_fixture = True
    else:
        used_fixture = True

    if used_fixture:
        rows = load_fixture()

    with target.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    log.info("weather.ingested", rows=len(rows), fixture=used_fixture, path=str(target))
    return target


def main() -> int:
    path = ingest_weather()
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
