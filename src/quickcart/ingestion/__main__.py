"""Batch export of PostgreSQL tables to local raw files.

Run: ``uv run python -m quickcart.ingestion.export`` (also: ``make export-raw``).
"""

from pathlib import Path

from quickcart.ingestion.export import export_all


def main() -> int:
    paths: list[Path] = export_all()
    for path in paths:
        size_kb = path.stat().st_size / 1024
        print(f"{path}  ({size_kb:.0f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
