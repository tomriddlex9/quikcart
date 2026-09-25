"""Contract / lineage map unit tests (integrator-owned)."""

from quickcart.api.lineage_map import lineage_edges, lineage_nodes
from quickcart.live.contracts import (
    DELIVERY_MODEL_JOBLIB,
    PIPELINE_STAGES,
    CatalogLineage,
    LiveSnapshot,
)


def test_pipeline_stages_cover_worker_surface() -> None:
    assert "worker" in PIPELINE_STAGES
    assert "gold_refresh" in PIPELINE_STAGES
    assert "ml_scoring" in PIPELINE_STAGES


def test_joblib_paths_are_under_artifacts() -> None:
    assert DELIVERY_MODEL_JOBLIB.startswith("artifacts/")


def test_lineage_every_gold_traces_to_raw() -> None:
    nodes = {n.id: n for n in lineage_nodes()}
    edges = lineage_edges()
    parents: dict[str, set[str]] = {nid: set() for nid in nodes}
    for edge in edges:
        if edge.target in parents:
            parents[edge.target].add(edge.source)

    def reaches_raw(node_id: str, seen: set[str] | None = None) -> bool:
        seen = seen or set()
        if node_id in seen:
            return False
        seen.add(node_id)
        node = nodes.get(node_id)
        if node is None:
            return False
        if node.layer == "raw":
            return True
        return any(reaches_raw(p, seen) for p in parents.get(node_id, ()))

    gold_ids = [nid for nid, n in nodes.items() if n.layer == "gold"]
    assert gold_ids
    missing = [gid for gid in gold_ids if not reaches_raw(gid)]
    assert missing == [], f"gold nodes without raw ancestry: {missing}"


def test_live_snapshot_defaults_roundtrip() -> None:
    snap = LiveSnapshot(
        generated_at="2026-01-01T00:00:00Z",
        orders_1m=0,
        orders_15m=0,
        orders_60m=0,
        gmv_1m=0.0,
        gmv_15m=0.0,
        gmv_60m=0.0,
    )
    assert snap.recent_orders == []
    CatalogLineage(generated_at="2026-01-01T00:00:00Z", nodes=[], edges=[])
