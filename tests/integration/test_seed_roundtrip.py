import pytest

from quickcart.db.connection import connect, fetch_all
from quickcart.db.validate import run_validation


@pytest.mark.integration
def test_seeded_database_passes_validation(seeded_db) -> None:
    report = run_validation()
    failed = [name for name, result in report.checks.items() if not result.ok]
    assert report.passed, f"failed checks: {failed}"
    # The DB-derived fingerprint must match the generator's own fingerprint.
    assert report.fingerprint == seeded_db.store_fingerprint


@pytest.mark.integration
def test_deliveries_are_temporally_ordered(seeded_db) -> None:
    with connect(autocommit=True) as conn:
        (violations,) = fetch_all(
            conn,
            """SELECT count(*) AS n FROM deliveries d JOIN orders o ON o.order_id = d.order_id
               WHERE d.delivered_at < o.placed_at
                  OR d.picked_up_at < d.assigned_at
                  OR d.assigned_at < o.placed_at""",
        )
    assert violations["n"] == 0


@pytest.mark.integration
def test_reproducible_after_reset(seeded_db) -> None:
    """Reset + reseed reproduces the identical dataset (kit/02 FR-001/FR-002)."""
    from quickcart.db.load import load_history, load_reference
    from quickcart.db.reset import reset_schema
    from quickcart.simulator.config import SimulatorConfig
    from quickcart.simulator.generator import generate_history, generate_reference

    before = run_validation().fingerprint
    reset_schema()
    cfg = SimulatorConfig().smoke()
    ref = generate_reference(cfg)
    history = generate_history(cfg)
    with connect() as conn, conn.transaction(), conn.cursor() as cur:
        load_reference(cur, ref)
        load_history(cur, history)
    after = run_validation().fingerprint
    assert before == after
