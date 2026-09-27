import json

import numpy as np
import pytest

from quickcart.db.connection import connect
from quickcart.simulator import behavior
from quickcart.simulator.generator import neighborhood_label
from quickcart.simulator.live_writer import (
    apply_inventory_churn_tick,
    create_order,
    emit_rider_location_ping,
    load_reference_data,
    maybe_create_support_ticket,
)


class _CaptureProducer:
    def __init__(self) -> None:
        self.messages: list[tuple[str, bytes, dict]] = []

    def send(self, topic: str, *, key: bytes, value: bytes) -> None:
        self.messages.append((topic, key, json.loads(value)))

    def flush(self) -> None:
        return None


@pytest.mark.unit
def test_neighborhood_label_is_deterministic() -> None:
    assert neighborhood_label("Mumbai", 42) == neighborhood_label("Mumbai", 42)
    assert neighborhood_label("Mumbai", 42) != neighborhood_label("Mumbai", 43)


@pytest.mark.unit
def test_create_order_honors_payment_fail_rate(
    seeded_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = _CaptureProducer()
    monkeypatch.setattr(
        behavior,
        "should_fail_payment",
        lambda rng, method, attempt, *, payment_fail_rate: payment_fail_rate >= 0.99
        and attempt == 1
        and method != "COD",
    )

    with connect() as conn:
        reference = load_reference_data(conn)
        order = create_order(
            conn,
            reference,
            producer,
            np.random.default_rng(18),
            payment_methods=("CARD",),
            payment_fail_rate=1.0,
        )
        payment_statuses = conn.execute(
            "SELECT status FROM payments WHERE order_id = %s ORDER BY attempt_number",
            (order.order_id,),
        ).fetchall()

    assert [row[0] for row in payment_statuses] == ["FAILED", "CAPTURED"]


@pytest.mark.unit
def test_order_placed_event_includes_neighborhood(seeded_db: object) -> None:
    producer = _CaptureProducer()
    with connect() as conn:
        reference = load_reference_data(conn)
        create_order(
            conn,
            reference,
            producer,
            np.random.default_rng(19),
            payment_methods=("COD",),
        )

    placed = next(msg[2] for msg in producer.messages if msg[2]["event_type"] == "ORDER_PLACED")
    assert placed["payload"]["city"]
    assert placed["payload"]["neighborhood"]


@pytest.mark.unit
def test_maybe_create_support_ticket_inserts_row(seeded_db: object) -> None:
    producer = _CaptureProducer()
    with connect() as conn:
        reference = load_reference_data(conn)
        order = create_order(
            conn,
            reference,
            producer,
            np.random.default_rng(20),
            payment_methods=("COD",),
        )
        maybe_create_support_ticket(
            conn,
            producer,
            order,
            np.random.default_rng(21),
            ticket_rate=1.0,
        )
        count = conn.execute(
            "SELECT count(*) FROM support_tickets WHERE order_id = %s",
            (order.order_id,),
        ).fetchone()[0]

    assert count == 1


@pytest.mark.unit
def test_apply_inventory_churn_tick_writes_movement(seeded_db: object) -> None:
    with connect() as conn:
        reference = load_reference_data(conn)
        before_key = next(iter(reference.inventory))
        before_qty = reference.inventory[before_key]
        apply_inventory_churn_tick(
            conn,
            reference,
            np.random.default_rng(22),
            inventory_churn=1.0,
        )
        after_qty = reference.inventory.get(before_key, 0)
        movement = conn.execute(
            """
            SELECT movement_type, quantity_delta
            FROM inventory_movements
            WHERE reference_type = 'SIM_CHURN'
            ORDER BY movement_id DESC
            LIMIT 1
            """
        ).fetchone()

    assert movement is not None
    assert isinstance(movement[1], int)
    assert after_qty != before_qty or movement[1] != 0


@pytest.mark.unit
def test_emit_rider_location_ping_uses_rider_topic(seeded_db: object) -> None:
    producer = _CaptureProducer()
    with connect() as conn:
        reference = load_reference_data(conn)
    if not reference.all_rider_ids:
        pytest.skip("seed has no riders")
    emit_rider_location_ping(producer, reference, np.random.default_rng(23))
    assert producer.messages
    topic, _key, payload = producer.messages[-1]
    assert topic == "quickcart.rider-locations.v1"
    assert payload["event_type"] == "RIDER_LOCATION"
    assert isinstance(payload["payload"]["lat"], float)
