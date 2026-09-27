"""Geo store map API — Postgres stores with optional external feed summaries."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
import structlog
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from quickcart.db.connection import connect, fetch_all

log = structlog.get_logger(__name__)

_STORES_SQL = """
SELECT store_id, name, city, latitude, longitude
FROM stores
WHERE is_active = TRUE
ORDER BY store_id
"""

# Deterministic fallback when Postgres is empty or unreachable (smoke / demo).
_DEMO_CITIES: list[tuple[str, float, float]] = [
    ("Mumbai", 19.076, 72.877),
    ("Delhi", 28.613, 77.209),
    ("Bengaluru", 12.972, 77.594),
    ("Hyderabad", 17.385, 78.487),
    ("Pune", 18.52, 73.856),
    ("Chennai", 13.083, 80.27),
    ("Kolkata", 22.573, 88.364),
    ("Gurugram", 28.459, 77.026),
    ("Jaipur", 26.912, 75.787),
    ("Ahmedabad", 23.023, 72.571),
]


class GeoWeatherSummary(BaseModel):
    condition: str | None = None
    temperature_c: float | None = None
    observed_at: str | None = None
    source: str | None = None


class GeoTrafficSummary(BaseModel):
    eta_delay_sec: int | None = None
    actual_eta_sec: int | None = None
    baseline_eta_sec: int | None = None
    observed_at: str | None = None
    source: str | None = None


class GeoStoreOut(BaseModel):
    store_id: int
    name: str
    city: str
    latitude: float
    longitude: float
    weather: GeoWeatherSummary | None = None
    traffic: GeoTrafficSummary | None = None
    demo: bool = False


def _as_float(value: Any) -> float:
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def demo_geo_stores() -> list[GeoStoreOut]:
    stores: list[GeoStoreOut] = []
    for idx, (city, lat, lon) in enumerate(_DEMO_CITIES, start=1):
        stores.append(
            GeoStoreOut(
                store_id=idx,
                name=f"QuickCart {city}",
                city=city,
                latitude=lat,
                longitude=lon,
                demo=True,
            )
        )
    return stores


def _rows_by_store_id(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    indexed: dict[int, dict[str, Any]] = {}
    for row in rows:
        raw_id = row.get("store_id")
        if raw_id is None:
            continue
        indexed[int(raw_id)] = row
    return indexed


def _optional_feed_rows(feed: str, data_root: Path | None) -> dict[int, dict[str, Any]]:
    try:
        from quickcart.api.external_feeds import read_external_feed
    except ImportError:
        return {}
    try:
        snapshot = read_external_feed(feed, data_root)  # type: ignore[arg-type]
    except HTTPException:
        return {}
    except Exception as exc:  # partition read failures are non-fatal for the map
        log.debug("geo.feed_skipped", feed=feed, error=str(exc))
        return {}
    return _rows_by_store_id(snapshot.rows)


def _weather_summary(row: dict[str, Any] | None) -> GeoWeatherSummary | None:
    if not row:
        return None
    temp = row.get("temperature_c")
    return GeoWeatherSummary(
        condition=str(row["condition"]) if row.get("condition") is not None else None,
        temperature_c=float(temp) if temp is not None else None,
        observed_at=str(row["observed_at"]) if row.get("observed_at") is not None else None,
        source=str(row["source"]) if row.get("source") is not None else None,
    )


def _traffic_summary(row: dict[str, Any] | None) -> GeoTrafficSummary | None:
    if not row:
        return None

    def _int(key: str) -> int | None:
        value = row.get(key)
        return int(value) if value is not None else None

    return GeoTrafficSummary(
        eta_delay_sec=_int("eta_delay_sec"),
        actual_eta_sec=_int("actual_eta_sec"),
        baseline_eta_sec=_int("baseline_eta_sec"),
        observed_at=str(row["observed_at"]) if row.get("observed_at") is not None else None,
        source=str(row["source"]) if row.get("source") is not None else None,
    )


def build_geo_stores(
    *,
    connect_factory: Callable[..., psycopg.Connection] = connect,
    data_root: Path | None = None,
) -> list[GeoStoreOut]:
    rows: list[dict[str, Any]] = []
    try:
        with connect_factory() as conn:
            rows = fetch_all(conn, _STORES_SQL)
    except (psycopg.Error, OSError) as exc:
        log.warning("geo.stores_db_unavailable", error=str(exc))
        return demo_geo_stores()

    if not rows:
        return demo_geo_stores()

    weather_by_store = _optional_feed_rows("weather", data_root)
    traffic_by_store = _optional_feed_rows("traffic", data_root)

    stores: list[GeoStoreOut] = []
    for row in rows:
        store_id = int(row["store_id"])
        stores.append(
            GeoStoreOut(
                store_id=store_id,
                name=str(row["name"]),
                city=str(row["city"]),
                latitude=_as_float(row["latitude"]),
                longitude=_as_float(row["longitude"]),
                weather=_weather_summary(weather_by_store.get(store_id)),
                traffic=_traffic_summary(traffic_by_store.get(store_id)),
                demo=False,
            )
        )
    return stores


def register_geo_routes(app: FastAPI) -> None:
    @app.get("/api/v1/geo/stores", response_model=list[GeoStoreOut])
    def geo_stores(request: Request) -> list[GeoStoreOut]:
        connect_factory = getattr(request.app.state, "connect_factory", connect)
        data_root = getattr(request.app.state, "data_root", None)
        return build_geo_stores(connect_factory=connect_factory, data_root=data_root)


__all__ = [
    "GeoStoreOut",
    "GeoTrafficSummary",
    "GeoWeatherSummary",
    "build_geo_stores",
    "demo_geo_stores",
    "register_geo_routes",
]
