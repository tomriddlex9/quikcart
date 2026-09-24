import asyncio
import json
from decimal import Decimal
from typing import Any

import numpy as np
import pytest

from quickcart.db.connection import connect
from quickcart.simulator import behavior
from quickcart.simulator.live_writer import (
    TransitionDelays,
    create_order,
    load_reference_data,
    transition_order,
)


class RecordingProducer:
    def __init__(self) -> None:
        self.messages: list[tuple[str, bytes, dict[str, Any]]] = []

    def send(self, topic: str, *, key: bytes, value: bytes) -> None:
        self.messages.append((topic, key, json.loads(value)))

    def flush(self) -> None:
        return None


def _event_types(producer: RecordingProducer) -> list[str]:
    return [message[2]["event_type"] for message in producer.messages]


@pytest.mark.unit
def test_create_order_inserts_fk_valid_decimal_rows_and_payment_retry(
    seeded_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = RecordingProducer()
    monkeypatch.setattr(
        behavior,
        "payment_failure_probability",
        lambda method, attempt: 1.0 if attempt == 1 and method != "COD" else 0.0,
    )

    with connect() as conn:
        reference = load_reference_data(conn)
        order = create_order(
            conn,
            reference,
            producer,
            np.random.default_rng(14),
            payment_methods=("CARD",),
        )
        row = conn.execute(
            """
            SELECT o.subtotal, o.total_amount, count(DISTINCT oi.order_item_id) AS item_count,
                   count(DISTINCT p.payment_id) AS payment_count
            FROM orders o
            JOIN customers c ON c.customer_id = o.customer_id
            JOIN stores s ON s.store_id = o.store_id
            JOIN order_items oi ON oi.order_id = o.order_id
            JOIN products pr ON pr.product_id = oi.product_id
            JOIN payments p ON p.order_id = o.order_id
            WHERE o.order_id = %s
            GROUP BY o.order_id
            """,
            (order.order_id,),
        ).fetchone()
        reserve_count = conn.execute(
            """
            SELECT count(*) FROM inventory_movements
            WHERE reference_id = %s AND movement_type = 'ORDER_RESERVE'
            """,
            (str(order.order_id),),
        ).fetchone()[0]

    assert isinstance(row[0], Decimal)
    assert isinstance(row[1], Decimal)
    assert row[0] == order.subtotal
    assert row[1] == order.total_amount
    assert row[2] == len(order.items)
    assert row[3] == 2
    assert reserve_count == len(order.items)
    assert _event_types(producer) == [
        "ORDER_PLACED",
        "PAYMENT_FAILED",
        "PAYMENT_COMPLETED",
    ]


@pytest.mark.unit
@pytest.mark.parametrize(
    ("cancellation_probability", "expected_statuses", "delivery_status"),
    [
        (0.0, ("PLACED", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"), "DELIVERED"),
        (1.0, ("PLACED", "PACKED", "CANCELLED"), "CANCELLED"),
    ],
)
def test_transition_order_is_monotonic_and_writes_delivery(
    seeded_db: object,
    cancellation_probability: float,
    expected_statuses: tuple[str, ...],
    delivery_status: str,
) -> None:
    producer = RecordingProducer()
    with connect() as conn:
        reference = load_reference_data(conn)
        order = create_order(
            conn,
            reference,
            producer,
            np.random.default_rng(21),
            payment_methods=("UPI",),
        )

    statuses = asyncio.run(
        transition_order(
            order,
            reference,
            producer,
            np.random.default_rng(22),
            delays=TransitionDelays(packed=0, dispatched=0, delivered=0),
            cancellation_probability=cancellation_probability,
            connect_factory=connect,
        )
    )

    with connect() as conn:
        row = conn.execute(
            """
            SELECT o.status, d.status, o.placed_at, d.assigned_at, d.picked_up_at,
                   d.delivered_at, d.cancelled_at
            FROM orders o
            JOIN deliveries d ON d.order_id = o.order_id
            WHERE o.order_id = %s
            """,
            (order.order_id,),
        ).fetchone()
        movement_types = {
            result[0]
            for result in conn.execute(
                """
                SELECT movement_type FROM inventory_movements
                WHERE reference_id = %s
                """,
                (str(order.order_id),),
            ).fetchall()
        }

    assert statuses == expected_statuses
    assert row[0] == expected_statuses[-1]
    assert row[1] == delivery_status
    if delivery_status == "DELIVERED":
        assert row[2] <= row[3] <= row[4] <= row[5]
        assert {"ORDER_RESERVE", "ORDER_RELEASE", "SALE"} <= movement_types
    else:
        assert row[2] <= row[6]
        assert {"ORDER_RESERVE", "ORDER_RELEASE"} <= movement_types


@pytest.mark.unit
def test_transition_delays_reject_negative_values() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        TransitionDelays(packed=-0.1)
