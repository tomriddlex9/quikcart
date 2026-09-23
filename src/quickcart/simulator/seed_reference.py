"""`uv run python -m quickcart.simulator.seed_reference` — load reference data.

Deterministic for a given seed: re-running replaces all reference data
(destructive truncate) with the identical dataset.
"""

import argparse

import structlog

from quickcart.config.settings import get_settings
from quickcart.db.connection import connect
from quickcart.db.fingerprints import reference_fingerprint
from quickcart.db.load import db_reference_fingerprint, load_reference, truncate_all_tables
from quickcart.logging import configure_logging
from quickcart.simulator.config import add_config_args, resolve_config
from quickcart.simulator.generator import generate_reference

log = structlog.get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed deterministic reference data")
    add_config_args(parser)
    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)

    cfg = resolve_config(args)
    ref = generate_reference(cfg)
    with connect() as conn:
        with conn.transaction(), conn.cursor() as cur:
            truncate_all_tables(cur)
            load_reference(cur, ref)
        fingerprint = db_reference_fingerprint(conn)

    expected = reference_fingerprint(ref)
    if fingerprint != expected:
        log.error("reference.fingerprint_mismatch")
        return 1
    log.info(
        "reference.seeded",
        seed=cfg.seed,
        stores=len(ref.stores),
        products=len(ref.products),
        customers=len(ref.customers),
        riders=len(ref.riders),
        promotions=len(ref.promotions),
        fingerprint=fingerprint[:16],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
