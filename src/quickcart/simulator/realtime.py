"""Realtime simulator producer (kit/03 §7.3): publishes live order-lifecycle
events to Redpanda using the kit/04 §4 envelope.

Event IDs are `uuid5` over (order, event type) — stable across producer
retries, so replays never double-count downstream (kit/02 DR-003).

Run: ``uv run python -m quickcart.simulator.realtime --rate 2 --orders 50``
"""

import argparse
import json
import signal
import time
import uuid
from datetime import UTC, datetime, timedelta

import structlog
from kafka import KafkaProducer

from quickcart.config.settings import get_settings
from quickcart.logging import configure_logging

log = structlog.get_logger(__name__)

TOPIC = "quickcart.order-events.v1"
EVENT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "quickcart.dev")


def _event(
    event_type: str, entity_id: int, store_id: int, event_time: datetime, payload: dict
) -> dict:
    return {
        "event_id": str(uuid.uuid5(EVENT_NAMESPACE, f"live:{entity_id}:{event_type}")),
        "event_type": event_type,
        "schema_version": 1,
        "event_time": event_time.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "producer": "quickcart-simulator",
        "entity_type": "order",
        "entity_id": str(entity_id),
        "store_id": store_id,
        "payload": payload,
    }


def produce_orders(
    producer: KafkaProducer,
    *,
    rate_per_sec: float,
    orders: int,
    base_order_id: int = 900_000_000,
    store_ids: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
    topic: str = TOPIC,
) -> int:
    """Emit ORDER_PLACED → PAYMENT_COMPLETED → ORDER_DELIVERED per order."""
    published = 0
    delay = 1.0 / max(rate_per_sec, 0.1)
    for i in range(orders):
        order_id = base_order_id + i
        store_id = store_ids[i % len(store_ids)]
        placed = datetime.now(UTC)
        # Realtime events are stamped at emission time: the lifecycle offsets
        # belong to the historical simulator, not the live stream — future
        # timestamps would make every other event in the batch look "late"
        # under the watermark policy.
        events = [
            _event(
                "ORDER_PLACED",
                order_id,
                store_id,
                placed,
                {
                    "order_id": order_id,
                    "customer_id": 1 + (order_id % 20_000),
                    "store_id": store_id,
                    "item_count": 1 + (order_id % 6),
                    "subtotal": "250.00",
                    "discount": "0.00",
                    "total_amount": "262.50",
                    "currency": "INR",
                },
            ),
            _event(
                "PAYMENT_COMPLETED",
                order_id,
                store_id,
                datetime.now(UTC),
                {
                    "payment_id": order_id,
                    "order_id": order_id,
                    "amount": "262.50",
                    "method": "UPI",
                    "attempt_number": 1,
                },
            ),
            _event(
                "ORDER_DELIVERED",
                order_id,
                store_id,
                datetime.now(UTC),
                {
                    "order_id": order_id,
                    "delivery_id": order_id,
                    "rider_id": 1 + (order_id % 100),
                    "promised_by": (placed + timedelta(minutes=35)).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    ),
                    "delivered_at": (placed + timedelta(minutes=32)).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    ),
                },
            ),
        ]
        for event in events:
            producer.send(topic, key=str(order_id).encode(), value=json.dumps(event).encode())
            published += 1
        producer.flush()
        log.info("live.order_published", order_id=order_id, store_id=store_id, events=len(events))
        time.sleep(delay)
    return published


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish live QuickCart order events")
    parser.add_argument("--rate", type=float, default=2.0, help="orders per second")
    parser.add_argument("--orders", type=int, default=50, help="total orders to publish")
    parser.add_argument("--bootstrap", type=str, default=None)
    args = parser.parse_args(argv)
    settings = get_settings()
    configure_logging(settings.log_level)
    bootstrap = args.bootstrap or settings.redpanda_bootstrap_servers

    producer = KafkaProducer(bootstrap_servers=bootstrap, acks="all")
    stopping = False

    def _stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    try:
        published = produce_orders(producer, rate_per_sec=args.rate, orders=args.orders)
        log.info("live.complete", published=published)
    finally:
        producer.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
