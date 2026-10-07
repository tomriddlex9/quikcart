"""Load the semantic metric registry and apply it (status, display, explanation).

Everything the business console says about a number — its label, how it is
formatted, whether it is good/watch/bad, and the sentence explaining it — comes
from ``metrics.yaml`` through this module, so the snapshot job, the API, and
future agents never disagree on a definition.

Percent metrics are stored as 0..1 fractions; ``format_display`` multiplies by
100. ``delta_pct`` everywhere in this module is the *relative* change versus
the baseline, in percent.
"""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, model_validator

Number = float | int | Decimal
Status = Literal["good", "watch", "bad", "unknown"]
Unit = Literal["inr", "pct", "count", "minutes"]
Direction = Literal["higher_better", "lower_better"]

REGISTRY_PATH = Path(__file__).with_name("metrics.yaml")
FLAT_DELTA_PCT = 1.0  # |relative change| below this reads as "about the same"
COMPARE_LABELS: dict[str, str] = {
    "same_day_last_week": "the same day last week",
    "previous_day": "yesterday",
}
_STATUS_RANK: dict[Status, int] = {"unknown": 0, "good": 1, "watch": 2, "bad": 3}


class Thresholds(BaseModel):
    """Absolute limits (stored unit) and/or adverse relative-change limits (%)."""

    watch: float | None = None
    bad: float | None = None
    relative_watch: float | None = None
    relative_bad: float | None = None


class Explainers(BaseModel):
    up: str
    down: str
    flat: str


class MetricDef(BaseModel):
    key: str
    label: str
    plain_description: str
    formula_text: str
    unit: Unit
    gold_source: str
    direction: Direction
    thresholds: Thresholds = Field(default_factory=Thresholds)
    explainers: Explainers
    synonyms: list[str] = Field(default_factory=list)
    compare_default: str = "same_day_last_week"
    status: Literal["ready", "partial"] = "ready"
    partial_note: str | None = None

    @model_validator(mode="after")
    def _partial_needs_note(self) -> MetricDef:
        if self.status == "partial" and not self.partial_note:
            raise ValueError(f"metric {self.key!r} is partial but has no partial_note")
        return self

    @property
    def compare_label(self) -> str:
        return COMPARE_LABELS.get(self.compare_default, self.compare_default.replace("_", " "))


@lru_cache(maxsize=1)
def _load() -> dict[str, MetricDef]:
    raw: dict[str, Any] = yaml.safe_load(REGISTRY_PATH.read_text(encoding="utf-8"))
    metrics: dict[str, MetricDef] = {}
    for entry in raw["metrics"]:
        metric = MetricDef.model_validate(entry)
        if metric.key in metrics:
            raise ValueError(f"duplicate metric key {metric.key!r} in {REGISTRY_PATH.name}")
        metrics[metric.key] = metric
    return metrics


def list_metrics() -> list[MetricDef]:
    """All metrics in registry (file) order."""
    return list(_load().values())


def get_metric(key: str) -> MetricDef:
    """Look up one metric; raises ``KeyError`` for unknown keys."""
    try:
        return _load()[key]
    except KeyError:
        raise KeyError(f"unknown metric {key!r}") from None


def find_metric(term: str) -> MetricDef | None:
    """Resolve a key, label, or synonym (case-insensitive) to a metric."""
    needle = term.strip().lower()
    for metric in _load().values():
        if needle in {metric.key, metric.label.lower(), *(s.lower() for s in metric.synonyms)}:
            return metric
    return None


# --- numbers -------------------------------------------------------------------------


def delta_pct(value: Number | None, baseline: Number | None) -> float | None:
    """Relative change versus baseline in percent; ``None`` when not computable."""
    if value is None or baseline is None or baseline == 0:
        return None
    return (float(value) - float(baseline)) / abs(float(baseline)) * 100.0


def _adverse_change_pct(metric: MetricDef, value: float, baseline: float) -> float | None:
    change = delta_pct(value, baseline)
    if change is None:
        return None
    return -change if metric.direction == "higher_better" else change


def _absolute_status(metric: MetricDef, value: float) -> Status | None:
    watch, bad = metric.thresholds.watch, metric.thresholds.bad
    if watch is None and bad is None:
        return None
    if metric.direction == "higher_better":
        if bad is not None and value <= bad:
            return "bad"
        if watch is not None and value <= watch:
            return "watch"
    else:
        if bad is not None and value >= bad:
            return "bad"
        if watch is not None and value >= watch:
            return "watch"
    return "good"


def _relative_status(metric: MetricDef, value: float, baseline: float | None) -> Status | None:
    watch, bad = metric.thresholds.relative_watch, metric.thresholds.relative_bad
    if watch is None and bad is None:
        return None
    if baseline is None:
        return None
    adverse = _adverse_change_pct(metric, value, baseline)
    if adverse is None:
        return None
    if bad is not None and adverse >= bad:
        return "bad"
    if watch is not None and adverse >= watch:
        return "watch"
    return "good"


def status_for(value: Number | None, metric: MetricDef, baseline: Number | None = None) -> Status:
    """good / watch / bad / unknown for a value, worst of the configured checks.

    ``unknown`` when there is no value, or when the metric only has relative
    thresholds and no usable baseline.
    """
    if value is None:
        return "unknown"
    value = float(value)
    baseline = None if baseline is None else float(baseline)
    checks = [
        _absolute_status(metric, value),
        _relative_status(metric, value, baseline),
    ]
    known = [check for check in checks if check is not None]
    if not known:
        return "unknown"
    return max(known, key=lambda s: _STATUS_RANK[s])


# --- formatting ----------------------------------------------------------------------


def _indian_group(whole: int) -> str:
    sign = "-" if whole < 0 else ""
    digits = str(abs(whole))
    if len(digits) <= 3:
        return sign + digits
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return f"{sign}{','.join([*groups, tail])}"


def format_inr(value: Number) -> str:
    """Rupees, Indian style: ₹4,350 / ₹12,350 up to a lakh, then ₹1.25 L and ₹2.30 Cr."""
    value = float(value)
    magnitude = abs(value)
    sign = "-" if value < 0 else ""
    if magnitude >= 1e7:
        return f"{sign}₹{magnitude / 1e7:.2f} Cr"
    if magnitude >= 1e5:
        return f"{sign}₹{magnitude / 1e5:.2f} L"
    return f"{sign}₹{_indian_group(round(magnitude))}"


def format_display(value: Number | None, unit: str) -> str:
    """Plain-language display string; an em dash when there is no value."""
    if value is None:
        return "—"
    value = float(value)
    if unit == "inr":
        return format_inr(value)
    if unit == "pct":
        return f"{value * 100:.1f}%"
    if unit == "minutes":
        return f"{value:.1f} min"
    if unit == "count":
        return _indian_group(round(value))
    raise ValueError(f"unknown unit {unit!r}")


def render_explanation(
    metric: MetricDef,
    value: Number | None,
    delta: float | None,
    *,
    baseline_label: str | None = None,
) -> str:
    """One plain sentence saying what the number is and how it moved."""
    if value is None:
        return f"No {metric.label.lower()} figure is available yet."
    shown = format_display(value, metric.unit)
    if delta is None:
        return f"{metric.label} is {shown}."
    template = metric.explainers.flat
    if delta >= FLAT_DELTA_PCT:
        template = metric.explainers.up
    elif delta <= -FLAT_DELTA_PCT:
        template = metric.explainers.down
    return template.format(
        label=metric.label,
        value=shown,
        delta_pct=f"{abs(delta):.1f}",
        baseline_label=baseline_label or metric.compare_label,
    )
