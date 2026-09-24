"""Continuously write realistic live orders to PostgreSQL and Redpanda.

Run with::

    uv run python -m quickcart.simulator.live_writer --rate 2

Use ``--burst N`` for a finite local smoke run. PostgreSQL remains the
operational source of truth; the Kafka events are the matching business-event
stream, while Debezium independently captures row-level changes.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Protocol

import numpy as np
import psycopg
import structlog
from kafka import KafkaProducer
from psycopg.rows import dict_row

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.logging import configure_logging
from quickcart.simulator import behavior
from quickcart.simulator.generator import FAILURE_CODES, PAYMENT_METHOD_WEIGHTS, money
from quickcart.simulator.realtime import TOPIC, _event

log = structlog.get_logger(__name__)

INR = "INR"
DEFAULT_CANCELLATION_PROBABILITY = 0.05
ConnectFactory = Callable[[], psycopg.Connection]


class EventProducer(Protocol):
    """The small producer surface needed by the live writer."""

    def send(self, topic: str, *, key: bytes, value: bytes) -> Any: ...

    def flush(self) -> Any: ...


@dataclass(frozen=True)
class CustomerReference:
    customer_id: int
    address_id: int | None


@dataclass
class ReferenceData:
    """Reference rows cached at startup, including an in-process stock view."""

    store_ids: tuple[int, ...]
    product_ids: tuple[int, ...]
    customers: tuple[CustomerReference, ...]
    riders_by_store: dict[int, tuple[int, ...]]
    inventory: dict[tuple[int, int], int]
    prices: dict[tuple[int | None, int], Decimal]


@dataclass(frozen=True)
class OrderItem:
    product_id: int
    quantity: int
    unit_price: Decimal
    line_total: Decimal


@dataclass(frozen=True)
class CreatedOrder:
    order_id: int
    customer_id: int
    store_id: int
    address_id: int | None
    subtotal: Decimal
    tax_amount: Decimal
    delivery_fee: Decimal
    total_amount: Decimal
    placed_at: datetime
    items: tuple[OrderItem, ...]


@dataclass(frozen=True)
class TransitionDelays:
    """Short wall-clock delays used to make concurrent lifecycle changes visible."""

    packed: float = 0.25
    dispatched: float = 0.35
    delivered: float = 0.50

    def __post_init__(self) -> None:
        if min(self.packed, self.dispatched, self.delivered) < 0:
            raise ValueError("transition delays must be non-negative")


class StockUnavailable(RuntimeError):
    """Raised when another writer consumes stock selected by this process."""


def load_reference_data(conn: psycopg.Connection) -> ReferenceData:
    """Load the operational reference rows needed to create FK-valid orders."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT store_id FROM stores WHERE is_active ORDER BY store_id")
        store_ids = tuple(int(row["store_id"]) for row in cur.fetchall())

        cur.execute("SELECT product_id FROM products WHERE is_active ORDER BY product_id")
        product_ids = tuple(int(row["product_id"]) for row in cur.fetchall())

        cur.execute(
            """
            SELECT c.customer_id, address.address_id
            FROM customers c
            LEFT JOIN LATERAL (
                SELECT ca.address_id
                FROM customer_addresses ca
                WHERE ca.customer_id = c.customer_id
                  AND (ca.valid_to IS NULL OR ca.valid_to > now())
                ORDER BY ca.is_default DESC, ca.address_id
                LIMIT 1
            ) address ON TRUE
            WHERE c.is_active
            ORDER BY c.customer_id
            """
        )
        customers = tuple(
            CustomerReference(
                customer_id=int(row["customer_id"]),
                address_id=int(row["address_id"]) if row["address_id"] is not None else None,
            )
            for row in cur.fetchall()
        )

        cur.execute("SELECT rider_id, home_store_id FROM riders ORDER BY rider_id")
        rider_rows = cur.fetchall()
        riders_by_store = {
            store_id: tuple(
                int(row["rider_id"]) for row in rider_rows if int(row["home_store_id"]) == store_id
            )
            for store_id in store_ids
        }

        cur.execute(
            """
            SELECT store_id, product_id, on_hand_qty
            FROM inventory
            WHERE on_hand_qty > 0
            ORDER BY store_id, product_id
            """
        )
        inventory = {
            (int(row["store_id"]), int(row["product_id"])): int(row["on_hand_qty"])
            for row in cur.fetchall()
        }

        cur.execute(
            """
            SELECT store_id, product_id, selling_price
            FROM product_prices
            WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
            ORDER BY product_price_id
            """
        )
        prices = {
            (
                int(row["store_id"]) if row["store_id"] is not None else None,
                int(row["product_id"]),
            ): money(row["selling_price"])
            for row in cur.fetchall()
        }

    if not store_ids:
        raise RuntimeError("live writer requires at least one active store")
    if not product_ids or not inventory:
        raise RuntimeError("live writer requires products with positive inventory")
    if not customers:
        raise RuntimeError("live writer requires at least one active customer")
    if not prices:
        raise RuntimeError("live writer requires at least one current product price")
    return ReferenceData(
        store_ids=store_ids,
        product_ids=product_ids,
        customers=customers,
        riders_by_store=riders_by_store,
        inventory=inventory,
        prices=prices,
    )


def _price_for(reference: ReferenceData, store_id: int, product_id: int) -> Decimal | None:
    return reference.prices.get((store_id, product_id)) or reference.prices.get((None, product_id))


def _draw_payment_method(rng: np.random.Generator, methods: Sequence[str] | None) -> str:
    if methods:
        return methods[int(rng.integers(0, len(methods)))]
    roll = float(rng.random())
    cumulative = 0.0
    for method, probability in PAYMENT_METHOD_WEIGHTS:
        cumulative += probability
        if roll <= cumulative:
            return method
    return "UPI"


def _draft_order(reference: ReferenceData, rng: np.random.Generator) -> CreatedOrder:
    candidates_by_store: dict[int, list[int]] = {}
    for (store_id, product_id), quantity in reference.inventory.items():
        if quantity > 0 and _price_for(reference, store_id, product_id) is not None:
            candidates_by_store.setdefault(store_id, []).append(product_id)
    stores = sorted(candidates_by_store)
    if not stores:
        raise StockUnavailable("no priced inventory remains for a live order")

    store_id = stores[int(rng.integers(0, len(stores)))]
    candidates = candidates_by_store[store_id]
    item_count = min(behavior.basket_size(rng), len(candidates))
    selected = rng.choice(candidates, size=item_count, replace=False)
    items: list[OrderItem] = []
    for selected_product in selected:
        product_id = int(selected_product)
        available = reference.inventory[(store_id, product_id)]
        requested = 1 if rng.random() < 0.75 else 2
        quantity = min(requested, available)
        unit_price = _price_for(reference, store_id, product_id)
        if unit_price is None:
            raise RuntimeError(f"price disappeared for store={store_id}, product={product_id}")
        items.append(
            OrderItem(
                product_id=product_id,
                quantity=quantity,
                unit_price=unit_price,
                line_total=money(unit_price * quantity),
            )
        )

    customer = reference.customers[int(rng.integers(0, len(reference.customers)))]
    subtotal = money(sum((item.line_total for item in items), Decimal("0.00")))
    delivery_fee = money(30)
    tax_amount = money(subtotal * Decimal("0.05"))
    return CreatedOrder(
        order_id=0,
        customer_id=customer.customer_id,
        store_id=store_id,
        address_id=customer.address_id,
        subtotal=subtotal,
        tax_amount=tax_amount,
        delivery_fee=delivery_fee,
        total_amount=money(subtotal + delivery_fee + tax_amount),
        placed_at=datetime.now(UTC),
        items=tuple(items),
    )


def _publish(producer: EventProducer, event: dict[str, Any], order_id: int) -> None:
    producer.send(
        TOPIC,
        key=str(order_id).encode(),
        value=json.dumps(event, separators=(",", ":")).encode(),
    )


def create_order(
    conn: psycopg.Connection,
    reference: ReferenceData,
    producer: EventProducer,
    rng: np.random.Generator,
    *,
    payment_methods: Sequence[str] | None = None,
) -> CreatedOrder:
    """Atomically create an order, reserve stock, and record payment attempts."""
    draft = _draft_order(reference, rng)
    payment_events: list[dict[str, Any]] = []
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO orders (
                customer_id, store_id, address_id, status, subtotal, item_discount,
                promo_discount, delivery_fee, tax_amount, total_amount, currency,
                placed_at, updated_at
            )
            VALUES (%s, %s, %s, 'PLACED', %s, 0, 0, %s, %s, %s, %s, %s, %s)
            RETURNING order_id
            """,
            (
                draft.customer_id,
                draft.store_id,
                draft.address_id,
                draft.subtotal,
                draft.delivery_fee,
                draft.tax_amount,
                draft.total_amount,
                INR,
                draft.placed_at,
                draft.placed_at,
            ),
        )
        order_id = int(cur.fetchone()[0])

        for item in draft.items:
            cur.execute(
                """
                UPDATE inventory
                SET on_hand_qty = on_hand_qty - %s, updated_at = %s
                WHERE store_id = %s AND product_id = %s AND on_hand_qty >= %s
                RETURNING on_hand_qty
                """,
                (
                    item.quantity,
                    draft.placed_at,
                    draft.store_id,
                    item.product_id,
                    item.quantity,
                ),
            )
            if cur.fetchone() is None:
                raise StockUnavailable(
                    f"stock changed for store={draft.store_id}, product={item.product_id}"
                )
            cur.execute(
                """
                INSERT INTO order_items (
                    order_id, product_id, quantity, unit_price, line_discount,
                    line_total, created_at
                )
                VALUES (%s, %s, %s, %s, 0, %s, %s)
                """,
                (
                    order_id,
                    item.product_id,
                    item.quantity,
                    item.unit_price,
                    item.line_total,
                    draft.placed_at,
                ),
            )
            cur.execute(
                """
                INSERT INTO inventory_movements (
                    store_id, product_id, movement_type, quantity_delta,
                    reference_type, reference_id, occurred_at, created_at
                )
                VALUES (%s, %s, 'ORDER_RESERVE', %s, 'ORDER', %s, %s, %s)
                """,
                (
                    draft.store_id,
                    item.product_id,
                    -item.quantity,
                    str(order_id),
                    draft.placed_at,
                    draft.placed_at,
                ),
            )

        method = _draw_payment_method(rng, payment_methods)
        first_attempt_failed = method != "COD" and (
            rng.random() < behavior.payment_failure_probability(method, 1)
        )
        if first_attempt_failed:
            failure_code = FAILURE_CODES[int(rng.integers(0, len(FAILURE_CODES)))]
            cur.execute(
                """
                INSERT INTO payments (
                    order_id, payment_method, status, amount, currency,
                    attempt_number, failure_code, created_at, updated_at
                )
                VALUES (%s, %s, 'FAILED', %s, %s, 1, %s, %s, %s)
                RETURNING payment_id
                """,
                (
                    order_id,
                    method,
                    draft.total_amount,
                    INR,
                    failure_code,
                    draft.placed_at,
                    draft.placed_at,
                ),
            )
            failed_payment_id = int(cur.fetchone()[0])
            payment_events.append(
                _event(
                    "PAYMENT_FAILED",
                    order_id,
                    draft.store_id,
                    draft.placed_at,
                    {
                        "payment_id": failed_payment_id,
                        "order_id": order_id,
                        "method": method,
                        "attempt_number": 1,
                        "failure_code": failure_code,
                    },
                )
            )

        attempt_number = 2 if first_attempt_failed else 1
        captured_at = datetime.now(UTC)
        cur.execute(
            """
            INSERT INTO payments (
                order_id, payment_method, status, amount, currency,
                attempt_number, failure_code, created_at, updated_at
            )
            VALUES (%s, %s, 'CAPTURED', %s, %s, %s, NULL, %s, %s)
            RETURNING payment_id
            """,
            (
                order_id,
                method,
                draft.total_amount,
                INR,
                attempt_number,
                captured_at,
                captured_at,
            ),
        )
        captured_payment_id = int(cur.fetchone()[0])
        payment_events.append(
            _event(
                "PAYMENT_COMPLETED",
                order_id,
                draft.store_id,
                captured_at,
                {
                    "payment_id": captured_payment_id,
                    "order_id": order_id,
                    "amount": str(draft.total_amount),
                    "method": method,
                    "attempt_number": attempt_number,
                },
            )
        )

    order = CreatedOrder(
        order_id=order_id,
        customer_id=draft.customer_id,
        store_id=draft.store_id,
        address_id=draft.address_id,
        subtotal=draft.subtotal,
        tax_amount=draft.tax_amount,
        delivery_fee=draft.delivery_fee,
        total_amount=draft.total_amount,
        placed_at=draft.placed_at,
        items=draft.items,
    )
    for item in order.items:
        key = (order.store_id, item.product_id)
        reference.inventory[key] -= item.quantity

    _publish(
        producer,
        _event(
            "ORDER_PLACED",
            order.order_id,
            order.store_id,
            order.placed_at,
            {
                "order_id": order.order_id,
                "customer_id": order.customer_id,
                "store_id": order.store_id,
                "item_count": len(order.items),
                "subtotal": str(order.subtotal),
                "discount": "0.00",
                "total_amount": str(order.total_amount),
                "currency": INR,
            },
        ),
        order.order_id,
    )
    for event in payment_events:
        _publish(producer, event, order.order_id)
    producer.flush()
    log.info(
        "live_writer.order_created",
        order_id=order.order_id,
        store_id=order.store_id,
        items=len(order.items),
        total_amount=str(order.total_amount),
    )
    return order


def _set_order_status(
    conn: psycopg.Connection,
    order_id: int,
    *,
    expected: str,
    status: str,
    changed_at: datetime,
) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE orders SET status = %s, updated_at = %s
            WHERE order_id = %s AND status = %s
            """,
            (status, changed_at, order_id, expected),
        )
        if cur.rowcount != 1:
            raise RuntimeError(
                f"invalid order transition for {order_id}: expected {expected}, target {status}"
            )


def _cancel_order(
    conn: psycopg.Connection,
    order: CreatedOrder,
    *,
    rider_id: int | None,
    distance: Decimal,
    changed_at: datetime,
) -> None:
    promised_by = order.placed_at + timedelta(minutes=35)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE orders SET status = 'CANCELLED', updated_at = %s
            WHERE order_id = %s AND status = 'PACKED'
            """,
            (changed_at, order.order_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"order {order.order_id} was not PACKED before cancellation")
        cur.execute(
            """
            INSERT INTO deliveries (
                order_id, rider_id, promised_by, cancelled_at,
                estimated_distance_km, status, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, 'CANCELLED', %s, %s)
            """,
            (
                order.order_id,
                rider_id,
                promised_by,
                changed_at,
                distance,
                order.placed_at,
                changed_at,
            ),
        )
        for item in order.items:
            cur.execute(
                """
                UPDATE inventory
                SET on_hand_qty = on_hand_qty + %s, updated_at = %s
                WHERE store_id = %s AND product_id = %s
                """,
                (item.quantity, changed_at, order.store_id, item.product_id),
            )
            cur.execute(
                """
                INSERT INTO inventory_movements (
                    store_id, product_id, movement_type, quantity_delta,
                    reference_type, reference_id, occurred_at, created_at
                )
                VALUES (%s, %s, 'ORDER_RELEASE', %s, 'ORDER', %s, %s, %s)
                """,
                (
                    order.store_id,
                    item.product_id,
                    item.quantity,
                    str(order.order_id),
                    changed_at,
                    changed_at,
                ),
            )


def _dispatch_order(
    conn: psycopg.Connection,
    order: CreatedOrder,
    *,
    rider_id: int | None,
    distance: Decimal,
    changed_at: datetime,
) -> int:
    promised_by = order.placed_at + timedelta(minutes=35)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE orders SET status = 'OUT_FOR_DELIVERY', updated_at = %s
            WHERE order_id = %s AND status = 'PACKED'
            """,
            (changed_at, order.order_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"order {order.order_id} was not PACKED before dispatch")
        cur.execute(
            """
            INSERT INTO deliveries (
                order_id, rider_id, promised_by, assigned_at, picked_up_at,
                estimated_distance_km, status, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'PICKED_UP', %s, %s)
            RETURNING delivery_id
            """,
            (
                order.order_id,
                rider_id,
                promised_by,
                changed_at,
                changed_at,
                distance,
                order.placed_at,
                changed_at,
            ),
        )
        return int(cur.fetchone()[0])


def _deliver_order(
    conn: psycopg.Connection,
    order: CreatedOrder,
    *,
    delivery_id: int,
    changed_at: datetime,
) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE orders SET status = 'DELIVERED', updated_at = %s
            WHERE order_id = %s AND status = 'OUT_FOR_DELIVERY'
            """,
            (changed_at, order.order_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"order {order.order_id} was not OUT_FOR_DELIVERY")
        cur.execute(
            """
            UPDATE deliveries
            SET status = 'DELIVERED', delivered_at = %s, updated_at = %s
            WHERE delivery_id = %s AND status = 'PICKED_UP'
            """,
            (changed_at, changed_at, delivery_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError(f"delivery {delivery_id} was not PICKED_UP")
        for item in order.items:
            movement_values = (
                order.store_id,
                item.product_id,
                str(order.order_id),
                changed_at,
                changed_at,
            )
            cur.execute(
                """
                INSERT INTO inventory_movements (
                    store_id, product_id, movement_type, quantity_delta,
                    reference_type, reference_id, occurred_at, created_at
                )
                VALUES (%s, %s, 'ORDER_RELEASE', %s, 'ORDER', %s, %s, %s)
                """,
                (
                    order.store_id,
                    item.product_id,
                    item.quantity,
                    str(order.order_id),
                    changed_at,
                    changed_at,
                ),
            )
            cur.execute(
                """
                INSERT INTO inventory_movements (
                    store_id, product_id, movement_type, quantity_delta,
                    reference_type, reference_id, occurred_at, created_at
                )
                VALUES (%s, %s, 'SALE', %s, 'ORDER', %s, %s, %s)
                """,
                (*movement_values[:2], -item.quantity, *movement_values[2:]),
            )


async def transition_order(
    order: CreatedOrder,
    reference: ReferenceData,
    producer: EventProducer,
    rng: np.random.Generator,
    *,
    delays: TransitionDelays | None = None,
    cancellation_probability: float = DEFAULT_CANCELLATION_PROBABILITY,
    connect_factory: ConnectFactory = connect,
) -> tuple[str, ...]:
    """Advance one order asynchronously through a monotonic terminal lifecycle."""
    if not 0 <= cancellation_probability <= 1:
        raise ValueError("cancellation_probability must be between zero and one")
    delays = delays or TransitionDelays()

    statuses = ["PLACED"]
    await asyncio.sleep(delays.packed)
    packed_at = datetime.now(UTC)
    with connect_factory() as conn:
        _set_order_status(
            conn,
            order.order_id,
            expected="PLACED",
            status="PACKED",
            changed_at=packed_at,
        )
    statuses.append("PACKED")
    _publish(
        producer,
        _event(
            "ORDER_PACKED",
            order.order_id,
            order.store_id,
            packed_at,
            {"order_id": order.order_id},
        ),
        order.order_id,
    )

    riders = reference.riders_by_store.get(order.store_id, ())
    rider_id = int(riders[int(rng.integers(0, len(riders)))]) if riders else None
    distance = money(behavior.draw_distance_km(rng))
    if rng.random() < cancellation_probability:
        cancelled_at = datetime.now(UTC)
        with connect_factory() as conn:
            _cancel_order(
                conn,
                order,
                rider_id=rider_id,
                distance=distance,
                changed_at=cancelled_at,
            )
        for item in order.items:
            reference.inventory[(order.store_id, item.product_id)] += item.quantity
        statuses.append("CANCELLED")
        _publish(
            producer,
            _event(
                "ORDER_CANCELLED",
                order.order_id,
                order.store_id,
                cancelled_at,
                {"order_id": order.order_id},
            ),
            order.order_id,
        )
        producer.flush()
        return tuple(statuses)

    await asyncio.sleep(delays.dispatched)
    dispatched_at = datetime.now(UTC)
    with connect_factory() as conn:
        delivery_id = _dispatch_order(
            conn,
            order,
            rider_id=rider_id,
            distance=distance,
            changed_at=dispatched_at,
        )
    statuses.append("OUT_FOR_DELIVERY")
    _publish(
        producer,
        _event(
            "ORDER_OUT_FOR_DELIVERY",
            order.order_id,
            order.store_id,
            dispatched_at,
            {
                "order_id": order.order_id,
                "delivery_id": delivery_id,
                "rider_id": rider_id,
            },
        ),
        order.order_id,
    )

    await asyncio.sleep(delays.delivered)
    delivered_at = datetime.now(UTC)
    with connect_factory() as conn:
        _deliver_order(
            conn,
            order,
            delivery_id=delivery_id,
            changed_at=delivered_at,
        )
    statuses.append("DELIVERED")
    _publish(
        producer,
        _event(
            "ORDER_DELIVERED",
            order.order_id,
            order.store_id,
            delivered_at,
            {
                "order_id": order.order_id,
                "delivery_id": delivery_id,
                "rider_id": rider_id,
                "promised_by": (order.placed_at + timedelta(minutes=35)).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                ),
                "delivered_at": delivered_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
        ),
        order.order_id,
    )
    producer.flush()
    return tuple(statuses)


async def run_live(
    producer: EventProducer,
    *,
    rate_per_sec: float,
    burst: int | None,
    stop: asyncio.Event,
    connect_factory: ConnectFactory = connect,
    rng: np.random.Generator | None = None,
) -> int:
    """Create orders at the requested rate while lifecycle tasks run concurrently."""
    if rate_per_sec <= 0:
        raise ValueError("rate_per_sec must be positive")
    if burst is not None and burst <= 0:
        raise ValueError("burst must be positive")

    rng = rng or np.random.default_rng()
    with connect_factory() as conn:
        reference = load_reference_data(conn)
    delay = 1.0 / rate_per_sec
    created = 0
    transitions: set[asyncio.Task[tuple[str, ...]]] = set()

    while not stop.is_set() and (burst is None or created < burst):
        completed = {task for task in transitions if task.done()}
        for task in completed:
            task.result()
        transitions.difference_update(completed)
        with connect_factory() as conn:
            try:
                order = create_order(conn, reference, producer, rng)
            except StockUnavailable:
                log.warning("live_writer.stock_refresh")
                reference = load_reference_data(conn)
                continue
        transition_rng = np.random.default_rng(int(rng.integers(0, np.iinfo(np.int64).max)))
        task = asyncio.create_task(
            transition_order(order, reference, producer, transition_rng),
            name=f"order-{order.order_id}",
        )
        transitions.add(task)
        created += 1
        if burst is not None and created >= burst:
            break
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        except TimeoutError:
            continue

    if transitions:
        await asyncio.gather(*transitions)
    return created


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


async def _run_from_cli(bootstrap: str, rate: float, burst: int | None) -> int:
    producer = KafkaProducer(bootstrap_servers=bootstrap, acks="all")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for handled_signal in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(handled_signal, stop.set)
    try:
        created = await run_live(
            producer,
            rate_per_sec=rate,
            burst=burst,
            stop=stop,
        )
        log.info("live_writer.stopped", orders_created=created)
    finally:
        producer.flush()
        producer.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Continuously create live QuickCart orders in PostgreSQL and Redpanda"
    )
    parser.add_argument("--rate", type=_positive_float, default=2.0, help="orders per second")
    parser.add_argument("--burst", type=_positive_int, help="stop after N orders")
    parser.add_argument("--bootstrap", help="Kafka bootstrap servers")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level)
    bootstrap = args.bootstrap or settings.redpanda_bootstrap_servers
    return asyncio.run(_run_from_cli(bootstrap, args.rate, args.burst))


if __name__ == "__main__":
    raise SystemExit(main())
