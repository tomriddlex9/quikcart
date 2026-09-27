"""City news ingestion via public RSS feeds (zero-cost, fixture fallback)."""

from __future__ import annotations

import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect, fetch_all

log = structlog.get_logger(__name__)

FIXTURE_PATH = Path("tests/fixtures/news_fixture.json")

# Google News RSS search per major QuickCart city (no API key).
CITY_RSS: dict[str, str] = {
    "Mumbai": "https://news.google.com/rss/search?q=Mumbai&hl=en-IN&gl=IN&ceid=IN:en",
    "Delhi": "https://news.google.com/rss/search?q=Delhi&hl=en-IN&gl=IN&ceid=IN:en",
    "Bengaluru": "https://news.google.com/rss/search?q=Bengaluru&hl=en-IN&gl=IN&ceid=IN:en",
    "Hyderabad": "https://news.google.com/rss/search?q=Hyderabad&hl=en-IN&gl=IN&ceid=IN:en",
    "Chennai": "https://news.google.com/rss/search?q=Chennai&hl=en-IN&gl=IN&ceid=IN:en",
    "Kolkata": "https://news.google.com/rss/search?q=Kolkata&hl=en-IN&gl=IN&ceid=IN:en",
    "Pune": "https://news.google.com/rss/search?q=Pune&hl=en-IN&gl=IN&ceid=IN:en",
    "Ahmedabad": "https://news.google.com/rss/search?q=Ahmedabad&hl=en-IN&gl=IN&ceid=IN:en",
}


def _article_id(link: str, title: str) -> str:
    digest = hashlib.sha256(f"{link}|{title}".encode()).hexdigest()
    return digest[:16]


def _parse_pub_date(raw: str | None) -> str:
    if not raw:
        return datetime.now(UTC).replace(microsecond=0).isoformat()
    try:
        return parsedate_to_datetime(raw).astimezone(UTC).replace(microsecond=0).isoformat()
    except (TypeError, ValueError, OverflowError):
        return datetime.now(UTC).replace(microsecond=0).isoformat()


def parse_rss(xml_bytes: bytes, city: str, *, max_items: int = 15) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    channel = root.find("channel")
    if channel is None:
        return []
    rows: list[dict] = []
    for item in channel.findall("item")[:max_items]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or title).strip()
        if not title:
            continue
        rows.append(
            {
                "article_id": _article_id(link, title),
                "city": city,
                "published_at": _parse_pub_date(item.findtext("pubDate")),
                "headline": title,
                "sentiment": "neutral",
                "source": "city-rss",
                "_ingested_at": datetime.now(UTC).isoformat(),
            }
        )
    return rows


def fetch_city_rss(city: str, url: str, *, timeout: float = 15.0) -> list[dict]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return parse_rss(response.read(), city)


def load_fixture(path: Path = FIXTURE_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def ingest_news(
    data_root: Path | None = None,
    day: date | None = None,
    fixture: bool = False,
) -> Path:
    settings = get_settings()
    root = data_root or settings.data_root
    day = day or date.today()
    target_dir = root / "raw" / "news" / f"load_date={day.isoformat()}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "news.json"
    if target.exists():
        log.info("news.already_present", path=str(target))
        return target

    rows: list[dict] = []
    used_fixture = fixture
    if not fixture:
        try:
            with connect(autocommit=True) as conn:
                cities = {
                    row["city"]
                    for row in fetch_all(conn, "SELECT DISTINCT city FROM stores ORDER BY city")
                }
            for city in sorted(cities):
                url = CITY_RSS.get(city)
                if not url:
                    continue
                rows.extend(fetch_city_rss(city, url))
            if not rows:
                used_fixture = True
        except (OSError, ET.ParseError, KeyError, json.JSONDecodeError) as exc:
            log.warning("news.fallback_to_fixture", reason=str(exc))
            used_fixture = True

    if used_fixture:
        rows = load_fixture()

    with target.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    log.info("news.ingested", rows=len(rows), fixture=used_fixture, path=str(target))
    return target


def main() -> int:
    path = ingest_news()
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
