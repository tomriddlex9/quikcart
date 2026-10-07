"""Unit tests for Phase B6 simulator business helpers."""

from __future__ import annotations

import random
from decimal import Decimal

from quickcart.simulator.business import (
    cost_for_product,
    maybe_refund,
    rating_for_delivery,
    redemption_for_order,
    target_from_trailing,
    wastage_qty,
)


def test_cost_for_product_below_selling_price() -> None:
    cost = cost_for_product("Dairy", Decimal("40.00"), rng=random.Random(1))
    assert Decimal("0.01") <= cost < Decimal("40.00")


def test_maybe_refund_more_likely_when_late() -> None:
    late = sum(
        1
        for i in range(200)
        if maybe_refund(True, Decimal("500"), rng=random.Random(i)) is not None
    )
    on_time = sum(
        1
        for i in range(200)
        if maybe_refund(False, Decimal("500"), rng=random.Random(i)) is not None
    )
    assert late > on_time


def test_rating_bounds() -> None:
    rng = random.Random(0)
    for _ in range(50):
        assert 1 <= rating_for_delivery(False, rng=rng) <= 5
        assert 1 <= rating_for_delivery(True, rng=rng) <= 5


def test_target_from_trailing() -> None:
    assert target_from_trailing(100) == Decimal("110.00")


def test_redemption_requires_promo_and_discount() -> None:
    assert redemption_for_order(None, 10) is None
    assert redemption_for_order(3, 0) is None
    assert redemption_for_order(3, Decimal("12.5")) == {
        "promotion_id": 3,
        "discount_amount": Decimal("12.5"),
    }


def test_wastage_qty_non_negative() -> None:
    rng = random.Random(2)
    assert wastage_qty(0, rng=rng, perishable=True) == 0
    qty = wastage_qty(100, rng=random.Random(99), perishable=True)
    assert qty >= 0
