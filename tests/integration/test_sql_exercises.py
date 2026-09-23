from pathlib import Path

import pytest

from quickcart.sql.runner import construct_coverage, run_all

EXERCISE_ROOT = Path("sql/exercises")


@pytest.mark.integration
def test_all_exercises_execute_and_return_rows(seeded_db) -> None:
    report = run_all()
    assert len(report.results) == 30, "expected the 30-question catalog"
    assert report.passed, [
        (r.path.name, r.error, r.rows) for r in report.failures
    ]


@pytest.mark.integration
def test_construct_coverage_meets_phase2_gate(seeded_db) -> None:
    coverage = construct_coverage()
    assert coverage["total"] == 30
    # kit/07 Phase 2: ≥10 joins/aggregations, ≥10 intermediate constructs,
    # window/CTE/time logic demonstrated in the advanced set. kit/02 §10 also
    # requires ROW_NUMBER, RANK, LAG and LEAD to each appear somewhere.
    assert coverage["joins"] >= 10, coverage
    assert coverage["aggregations"] >= 10, coverage
    assert coverage["ctes"] >= 5, coverage
    assert coverage["window_functions"] >= 5, coverage
    assert coverage["row_number"] >= 1, coverage
    assert coverage["lag_lead"] >= 1, coverage
    texts = [p.read_text(encoding="utf-8").lower() for p in EXERCISE_ROOT.rglob("*.sql")]
    assert any("rank(" in t for t in texts), "RANK required (kit/02 §10)"
    assert any("lead(" in t for t in texts), "LEAD required (kit/02 §10)"
    assert coverage["rolling"] >= 1, coverage
    assert coverage["cohort_or_funnel"] >= 2, coverage
    assert coverage["conditional_aggregation"] >= 5, coverage
