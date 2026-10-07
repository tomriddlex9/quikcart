"""ToolSpec.args_model → Gemini function declaration JSON."""

from __future__ import annotations

import json
from typing import Literal

import pytest
from pydantic import BaseModel, Field

from quickcart.agents.cards import AnswerDraft
from quickcart.agents.declarations import schema_for, to_function_declaration
from quickcart.agents.tools import ToolDeps, ToolSpec, build_registry
from tests.unit.agents.business_fixtures import make_business_deps, make_principal

pytestmark = pytest.mark.unit


class Leaf(BaseModel):
    kind: Literal["a", "b"]
    n: int = Field(gt=0, le=9)


class Wrapper(BaseModel):
    """Doc string becomes noise Gemini does not need."""

    store_id: int | None = Field(default=None, gt=0, description="store")
    leaf: Leaf
    leaves: list[Leaf] = Field(default_factory=list, max_length=3)
    tag: str = "x"


def _spec(model: type[BaseModel], name: str = "t") -> ToolSpec:
    return ToolSpec(name, "desc", model, lambda a: {})


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def test_refs_are_inlined_and_nullables_cleaned() -> None:
    decl = to_function_declaration(_spec(Wrapper))
    params = decl["parameters"]
    text = json.dumps(params)
    for banned in ("$ref", "$defs", "anyOf", "title", "default", "additionalProperties"):
        assert banned not in text, banned
    assert params["type"] == "object"
    assert params["required"] == ["leaf"]
    store = params["properties"]["store_id"]
    assert store["type"] == "integer" and store["nullable"] is True
    assert store["minimum"] == 1 and store["description"] == "store"  # exclusiveMinimum folded
    leaf = params["properties"]["leaf"]
    assert leaf["type"] == "object" and leaf["properties"]["kind"]["enum"] == ["a", "b"]
    assert leaf["properties"]["n"]["maximum"] == 9
    assert params["properties"]["leaves"]["items"]["type"] == "object"
    assert params["properties"]["leaves"]["maxItems"] == 3


def test_no_argument_tool_omits_parameters() -> None:
    class Empty(BaseModel):
        pass

    decl = to_function_declaration(_spec(Empty, "get_kpi_summary"))
    assert decl == {"name": "get_kpi_summary", "description": "desc"}


def test_union_response_schema_keeps_any_of_without_discriminator() -> None:
    schema = schema_for(AnswerDraft)
    card_items = schema["properties"]["cards"]["items"]
    assert len(card_items["anyOf"]) == 6
    assert "discriminator" not in json.dumps(schema) and "$ref" not in json.dumps(schema)
    kinds = {v["properties"]["type"]["enum"][0] for v in card_items["anyOf"]}
    assert kinds == {"kpi", "trend", "compare", "table", "risk_list", "proposal"}


def test_every_registry_declaration_is_accepted_by_the_gemini_sdk() -> None:
    from google.genai import types

    registry = build_registry(ToolDeps(business=make_business_deps()))
    declarations = registry.declarations("text")
    assert {"get_metric", "compare_stores", "draft_action", "run_readonly_sql"} <= {
        d["name"] for d in declarations
    }
    for decl in declarations:
        parsed = types.FunctionDeclaration.model_validate(decl)
        assert parsed.name == decl["name"]
        for node in _walk(decl.get("parameters", {})):
            assert "$ref" not in node
    types.GenerateContentConfig(
        response_schema=schema_for(AnswerDraft), response_mime_type="application/json"
    )


def test_declarations_respect_channel_and_permissions() -> None:
    registry = build_registry(ToolDeps(business=make_business_deps()))
    names = lambda ch, p=None: {d["name"] for d in registry.declarations(ch, p)}  # noqa: E731
    assert "run_readonly_sql" in names("text") and "run_readonly_sql" not in names("voice")
    exec_tools = names("text", make_principal("business_exec"))
    assert "get_metric" in exec_tools and "draft_action" in exec_tools
    assert "run_readonly_sql" not in exec_tools  # business roles never hold the SQL permission
    ops_tools = names("text", make_principal("ops_manager"))
    assert "run_readonly_sql" in ops_tools
    leadership = names("text", make_principal("leadership"))
    assert "draft_action" not in leadership  # no proposal:create
