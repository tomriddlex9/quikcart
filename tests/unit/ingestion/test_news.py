"""News RSS ingestion tests (fixture fallback, no network in CI)."""

import json
from datetime import date

import pytest

from quickcart.ingestion import news

pytestmark = pytest.mark.unit

SAMPLE_RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Test</title>
<item><title>Headline A</title><link>https://example.com/a</link>
<pubDate>Mon, 23 Sep 2026 12:00:00 GMT</pubDate></item>
</channel></rss>"""


def test_parse_rss_extracts_headlines() -> None:
    rows = news.parse_rss(SAMPLE_RSS, "Mumbai")
    assert len(rows) == 1
    assert rows[0]["city"] == "Mumbai"
    assert rows[0]["headline"] == "Headline A"
    assert rows[0]["article_id"]


def test_ingest_uses_fixture_when_requested(seeded_db, tmp_path) -> None:
    target = news.ingest_news(data_root=tmp_path, day=date(2026, 9, 23), fixture=True)
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    assert len(rows) == 3
    assert all(row["source"] == "fixture" for row in rows)


def test_ingest_falls_back_to_fixture_on_network_error(seeded_db, tmp_path, monkeypatch) -> None:
    def _boom(url, timeout=15):
        raise OSError("offline")

    monkeypatch.setattr(news.urllib.request, "urlopen", _boom)
    target = news.ingest_news(data_root=tmp_path, day=date(2026, 9, 24))
    rows = [json.loads(line) for line in target.read_text().splitlines()]
    assert rows
    assert all(row["source"] == "fixture" for row in rows)
