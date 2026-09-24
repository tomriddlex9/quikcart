"""Persistence and defaults for the bounded simulator control surface."""

from __future__ import annotations

import pytest

from quickcart.live.sim_control import (
    SimControlState,
    control_path,
    load_control,
    patch_control,
    save_control,
    start,
    stop,
)


def test_load_control_defaults_when_file_missing(tmp_path) -> None:
    state = load_control(tmp_path)

    assert state == SimControlState(
        running=True,
        orders_per_minute=120,
        cancel_rate=0.05,
        payment_fail_rate=0.03,
        inventory_churn=0.1,
        rider_ping_hz=1.0,
        ticket_rate=0.02,
        burst_factor=1.0,
    )


def test_load_control_defaults_when_file_is_invalid_json(tmp_path) -> None:
    path = control_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not json", encoding="utf-8")

    state = load_control(tmp_path)

    assert state == SimControlState()


def test_save_and_load_round_trip(tmp_path) -> None:
    state = SimControlState(running=False, orders_per_minute=42.5, cancel_rate=0.2)

    save_control(state, tmp_path)
    reloaded = load_control(tmp_path)

    assert reloaded == state
    assert control_path(tmp_path).exists()


def test_patch_control_updates_only_given_fields(tmp_path) -> None:
    save_control(SimControlState(orders_per_minute=200), tmp_path)

    updated = patch_control(tmp_path, cancel_rate=0.5)

    assert updated.cancel_rate == 0.5
    assert updated.orders_per_minute == 200


def test_patch_control_ignores_none_values(tmp_path) -> None:
    save_control(SimControlState(orders_per_minute=200), tmp_path)

    updated = patch_control(tmp_path, orders_per_minute=None, cancel_rate=0.25)

    assert updated.orders_per_minute == 200
    assert updated.cancel_rate == 0.25


def test_patch_control_rejects_unknown_field(tmp_path) -> None:
    with pytest.raises(ValueError, match="unknown sim control field"):
        patch_control(tmp_path, not_a_field=1)


def test_start_sets_running_true(tmp_path) -> None:
    save_control(SimControlState(running=False), tmp_path)

    updated = start(tmp_path)

    assert updated.running is True
    assert load_control(tmp_path).running is True


def test_stop_sets_running_false(tmp_path) -> None:
    save_control(SimControlState(running=True), tmp_path)

    updated = stop(tmp_path)

    assert updated.running is False
    assert load_control(tmp_path).running is False


def test_state_rejects_out_of_range_values() -> None:
    with pytest.raises(ValueError):
        SimControlState(cancel_rate=1.5)
    with pytest.raises(ValueError):
        SimControlState(orders_per_minute=0)
