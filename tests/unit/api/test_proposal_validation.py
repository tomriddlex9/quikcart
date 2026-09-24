"""Pure-logic unit tests for the Phase 14 proposal rules (no database)."""

from datetime import UTC, datetime, timedelta

import pytest

from quickcart.api.models import MAX_RESTOCK_QUANTITY, ProposalCreate
from quickcart.api.proposals import (
    ProposalError,
    RestockFacts,
    parse_restock_scope,
    validate_restock,
)
from quickcart.api.status import parse_phase_progress

NOW = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)


def facts(**overrides) -> RestockFacts:
    base = dict(
        store_exists=True,
        product_exists=True,
        quantity=10,
        inventory_updated_at=NOW - timedelta(hours=1),
        now=NOW,
        has_open_duplicate=False,
    )
    base.update(overrides)
    return RestockFacts(**base)


pytestmark = pytest.mark.unit


class TestValidateRestock:
    def test_valid_scope_passes_all_rules(self) -> None:
        assert validate_restock(facts()) == []

    def test_unknown_store_rejected(self) -> None:
        reasons = validate_restock(facts(store_exists=False))
        assert any("store" in r for r in reasons)

    def test_unknown_product_rejected(self) -> None:
        reasons = validate_restock(facts(product_exists=False))
        assert any("product" in r for r in reasons)

    def test_zero_and_negative_quantity_rejected(self) -> None:
        for qty in (0, -5):
            reasons = validate_restock(facts(quantity=qty))
            assert any("positive" in r for r in reasons), qty

    def test_quantity_above_max_rejected(self) -> None:
        reasons = validate_restock(facts(quantity=MAX_RESTOCK_QUANTITY + 1))
        assert any("exceeds max restock limit" in r for r in reasons)
        assert validate_restock(facts(quantity=MAX_RESTOCK_QUANTITY)) == []

    def test_missing_inventory_facts_rejected(self) -> None:
        reasons = validate_restock(facts(inventory_updated_at=None))
        assert any("no inventory facts" in r for r in reasons)

    def test_stale_inventory_rejected(self) -> None:
        reasons = validate_restock(facts(inventory_updated_at=NOW - timedelta(hours=49)))
        assert any("stale" in r for r in reasons)

    def test_inventory_exactly_48h_old_is_fresh_enough(self) -> None:
        assert validate_restock(facts(inventory_updated_at=NOW - timedelta(hours=48))) == []

    def test_open_duplicate_rejected(self) -> None:
        reasons = validate_restock(facts(has_open_duplicate=True))
        assert any("open" in r for r in reasons)

    def test_multiple_failures_reported_together(self) -> None:
        reasons = validate_restock(facts(store_exists=False, quantity=0, has_open_duplicate=True))
        assert len(reasons) == 3


class TestParseRestockScope:
    def test_happy_path(self) -> None:
        assert parse_restock_scope({"store_id": 1, "product_id": 2, "quantity": 3}) == (1, 2, 3)

    def test_missing_key_is_400(self) -> None:
        with pytest.raises(ProposalError) as exc:
            parse_restock_scope({"store_id": 1, "product_id": 2})
        assert exc.value.status_code == 400
        assert "quantity" in exc.value.detail

    def test_non_integer_value_is_400(self) -> None:
        with pytest.raises(ProposalError) as exc:
            parse_restock_scope({"store_id": 1, "product_id": 2, "quantity": "ten"})
        assert exc.value.status_code == 400

    def test_boolean_is_not_an_integer(self) -> None:
        with pytest.raises(ProposalError):
            parse_restock_scope({"store_id": True, "product_id": 2, "quantity": 3})


class TestProposalCreateModel:
    def test_entity_scope_defaults_and_types(self) -> None:
        body = ProposalCreate(
            proposal_type="RESTOCK",
            entity_scope={"store_id": 1, "product_id": 2, "quantity": 10},
            recommended_action="Restock 10 units",
            reason="below reorder point",
            evidence=["gold_inventory_health shows stockout risk"],
        )
        assert body.source_request_id is None
        assert body.evidence == ["gold_inventory_health shows stockout risk"]


class TestPhaseProgressParsing:
    def test_checkbox_snapshot(self, tmp_path) -> None:
        tasks = tmp_path / "TASKS.md"
        tasks.write_text(
            "# Tracker\n\n"
            "## Phase 1 — Core\n\n"
            "- [x] done one\n"
            "- [x] done two\n\n"
            "## Phase 2 — Partial\n\n"
            "- [x] done\n"
            "- [ ] todo\n\n"
            "## Phase 3 — Later\n\n"
            "- [ ] nothing yet\n",
            encoding="utf-8",
        )
        phases = parse_phase_progress(tasks)
        assert phases == [
            {"phase": 1, "name": "Core", "status": "done"},
            {"phase": 2, "name": "Partial", "status": "in_progress"},
            {"phase": 3, "name": "Later", "status": "pending"},
        ]

    def test_missing_file_yields_empty(self, tmp_path) -> None:
        assert parse_phase_progress(tmp_path / "nope.md") == []
