from quickcart.live.contracts import StageHeartbeat
from quickcart.live.heartbeat import upsert_heartbeat


class _Cursor:
    def __init__(self) -> None:
        self.sql = ""
        self.params = ()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, sql, params) -> None:
        self.sql = sql
        self.params = params


class _Connection:
    def __init__(self) -> None:
        self.cursor_instance = _Cursor()

    def cursor(self):
        return self.cursor_instance


def test_upsert_heartbeat_updates_existing_stage() -> None:
    connection = _Connection()
    heartbeat = StageHeartbeat(
        stage="ml_scoring",
        last_run_at="2026-09-25T00:00:00+00:00",
        rows_in=4,
        rows_out=2,
        lag_seconds=1.5,
        detail={"model": "delivery_delay_classifier"},
    )

    upsert_heartbeat(heartbeat, connection=connection)

    cursor = connection.cursor_instance
    assert "INSERT INTO pipeline_status" in cursor.sql
    assert "ON CONFLICT (stage) DO UPDATE" in cursor.sql
    assert cursor.params[:5] == (
        "ml_scoring",
        "2026-09-25T00:00:00+00:00",
        4,
        2,
        1.5,
    )
    assert '"model": "delivery_delay_classifier"' in cursor.params[6]
