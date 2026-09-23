from datetime import date

import numpy as np
import pytest

from quickcart.simulator import behavior


@pytest.mark.unit
def test_peak_hours_outsell_offpeak_hours() -> None:
    assert behavior.hour_multiplier(19) > behavior.hour_multiplier(4)
    assert behavior.hour_multiplier(12) > behavior.hour_multiplier(2)


@pytest.mark.unit
def test_weekend_multiplier_exceeds_weekday() -> None:
    assert behavior.weekend_multiplier(date(2026, 7, 4)) > behavior.weekend_multiplier(
        date(2026, 7, 6)
    )


@pytest.mark.unit
def test_rain_peak_shortage_raise_cancellation_probability() -> None:
    base = behavior.cancellation_probability(weather="CLEAR", peak=False, shortage=0.0)
    stressed = behavior.cancellation_probability(weather="RAIN", peak=True, shortage=0.8)
    assert stressed > base


@pytest.mark.unit
def test_shortage_factor_monotonic_in_demand() -> None:
    low = behavior.rider_shortage_factor(active_riders=10, demand_index=1.0)
    high = behavior.rider_shortage_factor(active_riders=10, demand_index=8.0)
    assert 0.0 <= low < high <= 1.0


@pytest.mark.unit
def test_pick_minutes_grow_with_basket() -> None:
    rng = np.random.default_rng(7)
    small = [behavior.pick_minutes(rng, basket_units=1, queue_factor=0.2) for _ in range(2000)]
    big = [behavior.pick_minutes(rng, basket_units=9, queue_factor=0.2) for _ in range(2000)]
    assert np.mean(big) > np.mean(small) * 1.5


@pytest.mark.unit
def test_ride_minutes_grow_with_shortage_and_rain() -> None:
    rng = np.random.default_rng(11)
    calm = [
        behavior.ride_minutes(rng, distance_km=3.0, shortage=0.0, weather="CLEAR")
        for _ in range(2000)
    ]
    stressed = [
        behavior.ride_minutes(rng, distance_km=3.0, shortage=0.9, weather="RAIN")
        for _ in range(2000)
    ]
    assert np.mean(stressed) > np.mean(calm) * 1.3


@pytest.mark.unit
def test_card_fails_more_than_upi_and_retries_improve() -> None:
    assert behavior.payment_failure_probability("CARD", 1) > behavior.payment_failure_probability(
        "UPI", 1
    )
    assert behavior.payment_failure_probability("CARD", 2) < behavior.payment_failure_probability(
        "CARD", 1
    )


@pytest.mark.unit
def test_weather_draw_is_seeded() -> None:
    rng_a = np.random.default_rng(5)
    rng_b = np.random.default_rng(5)
    days = [date(2026, 8, d) for d in range(1, 15)]
    draw_a = [behavior.draw_weather(rng_a, d) for d in days]
    draw_b = [behavior.draw_weather(rng_b, d) for d in days]
    assert draw_a == draw_b
    assert set(draw_a) <= {"CLEAR", "RAIN", "HEAT"}
