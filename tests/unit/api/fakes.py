"""Test doubles for the read-only console API: a psycopg-shaped connection and
a local-LLM stub.

`FakeConnection` implements only the surface `sql_service`/`catalog` use
(``read_only``, ``transaction()``, ``cursor(row_factory=...)``, context
management) and records every statement in order, so tests can assert *how* a
query was run — read-only transaction first, ``statement_timeout`` set, then
the statement. It also plays the server's part: when the connection is
read-only, a write raises ``ReadOnlySqlTransaction`` exactly as PostgreSQL
would, which is how the second line of defence is exercised without a database.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import psycopg

_WRITE_RE = re.compile(
    r"\s*(insert|update|delete|drop|alter|create|truncate|merge|copy|grant)\b",
    re.IGNORECASE,
)
_QUERY_RE = re.compile(r"\s*(select|with)\b", re.IGNORECASE)

Responder = Callable[[str], tuple[list[str], list[dict[str, Any]]]]


@dataclass(frozen=True)
class FakeColumn:
    """Stands in for ``psycopg.Cursor.description`` entries."""

    name: str


class FakeCursor:
    def __init__(self, conn: "FakeConnection") -> None:
        self._conn = conn
        self.description: list[FakeColumn] | None = None
        self._rows: list[dict[str, Any]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def execute(self, statement: str, params: Sequence[Any] | None = None) -> None:
        self._conn.events.append(("execute", statement, tuple(params or ())))
        if self._conn.read_only and _WRITE_RE.match(statement):
            raise psycopg.errors.ReadOnlySqlTransaction(
                "cannot execute a write in a read-only transaction"
            )
        if not _QUERY_RE.match(statement):
            self.description = None
            self._rows = []
            return
        if self._conn.error is not None:
            raise self._conn.error
        columns, rows = self._conn.result_for(statement)
        self.description = [FakeColumn(name) for name in columns]
        self._rows = rows

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def fetchone(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None


class _FakeTransaction:
    def __init__(self, conn: "FakeConnection") -> None:
        self._conn = conn

    def __enter__(self) -> "_FakeTransaction":
        self._conn.events.append(("begin", "", ()))
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._conn.events.append(("end", "", ()))
        return None


class FakeConnection:
    """Minimal psycopg-shaped connection over canned results."""

    def __init__(
        self,
        *,
        columns: Sequence[str] = (),
        rows: Sequence[dict[str, Any]] = (),
        responder: Responder | None = None,
        error: Exception | None = None,
    ) -> None:
        self._columns = list(columns)
        self._rows = [dict(row) for row in rows]
        self._responder = responder
        self.error = error
        self.events: list[tuple[str, str, tuple[Any, ...]]] = []
        self.closed = False
        self._read_only = False

    # --- psycopg surface ------------------------------------------------------
    @property
    def read_only(self) -> bool:
        return self._read_only

    @read_only.setter
    def read_only(self, value: bool) -> None:
        if any(event[0] == "begin" for event in self.events):
            raise AssertionError("read_only was set after the transaction started")
        self._read_only = value
        self.events.append(("read_only", str(value), ()))

    def transaction(self) -> _FakeTransaction:
        return _FakeTransaction(self)

    def cursor(self, row_factory: Any = None) -> FakeCursor:
        return FakeCursor(self)

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        self.closed = True
        return False

    # --- assertions helpers ---------------------------------------------------
    def result_for(self, statement: str) -> tuple[list[str], list[dict[str, Any]]]:
        if self._responder is not None:
            return self._responder(statement)
        return self._columns, list(self._rows)

    @property
    def statements(self) -> list[str]:
        return [event[1] for event in self.events if event[0] == "execute"]


class FakeConnectFactory:
    """``connect_factory`` stub that hands out (and records) fake connections."""

    def __init__(
        self,
        *,
        columns: Sequence[str] = (),
        rows: Sequence[dict[str, Any]] = (),
        responder: Responder | None = None,
        error: Exception | None = None,
        connect_error: Exception | None = None,
    ) -> None:
        self._kwargs = {
            "columns": columns,
            "rows": rows,
            "responder": responder,
            "error": error,
        }
        self._connect_error = connect_error
        self.connections: list[FakeConnection] = []

    def __call__(self, **_: Any) -> FakeConnection:
        if self._connect_error is not None:
            raise self._connect_error
        conn = FakeConnection(**self._kwargs)  # type: ignore[arg-type]
        self.connections.append(conn)
        return conn

    @property
    def last(self) -> FakeConnection:
        assert self.connections, "no connection was opened"
        return self.connections[-1]


class ExplodingConnectFactory:
    """Fails the test if a connection is opened at all (guard-rejected paths)."""

    def __call__(self, **_: Any) -> FakeConnection:
        raise AssertionError("a connection must not be opened for a rejected statement")


@dataclass(frozen=True)
class _FakeType:
    name: str

    def simpleString(self) -> str:
        return self.name


@dataclass(frozen=True)
class _FakeField:
    name: str
    dataType: Any
    nullable: bool = True


@dataclass(frozen=True)
class _FakeSchema:
    fields: list[_FakeField]


class FakeRow:
    def __init__(self, values: dict[str, Any]) -> None:
        self._values = dict(values)

    def asDict(self, recursive: bool = False) -> dict[str, Any]:
        return dict(self._values)


class FakeDataFrame:
    """Just enough of `pyspark.sql.DataFrame` for catalog/preview reads."""

    def __init__(self, columns: Sequence[str], rows: Sequence[dict[str, Any]] = ()) -> None:
        self.columns = list(columns)
        self._rows = [dict(row) for row in rows]

    @property
    def schema(self) -> _FakeSchema:
        return _FakeSchema([_FakeField(name, _FakeType("bigint")) for name in self.columns])

    def limit(self, count: int) -> "FakeDataFrame":
        return FakeDataFrame(self.columns, self._rows[:count])

    def collect(self) -> list[FakeRow]:
        return [FakeRow(row) for row in self._rows]


class _FakeReader:
    def __init__(self, spark: "FakeSpark") -> None:
        self._spark = spark

    def format(self, _: str) -> "_FakeReader":
        return self

    def load(self, location: str) -> FakeDataFrame:
        self._spark.loaded.append(location)
        return FakeDataFrame(self._spark.columns, self._spark.rows)


class FakeSpark:
    """Spark stand-in that serves one canned Delta table for every path."""

    def __init__(
        self, columns: Sequence[str] = (), rows: Sequence[dict[str, Any]] = ()
    ) -> None:
        self.columns = list(columns)
        self.rows = [dict(row) for row in rows]
        self.loaded: list[str] = []

    @property
    def read(self) -> _FakeReader:
        return _FakeReader(self)


class FakeLLM:
    """Deterministic stand-in for `quickcart.agents.llm.OllamaLLM`."""

    def __init__(self, reply: str = "", error: Exception | None = None) -> None:
        self.model = "fake-model"
        self._reply = reply
        self._error = error
        self.calls: list[list[dict[str, str]]] = []

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        json_mode: bool = False,
        max_tokens: int | None = None,
    ) -> str:
        self.calls.append(messages)
        if self._error is not None:
            raise self._error
        return self._reply
