"""Causal behavior model (kit/05 §8).

Synthetic data must contain real patterns, not IID random labels:

    demand  = base x hour x weekday/weekend x store x popularity x promo x weather
    pick    = base pick + basket-size effect + queue effect
    ride    = f(distance) + rider-shortage effect + weather effect + noise
    late    = derived from promised-vs-actual, never sampled directly

All functions are pure: randomness arrives only through an injected
`numpy.random.Generator`, which keeps the whole simulator deterministic
under a fixed seed.
"""

from datetime import date, timedelta
from typing import Literal

from numpy.random import Generator

Weather = Literal["CLEAR", "RAIN", "HEAT"]

# 24 hour-of-day demand multipliers (index = hour, local UTC convention).
HOUR_MULTIPLIERS: tuple[float, ...] = (
    0.12, 0.07, 0.05, 0.04, 0.05, 0.09,  # 00-05
    0.18, 0.30, 0.45, 0.50, 0.42, 0.38,  # 06-11
    0.45, 0.50, 0.42, 0.35, 0.38, 0.45,  # 12-17
    0.58, 0.72, 0.85, 0.80, 0.62, 0.38,  # 18-23
)

PEAK_HOURS = frozenset(range(12, 15)) | frozenset(range(18, 23))


def hour_multiplier(hour: int) -> float:
    return HOUR_MULTIPLIERS[hour % 24]


def is_weekend(day: date) -> bool:
    return day.weekday() >= 5


def weekend_multiplier(day: date) -> float:
    return 1.18 if is_weekend(day) else 1.0


def draw_weather(rng: Generator, day: date) -> Weather:
    """Seasonal weather: rain likelier in monsoon months (Jul-Sep), heat in Apr-Jun."""
    month = day.month
    p_rain = {7: 0.42, 8: 0.48, 9: 0.38}.get(month, 0.10)
    p_heat = {4: 0.30, 5: 0.38, 6: 0.28}.get(month, 0.04)
    roll = rng.random()
    if roll < p_rain:
        return "RAIN"
    if roll < p_rain + p_heat:
        return "HEAT"
    return "CLEAR"


def draw_distance_km(rng: Generator) -> float:
    """Order delivery distance, km — right-skewed like real urban quick-commerce."""
    return round(float(rng.lognormal(mean=0.85, sigma=0.45)), 2)


def rider_shortage_factor(active_riders: int, demand_index: float) -> float:
    """0 = no shortage, ~1 = severe shortage.

    `demand_index` is expected concurrent order volume for the store-hour
    relative to that store's own daily average.
    """
    if active_riders <= 0:
        return 1.0
    pressure = demand_index / max(active_riders, 1.0)
    return float(min(1.0, max(0.0, (pressure - 0.35) / 1.2)))


def pick_minutes(rng: Generator, basket_units: int, queue_factor: float) -> float:
    """Base pick time + basket-size effect + store queue effect + noise (minutes)."""
    base = 3.5 + 1.15 * basket_units
    value = base * (0.75 + 0.5 * queue_factor) * float(rng.normal(1.0, 0.08))
    return max(2.0, value)


def ride_minutes(
    rng: Generator,
    distance_km: float,
    shortage: float,
    weather: Weather,
) -> float:
    """Distance effect + rider-shortage effect + weather effect + noise (minutes)."""
    distance_km = float(distance_km)
    value = (
        (5.0 + 3.4 * distance_km)
        * (1.0 + 0.9 * shortage)
        * (1.25 if weather == "RAIN" else 1.08 if weather == "HEAT" else 1.0)
        * float(rng.normal(1.0, 0.07))
    )
    return max(4.0, value)


def assign_wait_minutes(rng: Generator, shortage: float) -> float:
    """Time from payment to rider assignment, driven by rider availability."""
    return max(0.5, float(rng.exponential(1.5 + 6.0 * shortage)))


def cancellation_probability(*, weather: Weather, peak: bool, shortage: float) -> float:
    """Rain + peak hour + rider shortage raise cancellation probability."""
    p = 0.018
    if weather == "RAIN":
        p += 0.012
    if peak:
        p += 0.008
    p += 0.02 * shortage
    return min(p, 0.12)


def payment_failure_probability(method: str, attempt: int) -> float:
    """First attempts fail sometimes (cards worst); retries mostly succeed."""
    base = {"CARD": 0.14, "UPI": 0.06, "WALLET": 0.08, "NETBANKING": 0.10, "COD": 0.0}[method]
    return base if attempt == 1 else 0.02


def basket_size(rng: Generator) -> int:
    """Number of distinct items in the basket (1..10, right-skewed)."""
    return int(min(10, 1 + rng.poisson(2.2)))


def day_range(start: date, end: date) -> list[date]:
    days = (end - start).days + 1
    return [start + timedelta(days=i) for i in range(days)]
