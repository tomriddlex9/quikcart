"""Semantic registry: definitions, status rules, display formatting, explanations."""

from decimal import Decimal

import pytest

from quickcart.semantics import (
    format_display,
    format_inr,
    get_metric,
    list_metrics,
    render_explanation,
    status_for,
)
from quickcart.semantics.registry import delta_pct, find_metric

REQUIRED_KEYS = {
    "sales_gmv",
    "orders",
    "average_basket",
    "cancel_rate",
    "on_time_rate",
    "late_rate",
    "avg_delivery_minutes",
    "payment_failure_rate",
    "availability_bestsellers",
    "stockout_risk_count",
    "active_customers",
    "repeat_rate",
}


def test_registry_contains_all_required_metrics() -> None:
    assert {m.key for m in list_metrics()} >= REQUIRED_KEYS


def test_every_metric_is_fully_defined() -> None:
    for metric in list_metrics():
        assert metric.label and metric.plain_description and metric.formula_text, metric.key
        assert metric.unit in {"inr", "pct", "count", "minutes"}
        assert metric.direction in {"higher_better", "lower_better"}
        assert metric.gold_source
        assert metric.synonyms, f"{metric.key} has no synonyms"
        assert metric.compare_default == "same_day_last_week"
        assert metric.explainers.up and metric.explainers.down and metric.explainers.flat
        thresholds = metric.thresholds
        assert thresholds.watch is not None or thresholds.relative_watch is not None, (
            f"{metric.key} has no watch threshold"
        )


def test_sales_label_is_plain_language() -> None:
    assert get_metric("sales_gmv").label == "Sales"


def test_on_time_rate_is_defined_from_late_rate() -> None:
    on_time = get_metric("on_time_rate")
    assert "1 minus the late rate" in on_time.formula_text
    assert "delivered" in on_time.formula_text
    assert "late_rate" in on_time.gold_source


def test_thresholds_are_ordered_in_the_adverse_direction() -> None:
    for metric in list_metrics():
        t = metric.thresholds
        if t.watch is not None and t.bad is not None:
            if metric.direction == "lower_better":
                assert t.watch < t.bad, metric.key
            else:
                assert t.watch > t.bad, metric.key
        if t.relative_watch is not None and t.relative_bad is not None:
            assert t.relative_watch < t.relative_bad, metric.key


def test_partial_metrics_explain_why() -> None:
    partial = [m for m in list_metrics() if m.status == "partial"]
    assert {m.key for m in partial} >= {"repeat_rate"}
    assert all(m.partial_note for m in partial)


def test_get_metric_unknown_key_raises() -> None:
    with pytest.raises(KeyError, match="nope"):
        get_metric("nope")


def test_find_metric_resolves_synonyms_and_labels() -> None:
    assert find_metric("AOV").key == "average_basket"
    assert find_metric("Revenue").key == "sales_gmv"
    assert find_metric("Late deliveries").key == "late_rate"
    assert find_metric("not a metric") is None


# --- status ---------------------------------------------------------------------------


def test_status_lower_better_absolute() -> None:
    cancel = get_metric("cancel_rate")
    assert status_for(0.02, cancel) == "good"
    assert status_for(0.05, cancel) == "watch"
    assert status_for(0.07, cancel) == "watch"
    assert status_for(0.10, cancel) == "bad"


def test_status_higher_better_absolute() -> None:
    on_time = get_metric("on_time_rate")
    assert status_for(0.95, on_time) == "good"
    assert status_for(0.85, on_time) == "watch"
    assert status_for(0.70, on_time) == "bad"


def test_status_relative_needs_a_baseline() -> None:
    sales = get_metric("sales_gmv")
    assert status_for(100.0, sales) == "unknown"
    assert status_for(100.0, sales, baseline=0) == "unknown"
    assert status_for(100.0, sales, baseline=100.0) == "good"
    assert status_for(120.0, sales, baseline=100.0) == "good"  # up is never adverse
    assert status_for(80.0, sales, baseline=100.0) == "watch"  # -20 %
    assert status_for(60.0, sales, baseline=100.0) == "bad"  # -40 %


def test_status_relative_direction_for_lower_better_counts() -> None:
    stock = get_metric("stockout_risk_count")  # absolute thresholds only
    assert status_for(4, stock) == "good"
    assert status_for(12, stock) == "watch"
    assert status_for(35, stock) == "bad"


def test_status_none_value_is_unknown() -> None:
    assert status_for(None, get_metric("cancel_rate")) == "unknown"


def test_status_takes_worst_of_absolute_and_relative() -> None:
    repeat = get_metric("repeat_rate")  # relative-only
    assert status_for(0.20, repeat, baseline=0.40) == "bad"
    avail = get_metric("availability_bestsellers")  # absolute-only, baseline ignored
    assert status_for(0.95, avail, baseline=0.5) == "good"


def test_status_accepts_decimal_values() -> None:
    assert status_for(Decimal("0.1200"), get_metric("cancel_rate")) == "bad"


# --- formatting ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, "₹0"),
        (412.4, "₹412"),
        (4350, "₹4,350"),
        (12345, "₹12,345"),
        (99999, "₹99,999"),
        (125000, "₹1.25 L"),
        (2_300_000, "₹23.00 L"),
        (23_000_000, "₹2.30 Cr"),
        (-4350, "-₹4,350"),
    ],
)
def test_format_inr(value: float, expected: str) -> None:
    assert format_inr(value) == expected


def test_format_display_by_unit() -> None:
    assert format_display(0.1234, "pct") == "12.3%"
    assert format_display(28.44, "minutes") == "28.4 min"
    assert format_display(1234567, "count") == "12,34,567"
    assert format_display(Decimal("513.38"), "inr") == "₹513"
    assert format_display(None, "inr") == "—"
    with pytest.raises(ValueError):
        format_display(1, "bananas")


# --- explanation ---------------------------------------------------------------------------


def test_delta_pct() -> None:
    assert delta_pct(110, 100) == pytest.approx(10.0)
    assert delta_pct(90, 100) == pytest.approx(-10.0)
    assert delta_pct(5, 0) is None
    assert delta_pct(None, 5) is None


def test_render_explanation_up_down_flat() -> None:
    sales = get_metric("sales_gmv")
    up = render_explanation(sales, 125000, 12.34)
    assert up == "Sales is ₹1.25 L, up 12.3% on the same day last week."
    down = render_explanation(sales, 80000, -20.0)
    assert "down 20.0%" in down
    flat = render_explanation(sales, 100000, 0.4)
    assert "about the same" in flat


def test_render_explanation_without_delta_or_value() -> None:
    cancel = get_metric("cancel_rate")
    assert render_explanation(cancel, 0.04, None) == "Cancelled orders is 4.0%."
    assert render_explanation(cancel, None, None) == "No cancelled orders figure is available yet."


def test_every_template_renders_without_leftover_placeholders() -> None:
    for metric in list_metrics():
        for delta in (10.0, -10.0, 0.0):
            text = render_explanation(metric, 0.5 if metric.unit == "pct" else 100, delta)
            assert "{" not in text and "}" not in text, (metric.key, text)


def test_metrics_doc_section_matches_registry() -> None:
    from quickcart.semantics.docs import BEGIN, DOC_PATH, END, render_markdown

    text = DOC_PATH.read_text(encoding="utf-8")
    assert BEGIN in text and END in text, "run: python -m quickcart.semantics.docs"
    committed = BEGIN + text.split(BEGIN, 1)[1].split(END, 1)[0] + END
    assert committed == render_markdown(), "metrics.md drifted: python -m quickcart.semantics.docs"
