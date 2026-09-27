"""Read-only API for latest external feed snapshots (Map / Logs console)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import structlog
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from quickcart.config.settings import get_settings
from quickcart.lakehouse.common.paths import latest_raw_partition

log = structlog.get_logger(__name__)

FeedKind = Literal["weather", "news", "traffic"]

_FEED_FILES: dict[FeedKind, tuple[str, str]] = {
    "weather": ("weather", "weather.json"),
    "news": ("news", "news.json"),
    "traffic": ("traffic", "traffic.json"),
}


class ExternalFeedSnapshot(BaseModel):
    feed: FeedKind
    generated_at: str
    load_date: str | None = None
    row_count: int
    rows: list[dict[str, Any]] = Field(default_factory=list)
    source_hint: str


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def read_external_feed(feed: FeedKind, data_root: Path | None = None) -> ExternalFeedSnapshot:
    entity, filename = _FEED_FILES[feed]
    root = data_root or get_settings().data_root
    try:
        partition = latest_raw_partition(root, entity)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"no raw partition for {feed}") from exc

    path = partition / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"missing {filename} for {feed}")

    text = path.read_text(encoding="utf-8")
    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    load_date = None
    if partition.name.startswith("load_date="):
        load_date = partition.name.split("=", 1)[-1]
    sources = {str(row.get("source", "unknown")) for row in rows}
    source_hint = ",".join(sorted(sources)) if sources else "unknown"
    return ExternalFeedSnapshot(
        feed=feed,
        generated_at=_utc_iso(datetime.now(UTC)),
        load_date=load_date,
        row_count=len(rows),
        rows=rows,
        source_hint=source_hint,
    )


def register_external_feed_routes(app: FastAPI) -> None:
    def app_data_root(request: Request) -> Path | None:
        return getattr(request.app.state, "data_root", None)

    @app.get("/api/v1/external/weather", response_model=ExternalFeedSnapshot)
    def external_weather(request: Request) -> ExternalFeedSnapshot:
        return read_external_feed("weather", app_data_root(request))

    @app.get("/api/v1/external/news", response_model=ExternalFeedSnapshot)
    def external_news(request: Request) -> ExternalFeedSnapshot:
        return read_external_feed("news", app_data_root(request))

    @app.get("/api/v1/external/traffic", response_model=ExternalFeedSnapshot)
    def external_traffic(request: Request) -> ExternalFeedSnapshot:
        return read_external_feed("traffic", app_data_root(request))


__all__ = ["ExternalFeedSnapshot", "read_external_feed", "register_external_feed_routes"]
