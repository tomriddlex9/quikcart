"""Shape coverage for the /layers console backend (quickcart.api.layer_ops)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from quickcart.api.layer_ops import (
    LayerOpsError,
    build_layers_catalog,
    layer_sample,
)

MEDALLION_LAYERS = {"raw", "bronze", "silver", "quarantine", "gold"}


def test_build_layers_catalog_has_operations_and_summaries_for_every_layer() -> None:
    catalog = build_layers_catalog()

    assert catalog.generated_at.endswith("Z")
    assert len(catalog.operations) > 0
    assert set(catalog.layer_summaries) == MEDALLION_LAYERS

    seen_layers = {op.layer for op in catalog.operations}
    assert seen_layers <= MEDALLION_LAYERS
    # bronze/silver/gold must each have at least one op to plot on the page
    assert {"bronze", "silver", "gold"} <= seen_layers


def test_every_operation_has_a_populated_impact_and_io() -> None:
    catalog = build_layers_catalog()

    for op in catalog.operations:
        assert op.id
        assert op.inputs
        assert op.outputs
        assert op.code.strip()
        assert op.impact.rows_out >= 0
        assert op.impact.rows_quarantined >= 0


@pytest.mark.parametrize("layer", sorted(MEDALLION_LAYERS))
def test_layer_sample_returns_a_sample_for_every_medallion_layer(layer: str) -> None:
    sample = layer_sample(layer)

    assert sample.layer == layer
    assert isinstance(sample.after, list)
    assert isinstance(sample.notes, list)


def test_layer_sample_rejects_unknown_layer() -> None:
    with pytest.raises(LayerOpsError):
        layer_sample("platinum")


def test_layers_routes_are_registered_on_the_app() -> None:
    from quickcart.api.app import create_app

    app: FastAPI = create_app()
    with TestClient(app) as client:
        operations_response = client.get("/api/v1/layers/operations")
        sample_response = client.get("/api/v1/layers/sample/bronze")
        missing_response = client.get("/api/v1/layers/sample/platinum")

    assert operations_response.status_code == 200
    body = operations_response.json()
    assert "operations" in body
    assert "layer_summaries" in body

    assert sample_response.status_code == 200
    assert sample_response.json()["layer"] == "bronze"

    assert missing_response.status_code == 404
