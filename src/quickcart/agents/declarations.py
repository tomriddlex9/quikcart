"""ToolSpec → Gemini function declaration (JSON).

Gemini accepts an OpenAPI-3.0 subset, not full JSON Schema. Pydantic emits
``$defs``/``$ref``, ``anyOf: [X, null]`` for optionals, ``title`` noise and
``exclusiveMinimum``. This module flattens all of that into the accepted subset
so the same `ToolSpec.args_model` that validates arguments also describes the
tool to the model — one source of truth, no hand-written declarations.
"""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel

# Keys Gemini's Schema understands (everything else is dropped).
_ALLOWED_KEYS = frozenset(
    {
        "type",
        "format",
        "description",
        "nullable",
        "enum",
        "anyOf",
        "properties",
        "required",
        "items",
        "minimum",
        "maximum",
        "minItems",
        "maxItems",
        "minLength",
        "maxLength",
        "pattern",
    }
)
_MAX_REF_DEPTH = 8


class SupportsDeclaration(Protocol):
    name: str
    description: str
    args_model: type[BaseModel]


def _resolve_ref(ref: str, defs: dict[str, Any]) -> dict[str, Any]:
    prefix = "#/$defs/"
    if not ref.startswith(prefix) or ref[len(prefix) :] not in defs:
        raise ValueError(f"unresolvable schema reference {ref!r}")
    return defs[ref[len(prefix) :]]


def _clean(node: Any, defs: dict[str, Any], depth: int) -> Any:
    if depth > _MAX_REF_DEPTH:
        raise ValueError("schema nesting/recursion too deep for a function declaration")
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        overrides = {k: v for k, v in node.items() if k != "$ref"}
        merged = {**_resolve_ref(node["$ref"], defs), **overrides}
        return _clean(merged, defs, depth + 1)

    variants = node.get("anyOf") or node.get("oneOf")
    if variants:
        non_null = [v for v in variants if not (isinstance(v, dict) and v.get("type") == "null")]
        nullable = len(non_null) != len(variants)
        if len(non_null) == 1:
            base = {k: v for k, v in node.items() if k not in ("anyOf", "oneOf")}
            cleaned = _clean({**non_null[0], **base}, defs, depth + 1)
            if nullable:
                cleaned["nullable"] = True
            return cleaned
        # Gemini's Schema supports anyOf; discriminator hints are dropped (not in the subset).
        out_union: dict[str, Any] = {"anyOf": [_clean(v, defs, depth + 1) for v in non_null]}
        if nullable:
            out_union["nullable"] = True
        if "description" in node:
            out_union["description"] = node["description"]
        return out_union

    if "const" in node:
        node = {**{k: v for k, v in node.items() if k != "const"}, "enum": [node["const"]]}

    out: dict[str, Any] = {}
    if "exclusiveMinimum" in node and node.get("type") == "integer":
        out["minimum"] = int(node["exclusiveMinimum"]) + 1
    if "exclusiveMaximum" in node and node.get("type") == "integer":
        out["maximum"] = int(node["exclusiveMaximum"]) - 1
    for key, value in node.items():
        if key not in _ALLOWED_KEYS:
            continue
        if key == "anyOf":
            out[key] = [_clean(sub, defs, depth + 1) for sub in value]
        elif key == "properties":
            out[key] = {name: _clean(sub, defs, depth + 1) for name, sub in value.items()}
        elif key == "items":
            out[key] = _clean(value, defs, depth + 1)
        elif key == "type":
            out[key] = value if isinstance(value, str) else _first_non_null(value, out)
        else:
            out[key] = value
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    return out


def _first_non_null(types: list[str], out: dict[str, Any]) -> str:
    non_null = [t for t in types if t != "null"]
    if len(non_null) != len(types):
        out["nullable"] = True
    return non_null[0]


def schema_for(model: type[BaseModel]) -> dict[str, Any]:
    """Gemini-compatible parameter schema for ``model`` (always an object)."""
    raw = model.model_json_schema()
    defs = raw.get("$defs", {})
    schema = _clean({k: v for k, v in raw.items() if k != "$defs"}, defs, 0)
    schema["type"] = "object"
    schema.setdefault("properties", {})
    # Optional-with-default args must not appear as required.
    if "required" in schema:
        schema["required"] = [r for r in schema["required"] if r in schema["properties"]]
        if not schema["required"]:
            del schema["required"]
    return schema


def to_function_declaration(spec: SupportsDeclaration) -> dict[str, Any]:
    """One Gemini ``FunctionDeclaration`` as plain JSON.

    Tools with no arguments omit ``parameters`` (Gemini rejects an empty object).
    """
    declaration: dict[str, Any] = {"name": spec.name, "description": spec.description}
    schema = schema_for(spec.args_model)
    if schema["properties"]:
        declaration["parameters"] = schema
    return declaration


def to_function_declarations(specs: list[SupportsDeclaration]) -> list[dict[str, Any]]:
    return [to_function_declaration(spec) for spec in specs]
