"""Render the registry into ``docs/data_dictionary/metrics.md``.

``python -m quickcart.semantics.docs`` rewrites the generated section between the
markers; the unit test fails if the committed file drifts from ``metrics.yaml``.
"""

from __future__ import annotations

from pathlib import Path

from quickcart.semantics.registry import MetricDef, list_metrics

BEGIN = "<!-- BEGIN GENERATED: business-experience-metrics (python -m quickcart.semantics.docs) -->"
END = "<!-- END GENERATED: business-experience-metrics -->"
DOC_PATH = Path(__file__).resolve().parents[3] / "docs" / "data_dictionary" / "metrics.md"

_UNIT_TEXT = {
    "inr": "rupees (₹)",
    "pct": "percent (stored as a 0 to 1 fraction)",
    "count": "count",
    "minutes": "minutes",
}


def _thresholds(metric: MetricDef) -> str:
    t = metric.thresholds
    parts: list[str] = []
    if t.watch is not None or t.bad is not None:
        parts.append(f"watch {t.watch}, bad {t.bad} (absolute)")
    if t.relative_watch is not None or t.relative_bad is not None:
        parts.append(f"watch {t.relative_watch}%, bad {t.relative_bad}% (adverse change)")
    return "; ".join(parts) or "—"


def render_markdown() -> str:
    lines = [
        BEGIN,
        "",
        "## Business experience metrics",
        "",
        "Source of truth: `src/quickcart/semantics/metrics.yaml` (loaded by "
        "`quickcart.semantics.registry`). The business API (`/api/v1/b/*`), the "
        "serving snapshot, and the console glossary all use these definitions. Every "
        "metric is compared with the **same day last week** by default. Days are UTC.",
        "",
        "| Metric | Plain meaning | Formula | Unit | Better when | Watch / bad |",
        "|---|---|---|---|---|---|",
    ]
    for m in list_metrics():
        better = "higher" if m.direction == "higher_better" else "lower"
        flag = " *(partial)*" if m.status == "partial" else ""
        lines.append(
            f"| `{m.key}` — {m.label}{flag} | {m.plain_description} | "
            f"{' '.join(m.formula_text.split())} | {_UNIT_TEXT[m.unit]} | {better} | "
            f"{_thresholds(m)} |"
        )
    partial = [m for m in list_metrics() if m.status == "partial"]
    if partial:
        lines += ["", "Partial metrics:", ""]
        lines += [f"- `{m.key}`: {m.partial_note}" for m in partial]
    lines += [
        "",
        "On-time and late are one formula: `late_rate = late ÷ delivered` and "
        "`on_time_rate = 1 - late_rate`, over DELIVERED deliveries only.",
        "",
        END,
    ]
    return "\n".join(lines)


def update_document(path: Path = DOC_PATH) -> bool:
    """Insert or replace the generated section; returns True if the file changed."""
    text = path.read_text(encoding="utf-8")
    block = render_markdown()
    if BEGIN in text and END in text:
        head, rest = text.split(BEGIN, 1)
        _, tail = rest.split(END, 1)
        new = head + block + tail
    else:
        new = text.rstrip("\n") + "\n\n" + block + "\n"
    if new == text:
        return False
    path.write_text(new, encoding="utf-8")
    return True


def main() -> int:
    changed = update_document()
    print("updated" if changed else "already up to date", DOC_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
