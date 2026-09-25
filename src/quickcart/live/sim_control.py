"""Bounded demo control surface for the live order simulator.

This module persists a small, human-editable JSON document (``sim_control.json``
under ``settings.data_root``) describing whether the simulator should be
running and at what intensity. It is intentionally the *only* way the API and
the simulator agree on shared state: no queues, no arbitrary SQL, no shell
commands — just a JSON file the ops team (or the console) can toggle.

The live writer polls :func:`load_control` every couple of seconds so an
operator can start/stop the demo or turn a dial without restarting any
process.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from quickcart.config.settings import get_settings

_LOCK = threading.Lock()


class SimControlState(BaseModel):
    """The full set of knobs an operator can adjust for the demo simulator."""

    running: bool = True
    orders_per_minute: float = Field(default=120.0, gt=0)
    cancel_rate: float = Field(default=0.05, ge=0, le=1)
    payment_fail_rate: float = Field(default=0.03, ge=0, le=1)
    inventory_churn: float = Field(default=0.1, ge=0, le=1)
    rider_ping_hz: float = Field(default=1.0, gt=0)
    ticket_rate: float = Field(default=0.02, ge=0, le=1)
    burst_factor: float = Field(default=1.0, gt=0)


_PATCHABLE_FIELDS = tuple(SimControlState.model_fields)


def control_path(data_root: Path | None = None) -> Path:
    """Return the path to the control file, defaulting to ``settings.data_root``."""
    root = data_root if data_root is not None else get_settings().data_root
    return Path(root) / "sim_control.json"


def load_control(data_root: Path | None = None) -> SimControlState:
    """Read the persisted control state, falling back to defaults.

    A missing file, unreadable file, or invalid JSON all resolve to the
    documented defaults rather than raising — the simulator must never crash
    because the demo control file is momentarily absent or being written.
    """
    path = control_path(data_root)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return SimControlState()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return SimControlState()
    try:
        return SimControlState.model_validate(payload)
    except ValueError:
        return SimControlState()


def save_control(state: SimControlState, data_root: Path | None = None) -> SimControlState:
    """Persist ``state`` atomically (write to a temp file, then rename)."""
    path = control_path(data_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = state.model_dump_json(indent=2)
    with _LOCK:
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(payload, encoding="utf-8")
        tmp_path.replace(path)
    return state


def patch_control(data_root: Path | None = None, **fields: Any) -> SimControlState:
    """Load, apply only the given (non-``None``) fields, and persist the result."""
    unknown = set(fields) - set(_PATCHABLE_FIELDS)
    if unknown:
        raise ValueError(f"unknown sim control field(s): {sorted(unknown)}")
    current = load_control(data_root)
    updates = {key: value for key, value in fields.items() if value is not None}
    updated = current.model_copy(update=updates)
    return save_control(updated, data_root)


def start(data_root: Path | None = None) -> SimControlState:
    """Set ``running=True`` and persist."""
    return patch_control(data_root, running=True)


def stop(data_root: Path | None = None) -> SimControlState:
    """Set ``running=False`` and persist."""
    return patch_control(data_root, running=False)


__all__ = [
    "SimControlState",
    "control_path",
    "load_control",
    "patch_control",
    "save_control",
    "start",
    "stop",
]
