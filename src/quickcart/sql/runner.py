"""SQL exercise catalog runner (kit/03 Phase 2).

Discovers `sql/exercises/**/*.sql`, executes each against the operational
database, and reports per-file success + row counts. Exercises ship with
header comments documenting the business question, assumptions, and edge
cases (kit/05 §4.7).
"""

from dataclasses import dataclass, field
from pathlib import Path

import psycopg

from quickcart.db.connection import connect

REPO_ROOT = Path(__file__).resolve().parents[3]
EXERCISE_ROOT = REPO_ROOT / "sql" / "exercises"


@dataclass
class ExerciseResult:
    path: Path
    ok: bool
    rows: int = 0
    error: str | None = None
    sql: str = ""


@dataclass
class ExerciseReport:
    results: list[ExerciseResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(r.ok and r.rows >= 1 for r in self.results)

    @property
    def failures(self) -> list[ExerciseResult]:
        return [r for r in self.results if not r.ok or r.rows < 1]


def discover_exercises() -> list[Path]:
    return sorted(EXERCISE_ROOT.rglob("*.sql"))


def run_exercise(conn: psycopg.Connection, path: Path) -> ExerciseResult:
    sql = path.read_text(encoding="utf-8")
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall() if cur.description is not None else []
        return ExerciseResult(path=path, ok=True, rows=len(rows), sql=sql)
    except psycopg.Error as exc:
        return ExerciseResult(path=path, ok=False, error=str(exc), sql=sql)


def run_all(conn: psycopg.Connection | None = None) -> ExerciseReport:
    own_connection = conn is None
    if own_connection:
        conn = connect(autocommit=True)
    assert conn is not None
    try:
        results = [run_exercise(conn, path) for path in discover_exercises()]
    finally:
        if own_connection:
            conn.close()
    return ExerciseReport(results=results)


def construct_coverage() -> dict[str, int]:
    """Static keyword counts used by the Phase 2 acceptance gate (kit/07)."""
    files = discover_exercises()
    text = {p: p.read_text(encoding="utf-8").lower() for p in files}
    return {
        "total": len(files),
        "joins": sum(1 for t in text.values() if " join " in t),
        "aggregations": sum(1 for t in text.values() if "group by" in t),
        "ctes": sum(1 for t in text.values() if t.count("with ") >= 1),
        "window_functions": sum(
            1 for t in text.values() if any(k in t for k in ("over (", "rank(", "lag(", "lead("))
        ),
        "row_number": sum(1 for t in text.values() if "row_number(" in t),
        "lag_lead": sum(1 for t in text.values() if "lag(" in t or "lead(" in t),
        "rolling": sum(1 for t in text.values() if "preceding" in t),
        "cohort_or_funnel": sum(
            1 for t in text.values() if "cohort" in t or "funnel" in t
        ),
        "conditional_aggregation": sum(
            1 for t in text.values() if "filter (where" in t
        ),
    }
