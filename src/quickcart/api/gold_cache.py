"""Short-lived cache for expensive :class:`GoldReaders` operations.

``GoldReadersTTLCache`` is a small proxy owned by the API process.  Call
``cache.call("method_name", *args, **kwargs)`` for any expensive reader
method, or use ``cache.kpi_summary()`` for the common overview query. Values
are cached for 30 seconds by default and can be cleared with ``invalidate``.

``warmup_gold_cache(readers)`` returns the per-reader proxy after eagerly
loading ``kpi_summary``. Integrators should retain or use the returned proxy;
subsequent calls with the same reader reuse it.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Hashable
from dataclasses import dataclass
from typing import Any

DEFAULT_TTL_SECONDS = 30.0
_CACHE_ATTRIBUTE = "_quickcart_gold_ttl_cache"


@dataclass(frozen=True)
class _Entry:
    expires_at: float
    value: Any


def _hashable(value: Any) -> Hashable:
    """Return a stable-enough cache-key representation for reader arguments."""
    try:
        hash(value)
    except TypeError:
        if isinstance(value, dict):
            return tuple(sorted((str(key), _hashable(item)) for key, item in value.items()))
        if isinstance(value, (list, tuple)):
            return tuple(_hashable(item) for item in value)
        if isinstance(value, set):
            return tuple(sorted((_hashable(item) for item in value), key=repr))
        return repr(value)
    return value


class GoldReadersTTLCache:
    """Thread-safe 30-second memoization wrapper around one Gold reader.

    The cache stores method return values, so it is most useful for methods
    that materialize results (for example ``kpi_summary``). Caching a Spark
    DataFrame only reuses its query plan and does not materialize its rows.
    """

    def __init__(
        self,
        readers: Any,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self.readers = readers
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._entries: dict[Hashable, _Entry] = {}
        self._lock = threading.RLock()

    def call(self, method_name: str, /, *args: Any, **kwargs: Any) -> Any:
        """Call and cache a named reader method for this proxy's TTL."""
        method = getattr(self.readers, method_name)
        if not callable(method):
            raise AttributeError(f"{method_name!r} is not a callable reader method")
        key = (
            method_name,
            tuple(_hashable(arg) for arg in args),
            tuple(sorted((name, _hashable(value)) for name, value in kwargs.items())),
        )
        with self._lock:
            now = self._clock()
            entry = self._entries.get(key)
            if entry is not None and entry.expires_at > now:
                return entry.value
            value = method(*args, **kwargs)
            self._entries[key] = _Entry(expires_at=now + self.ttl_seconds, value=value)
            return value

    def kpi_summary(self) -> dict[str, Any]:
        """Return the cached Gold overview KPIs."""
        return self.call("kpi_summary")

    def invalidate(self) -> None:
        """Drop every cached value for this reader."""
        with self._lock:
            self._entries.clear()


def gold_cache_for(readers: Any) -> GoldReadersTTLCache:
    """Return the process-local cache proxy associated with ``readers``."""
    cache = getattr(readers, _CACHE_ATTRIBUTE, None)
    if isinstance(cache, GoldReadersTTLCache):
        return cache
    cache = GoldReadersTTLCache(readers)
    setattr(readers, _CACHE_ATTRIBUTE, cache)
    return cache


def warmup_gold_cache(readers: Any) -> GoldReadersTTLCache:
    """Warm the KPI entry and return the reusable cache proxy.

    Startup integration can call ``app.state.gold_cache =
    warmup_gold_cache(readers)``. A missing Gold table is intentionally not
    swallowed, allowing startup policy to decide whether that is fatal.
    """
    cache = gold_cache_for(readers)
    cache.kpi_summary()
    return cache
