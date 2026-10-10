"""Resolve a business metric key to its Raw → Bronze → Silver → Gold journey.

Used by ``GET /api/v1/metrics/{metric_key}/lineage`` so the business console can
show how a KPI is extracted from operational data without inventing topology.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque
from dataclasses import asdict
from typing import Any

from quickcart.api.lineage_map import lineage_edges, lineage_nodes
from quickcart.api.transform_catalog import TransformOp, ops_for_table
from quickcart.semantics.registry import MetricDef, get_metric, list_metrics

_GOLD_TABLE_RE = re.compile(r"\bgold_[a-z0-9_]+\b")
_LAYER_ORDER = ("raw", "bronze", "silver", "quarantine", "gold")


class MetricLineageError(LookupError):
    """Unknown metric or unresolvable gold source."""


def parse_gold_source(gold_source: str) -> tuple[str, str | None]:
    """Return ``(gold_table, column_or_None)`` from a metrics.yaml ``gold_source``."""
    matches = _GOLD_TABLE_RE.findall(gold_source)
    if not matches:
        raise MetricLineageError(f"no gold table in gold_source={gold_source!r}")
    table = matches[0]
    remainder = gold_source[gold_source.index(table) + len(table) :]
    column: str | None = None
    if remainder.startswith("."):
        token = remainder[1:].split()[0]
        token = token.split("(")[0].strip(".,;+")
        if token and re.fullmatch(r"[a-z0-9_]+", token):
            column = token
    return table, column


def _node_index() -> dict[str, Any]:
    return {n.id: n for n in lineage_nodes()}


def _reverse_adjacency() -> dict[str, list[tuple[str, str]]]:
    """target_id -> list of (source_id, kind)."""
    rev: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for edge in lineage_edges():
        rev[edge.target].append((edge.source, edge.kind))
    return rev


def _upstream_subgraph(gold_fqn: str) -> tuple[set[str], list[dict[str, str]]]:
    """BFS ancestors of ``gold_fqn`` (inclusive). Edges oriented source→target."""
    rev = _reverse_adjacency()
    seen: set[str] = {gold_fqn}
    queue: deque[str] = deque([gold_fqn])
    edges: list[dict[str, str]] = []
    while queue:
        current = queue.popleft()
        for source, kind in rev.get(current, []):
            edges.append({"from": source, "to": current, "kind": kind})
            if source not in seen:
                seen.add(source)
                queue.append(source)
    return seen, edges


def _op_payload(op: TransformOp) -> dict[str, Any]:
    return {
        "id": op.id,
        "name": op.name,
        "layer": op.layer,
        "engine": op.engine,
        "summary": op.summary,
        "code": op.code,
        "inputs": list(op.inputs),
        "outputs": list(op.outputs),
        "source_path": op.source_path,
        "rules": [asdict(r) for r in op.rules],
    }


def _ops_for_fqn(fqn: str) -> list[dict[str, Any]]:
    bare = fqn.split(".")[-1]
    # Prefer ops that *output* this table (builders), then any touch.
    builders: list[TransformOp] = []
    others: list[TransformOp] = []
    for op in ops_for_table(bare):
        out_names = " ".join(op.outputs).lower()
        if bare.lower() in out_names:
            builders.append(op)
        else:
            others.append(op)
    ordered = builders or others
    # De-dupe while preserving order
    seen_ids: set[str] = set()
    payload: list[dict[str, Any]] = []
    for op in ordered:
        if op.id in seen_ids:
            continue
        seen_ids.add(op.id)
        payload.append(_op_payload(op))
    return payload


def _layer_of(fqn: str) -> str:
    return fqn.split(".", 1)[0] if "." in fqn else "raw"


def build_metric_lineage(metric_key: str) -> dict[str, Any]:
    """Assemble the provenance payload for one registry metric."""
    try:
        metric: MetricDef = get_metric(metric_key)
    except KeyError as exc:
        raise MetricLineageError(str(exc)) from exc

    gold_table, column = parse_gold_source(metric.gold_source)
    gold_fqn = f"gold.{gold_table}"
    nodes_by_id = _node_index()
    if gold_fqn not in nodes_by_id:
        # Still allow a gold step even if the static map is incomplete.
        pass

    node_ids, edges = _upstream_subgraph(gold_fqn)
    if gold_fqn not in node_ids:
        node_ids.add(gold_fqn)

    # Group nodes into ordered medallion steps (skip quarantine in the primary rail
    # but keep them available via ops when attached to silver).
    by_layer: dict[str, list[str]] = defaultdict(list)
    for fqn in sorted(node_ids):
        layer = _layer_of(fqn)
        if layer == "quarantine":
            continue
        by_layer[layer].append(fqn)

    steps: list[dict[str, Any]] = []
    for layer in _LAYER_ORDER:
        if layer == "quarantine":
            continue
        for fqn in by_layer.get(layer, []):
            bare = fqn.split(".")[-1]
            node = nodes_by_id.get(fqn)
            columns = list(node.columns) if node is not None else []
            role = "source" if layer == "raw" else "transform" if layer != "gold" else "metric"
            step: dict[str, Any] = {
                "layer": layer,
                "table": bare,
                "fqn": fqn,
                "role": role,
                "columns": columns,
                "row_count": None,
                "ops": _ops_for_fqn(fqn),
            }
            if layer == "gold" and bare == gold_table:
                step["column"] = column
                step["aggregation"] = metric.formula_text
            steps.append(step)

    # Ensure the gold metric table is last among gold steps when present.
    gold_steps = [s for s in steps if s["layer"] == "gold"]
    other_steps = [s for s in steps if s["layer"] != "gold"]
    gold_steps.sort(key=lambda s: 0 if s["table"] == gold_table else 1)
    steps = other_steps + gold_steps

    return {
        "metric_key": metric.key,
        "label": metric.label,
        "plain_description": metric.plain_description,
        "formula_text": metric.formula_text,
        "gold_source": metric.gold_source,
        "unit": metric.unit,
        "steps": steps,
        "edges": edges,
    }


def headline_metric_keys() -> list[str]:
    """Keys the business console surfaces as headline / more KPIs."""
    preferred = [
        "sales_gmv",
        "orders",
        "average_basket",
        "on_time_rate",
        "cancel_rate",
        "stockout_risk_count",
        "active_customers",
        "late_rate",
        "avg_delivery_minutes",
        "repeat_rate",
        "availability_bestsellers",
        "payment_failure_rate",
    ]
    known = {m.key for m in list_metrics()}
    return [k for k in preferred if k in known]


__all__ = [
    "MetricLineageError",
    "build_metric_lineage",
    "headline_metric_keys",
    "parse_gold_source",
]
