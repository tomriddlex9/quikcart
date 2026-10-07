"""Measure local latency of ``GET /api/v1/b/today`` (Phase B2 p95 target < 150 ms).

Usage (API must be running)::

    uv run python -m quickcart.business.bench_today
    uv run python -m quickcart.business.bench_today --url http://127.0.0.1:8000 --n 50
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
import urllib.error
import urllib.request


def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return float("nan")
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (pct / 100.0) * (len(sorted_vals) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_vals) - 1)
    frac = rank - low
    return sorted_vals[low] * (1 - frac) + sorted_vals[high] * frac


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--n", type=int, default=40, help="Number of timed requests")
    parser.add_argument("--warmup", type=int, default=5, help="Untimed warmup requests")
    args = parser.parse_args(argv)
    endpoint = f"{args.url.rstrip('/')}/api/v1/b/today"

    def once() -> tuple[int, float]:
        started = time.perf_counter()
        with urllib.request.urlopen(endpoint, timeout=10) as resp:
            status = resp.getcode()
            resp.read()
        return status, (time.perf_counter() - started) * 1000.0

    try:
        for _ in range(args.warmup):
            once()
    except urllib.error.URLError as exc:
        print(f"API not reachable at {endpoint}: {exc}", file=sys.stderr)
        return 2

    samples: list[float] = []
    for _ in range(args.n):
        status, ms = once()
        if status != 200:
            print(f"non-200 status {status}", file=sys.stderr)
            return 3
        samples.append(ms)

    samples.sort()
    p50 = _percentile(samples, 50)
    p95 = _percentile(samples, 95)
    mean = statistics.fmean(samples)
    print(f"endpoint={endpoint}")
    print(f"n={args.n} warmup={args.warmup}")
    print(f"mean_ms={mean:.1f} p50_ms={p50:.1f} p95_ms={p95:.1f} max_ms={samples[-1]:.1f}")
    print(f"target_p95_ms=150 pass={p95 < 150}")
    return 0 if p95 < 150 else 1


if __name__ == "__main__":
    raise SystemExit(main())
