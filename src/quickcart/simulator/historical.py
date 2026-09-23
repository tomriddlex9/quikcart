"""`uv run python -m quickcart.simulator.historical` — generate + load order history.

Requires reference data seeded with the same config/seed (we fingerprint-check
the database before loading). Reruns replace the transactional tables with the
identical deterministic dataset.
"""

import argparse
import time

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.db.fingerprints import reference_fingerprint
from quickcart.db.load import db_reference_fingerprint, load_history
from quickcart.logging import configure_logging
from quickcart.simulator.config import SimulatorConfig, add_config_args, resolve_config
from quickcart.simulator.generator import generate_history

log = structlog.get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate and load historical orders")
    add_config_args(parser)
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)

    cfg: SimulatorConfig = resolve_config(args)
    started = time.perf_counter()
    history = generate_history(cfg)
    generated_in = time.perf_counter() - started

    with connect() as conn:
        db_fingerprint = db_reference_fingerprint(conn)
        if db_fingerprint != reference_fingerprint(history.reference):
            log.error(
                "reference.mismatch",
                detail="run `quickcart.simulator.seed_reference` with the same seed/config first",
            )
            return 1
        with conn.transaction(), conn.cursor() as cur:
            load_history(cur, history)

    loaded_in = time.perf_counter() - started - generated_in
    log.info(
        "history.loaded",
        seed=cfg.seed,
        orders=len(history.orders),
        order_items=len(history.order_items),
        payments=len(history.payments),
        deliveries=len(history.deliveries),
        movements=len(history.movements),
        tickets=len(history.tickets),
        generated_in_s=round(generated_in, 2),
        loaded_in_s=round(loaded_in, 2),
        fingerprint=history.fingerprint[:16],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
