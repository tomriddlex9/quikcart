"""The live worker records the serving snapshot as its own heartbeat stage, never fatally."""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("pandas", reason="live worker needs the ml dependency group")

from quickcart.live import worker


class _Conn:
    def __enter__(self) -> _Conn:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> Any:
        class _Result:
            @staticmethod
            def fetchone() -> tuple[str, int]:
                return ("postgres", 641)

        return _Result()


def test_serving_step_writes_a_success_heartbeat(monkeypatch: pytest.MonkeyPatch) -> None:
    heartbeats = []
    monkeypatch.setattr(worker, "write_heartbeat", heartbeats.append)
    monkeypatch.setattr("quickcart.db.connection.connect", lambda **_: _Conn())
    monkeypatch.setattr(
        "quickcart.business.snapshot.run_serving_snapshot", lambda conn, readers: 12
    )

    outcome = worker.run_serving_step(object(), None)  # type: ignore[arg-type]

    assert outcome == {"snapshot_run_id": 12, "source": "postgres", "rows_out": 641}
    assert [h.stage for h in heartbeats] == ["serving_snapshot"]
    assert heartbeats[0].error is None and heartbeats[0].rows_out == 641


def test_serving_step_failure_is_recorded_and_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    heartbeats = []
    monkeypatch.setattr(worker, "write_heartbeat", heartbeats.append)

    def explode(**_: Any) -> Any:
        raise RuntimeError("postgres down")

    monkeypatch.setattr("quickcart.db.connection.connect", explode)

    assert worker.run_serving_step(object(), None) is None  # type: ignore[arg-type]
    assert heartbeats[0].stage == "serving_snapshot" and "postgres down" in heartbeats[0].error
