"""Simulator configuration (kit/02 FR-002, kit/03 §1.4).

A Pydantic model with a YAML overlay and CLI overrides. The same config drives
the reference seeder, the historical simulator, and (later) the realtime
producer, so every dataset is reproducible from seed + config.
"""

import argparse
from datetime import date
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class SimulatorConfig(BaseModel):
    seed: int = 42
    stores: int = 10
    products: int = 2000
    customers: int = 20_000
    riders: int = 100
    start_date: date = date(2026, 3, 1)
    end_date: date = date(2026, 9, 22)
    orders: int = 100_000
    # Used by the Phase 7 realtime producer; recorded here so one config
    # describes the whole simulation surface.
    event_rate_per_sec: float = 2.0
    # Phase 5 hooks: opt-in, seeded bad-data scenarios (kit/04 §12). No-ops today.
    anomaly_scenarios: list[str] = Field(default_factory=list)

    @classmethod
    def from_yaml(cls, path: Path) -> "SimulatorConfig":
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return cls.model_validate(data)

    def smoke(self) -> "SimulatorConfig":
        """Tiny deterministic dataset for fast integration checks."""
        return self.model_copy(
            update={
                "stores": 2,
                "products": 120,
                "customers": 300,
                "riders": 12,
                "orders": 500,
            }
        )


def add_config_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", type=Path, default=None, help="YAML config overlay")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--orders", type=int, default=None)
    parser.add_argument("--stores", type=int, default=None)
    parser.add_argument("--products", type=int, default=None)
    parser.add_argument("--customers", type=int, default=None)
    parser.add_argument("--riders", type=int, default=None)
    parser.add_argument("--start-date", type=date.fromisoformat, default=None)
    parser.add_argument("--end-date", type=date.fromisoformat, default=None)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Tiny deterministic scale for quick integration checks",
    )


def resolve_config(args: argparse.Namespace) -> SimulatorConfig:
    config = SimulatorConfig.from_yaml(args.config) if args.config else SimulatorConfig()
    overrides = {
        key: value
        for key, value in {
            "seed": args.seed,
            "orders": args.orders,
            "stores": args.stores,
            "products": args.products,
            "customers": args.customers,
            "riders": args.riders,
            "start_date": args.start_date,
            "end_date": args.end_date,
        }.items()
        if value is not None
    }
    config = config.model_copy(update=overrides) if overrides else config
    return config.smoke() if args.smoke else config
