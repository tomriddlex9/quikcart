import pytest

from quickcart.db.fingerprints import reference_fingerprint
from quickcart.simulator.config import SimulatorConfig
from quickcart.simulator.generator import generate_history, generate_reference


@pytest.mark.unit
def test_same_seed_produces_identical_history() -> None:
    cfg = SimulatorConfig().smoke()
    first = generate_history(cfg)
    second = generate_history(cfg)
    assert first.fingerprint == second.fingerprint
    assert first.store_fingerprint == second.store_fingerprint
    assert len(first.orders) == len(second.orders)
    assert len(first.order_items) == len(second.order_items)


@pytest.mark.unit
def test_different_seed_produces_different_history() -> None:
    base = generate_history(SimulatorConfig().smoke())
    other = generate_history(SimulatorConfig(seed=1234).smoke())
    assert base.fingerprint != other.fingerprint


@pytest.mark.unit
def test_reference_is_seed_deterministic() -> None:
    cfg = SimulatorConfig().smoke()
    assert reference_fingerprint(generate_reference(cfg)) == reference_fingerprint(
        generate_reference(cfg)
    )


@pytest.mark.unit
def test_smoke_order_budget_is_exact() -> None:
    history = generate_history(SimulatorConfig().smoke())
    assert len(history.orders) == 500
    assert all(len(order) == 15 for order in history.orders)
