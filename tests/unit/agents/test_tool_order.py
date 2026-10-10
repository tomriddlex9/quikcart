"""Business tools appear before Gold/Spark tools in declarations."""

from __future__ import annotations

from tests.unit.agents.business_fixtures import make_registry


def test_business_tools_declared_before_gold() -> None:
    registry = make_registry()
    names = [s.name for s in registry.specs_for("text")]
    assert names.index("get_briefing") < names.index("get_store_metrics")
    assert names.index("get_metric") < names.index("run_readonly_sql")
