"""Unit tests for the B7 alerts engine (pure helpers via Fake connection optional)."""

from __future__ import annotations

from quickcart.business.alerts import _table_exists


class _Cur:
    def __init__(self, found: bool) -> None:
        self._found = found

    def execute(self, *_a, **_k) -> None:
        return None

    def fetchone(self):
        return (1,) if self._found else None


def test_table_exists_true() -> None:
    assert _table_exists(_Cur(True), "alerts") is True


def test_table_exists_false() -> None:
    assert _table_exists(_Cur(False), "alerts") is False
