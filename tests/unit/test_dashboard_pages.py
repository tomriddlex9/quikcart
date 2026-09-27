"""Smoke tests for Streamlit page renderers (no Streamlit runtime)."""

from __future__ import annotations

from pathlib import Path

import pytest

from quickcart.dashboard_pages import (
    EMPTY_GOLD_HELP,
    PAGES,
    gold_mart_available,
    render_page,
)


class _EmptyReaders:
    def __init__(self, root: Path) -> None:
        self.root = root


class _FakeSt:
    calls: dict[str, int]

    def __init__(self) -> None:
        self.calls = {"metric": 0, "dataframe": 0, "plotly": 0, "info": 0, "warning": 0}
        self._infos: list[str] = []

    @staticmethod
    def columns(n: int):
        return [_FakeSt() for _ in range(n)]

    def plotly_chart(self, *args, **kwargs) -> None:
        self.calls["plotly"] += 1

    def dataframe(self, *args, **kwargs) -> None:
        self.calls["dataframe"] += 1

    def metric(self, *args, **kwargs) -> None:
        self.calls["metric"] += 1

    def info(self, msg, **kwargs) -> None:
        self.calls["info"] += 1
        self._infos.append(str(msg))

    def warning(self, *args, **kwargs) -> None:
        self.calls["warning"] += 1

    caption = staticmethod(lambda *a, **k: None)
    subheader = staticmethod(lambda *a, **k: None)
    success = staticmethod(lambda *a, **k: None)
    selectbox = staticmethod(lambda label, options, **k: options[0])


def test_empty_gold_help_mentions_lakehouse_and_worker() -> None:
    assert "make lakehouse" in EMPTY_GOLD_HELP
    assert "live-worker" in EMPTY_GOLD_HELP


def test_gold_mart_available_false_without_delta_log(tmp_path: Path) -> None:
    readers = _EmptyReaders(tmp_path / "data")
    assert gold_mart_available(readers) is False


def test_gold_pages_render_empty_state_without_spark(tmp_path: Path) -> None:
    readers = _EmptyReaders(tmp_path / "empty-root")
    fake = _FakeSt()
    for page in PAGES:
        if page == "Approvals":
            continue
        render_page(page, readers, fake)
    assert fake.calls["info"] >= len(PAGES) - 1
    assert any("make lakehouse" in msg for msg in fake._infos)


def test_approvals_survives_unreachable_db(monkeypatch: pytest.MonkeyPatch) -> None:
    import quickcart.dashboard_pages as dp

    def _boom() -> list[dict]:
        raise dp.psycopg.OperationalError("connection refused")

    monkeypatch.setattr(dp, "_fetch_proposals", _boom)
    fake = _FakeSt()
    render_page("Approvals", _EmptyReaders(Path("/tmp")), fake)
    assert fake.calls["warning"] >= 1
