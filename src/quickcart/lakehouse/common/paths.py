"""Lakehouse storage locations (kit/06 §8/§9).

Local filesystem today; the ``storage_backend`` switch to S3-compatible
storage arrives in Phase 6. Transformation code only ever sees table paths.
"""

from pathlib import Path

from quickcart.config.settings import get_settings

LAYERS = ("bronze", "silver", "gold", "quarantine")


def data_root(root: Path | None = None) -> Path:
    return root or get_settings().data_root


def table_path(layer: str, table: str, root: Path | None = None) -> Path:
    if layer not in LAYERS:
        raise ValueError(f"unknown layer {layer!r}; expected one of {LAYERS}")
    return data_root(root) / layer / table


def latest_raw_partition(root: Path | None, entity: str) -> Path:
    base = data_root(root) / "raw" / entity
    partitions = sorted(base.glob("load_date=*"))
    if not partitions:
        raise FileNotFoundError(f"no exported partition for {entity!r}; run `make export-raw`")
    return partitions[-1]
