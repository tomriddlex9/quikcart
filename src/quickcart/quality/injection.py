"""Failure injection (kit/03 §5.1, kit/04 §12).

Opt-in, seeded bad-data scenarios over exported raw CSV files. Each scenario
mutates one exported file so the full Bronze→Silver path can be tested
against realistic defects — quarantine must catch them (never silently
drop), and dedup must remove duplicates exactly once.
"""

import csv
import shutil
from collections.abc import Callable
from pathlib import Path

import numpy as np

TARGET_ROWS = 5


def _pick(rng: np.random.Generator, rows: list[int], n: int) -> list[int]:
    n = min(n, len(rows))
    return [int(i) for i in rng.choice(rows, size=n, replace=False)]


def _duplicate_order_event(file: Path, rng: np.random.Generator) -> None:
    rows = list(csv.reader(file.open(newline="", encoding="utf-8")))
    header, body = rows[0], rows[1:]
    idx = _pick(rng, list(range(len(body))), TARGET_ROWS)
    for i in idx:
        body.append(body[i])  # exact duplicate business keys
    _write(file, [header, *body])


def _late_delivery_event(file: Path, rng: np.random.Generator) -> None:
    _mutate_dict_rows(
        file, rng, lambda row: row.update(delivered_at="2020-01-01 00:00:00")
    )


def _out_of_order_status_event(file: Path, rng: np.random.Generator) -> None:
    def swap(row: dict[str, str]) -> None:
        row["assigned_at"], row["picked_up_at"] = row["picked_up_at"], row["assigned_at"]

    _mutate_dict_rows(file, rng, swap)


def _missing_customer_reference(file: Path, rng: np.random.Generator) -> None:
    _mutate_dict_rows(file, rng, lambda row: row.update(customer_id=""))


def _unknown_product_reference(file: Path, rng: np.random.Generator) -> None:
    _mutate_dict_rows(file, rng, lambda row: row.update(product_id="999999999"))


def _negative_payment_amount(file: Path, rng: np.random.Generator) -> None:
    _mutate_dict_rows(file, rng, lambda row: row.update(amount="-25.00"))


def _malformed_timestamp(file: Path, rng: np.random.Generator) -> None:
    _mutate_dict_rows(file, rng, lambda row: row.update(placed_at="not-a-timestamp"))


def _new_optional_schema_field(file: Path, rng: np.random.Generator) -> None:
    rows = list(csv.DictReader(file.open(newline="", encoding="utf-8")))
    if not rows:
        return
    for row in rows:
        row["loyalty_points"] = "0"
    _write_dicts(file, rows, list(rows[0].keys()))


def _duplicate_payment_cdc(file: Path, rng: np.random.Generator) -> None:
    rows = list(csv.reader(file.open(newline="", encoding="utf-8")))
    header, body = rows[0], rows[1:]
    idx = _pick(rng, list(range(len(body))), TARGET_ROWS)
    for i in idx:
        body.append(body[i])
    _write(file, [header, *body])


def _inventory_negative_discrepancy(file: Path, rng: np.random.Generator) -> None:
    _mutate_dict_rows(file, rng, lambda row: row.update(on_hand_qty="-5"))


def _mutate_dict_rows(file: Path, rng: np.random.Generator, mutate: Callable) -> None:
    rows = list(csv.DictReader(file.open(newline="", encoding="utf-8")))
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    for i in _pick(rng, list(range(len(rows))), TARGET_ROWS):
        mutate(rows[i])
    _write_dicts(file, rows, fieldnames)


def _write(file: Path, rows: list[list[str]]) -> None:
    with file.open("w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)


def _write_dicts(file: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with file.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


SCENARIOS: dict[str, tuple[str, Callable[[Path, np.random.Generator], None]]] = {
    "duplicate_order_event": ("orders", _duplicate_order_event),
    "late_delivery_event": ("deliveries", _late_delivery_event),
    "out_of_order_status_event": ("deliveries", _out_of_order_status_event),
    "missing_customer_reference": ("orders", _missing_customer_reference),
    "unknown_product_reference": ("order_items", _unknown_product_reference),
    "negative_payment_amount": ("payments", _negative_payment_amount),
    "malformed_timestamp": ("orders", _malformed_timestamp),
    "new_optional_schema_field": ("orders", _new_optional_schema_field),
    "duplicate_payment_cdc": ("payments", _duplicate_payment_cdc),
    "inventory_negative_discrepancy": ("inventory", _inventory_negative_discrepancy),
}


def inject_defects(
    raw_dir: Path, out_dir: Path, scenarios: list[str], seed: int = 42
) -> dict[str, int]:
    """Copy the raw export tree and apply the requested scenarios.

    Returns per-scenario mutated-row counts for assertions.
    """
    if not scenarios:
        raise ValueError("at least one scenario is required")
    rng = np.random.default_rng(seed)
    shutil.copytree(raw_dir, out_dir, dirs_exist_ok=True)
    applied: dict[str, int] = {}
    for scenario in scenarios:
        if scenario not in SCENARIOS:
            raise KeyError(f"unknown scenario {scenario!r}; choices: {sorted(SCENARIOS)}")
        entity, mutate = SCENARIOS[scenario]
        candidates = sorted(out_dir.rglob(f"{entity}.csv"))
        if not candidates:
            raise FileNotFoundError(f"no {entity}.csv under {out_dir}")
        before_rows = sum(1 for _ in candidates[0].open(encoding="utf-8")) - 1
        mutate(candidates[0], rng)
        after_rows = sum(1 for _ in candidates[0].open(encoding="utf-8")) - 1
        added_rows = after_rows - before_rows
        applied[scenario] = added_rows if added_rows > 0 else TARGET_ROWS
    return applied
