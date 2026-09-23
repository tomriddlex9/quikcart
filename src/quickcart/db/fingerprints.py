"""Reference-data generator fingerprint guard helpers."""

import hashlib
import json

from quickcart.simulator.generator import ReferenceData


def reference_fingerprint(ref: ReferenceData) -> str:
    row_sets = [
        ("stores", ref.stores),
        ("customers", ref.customers),
        ("customer_addresses", ref.addresses),
        ("products", ref.products),
        ("product_prices", ref.prices),
        ("riders", ref.riders),
        ("promotions", ref.promotions),
    ]
    return canonical_row_fingerprint(row_sets)


def canonical_row_fingerprint(row_sets: list[tuple[str, list[tuple]]]) -> str:
    """Hash rows in a tzinfo/Decimal-repr-agnostic canonical form.

    `json.dumps(..., default=str)` renders datetimes with their UTC offset
    (identical for `datetime.timezone.utc` and `zoneinfo.ZoneInfo('Etc/UTC')`)
    and Decimals by value — exactly what a determinism guard should compare.
    """
    payload = {name: json.dumps(rows, default=str) for name, rows in row_sets}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
