"""Natural-language intent classification for the console SQL generator.

The generator must refuse anything that sounds like a write, DDL, or admin
action *before* the local model is asked to invent SQL. Classification is
deterministic (regex / keyword heuristics) so it works with Ollama offline and
cannot be talked out of the allow-list by prompt injection.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

SqlIntent = Literal[
    "read",
    "mutate",
    "schema_change",
    "admin",
    "exfiltrate",
    "off_topic",
]

_ALLOWED: frozenset[SqlIntent] = frozenset({"read"})

# Order matters: more specific families win over generic "change" wording.
_MUTATE_PATTERNS = (
    r"\b(delete|remove|wipe|erase|purge|destroy|drop\s+all|clear\s+out)\b",
    r"\b(update|modify|overwrite|mutate|edit|change)\b.{0,40}\b(row|rows|order|orders|table|tables|record|records|data|inventory|payment|payments|customer|customers)\b",
    r"\b(insert|add\s+a\s+row|create\s+an?\s+order|write\s+into|upsert|merge\s+into)\b",
    r"\b(truncate|empty\s+the\s+table)\b",
    r"\b(set\s+\w+\s*=|bump|increment|decrement)\b.{0,30}\b(price|qty|quantity|status|amount)\b",
)

_SCHEMA_PATTERNS = (
    r"\b(drop\s+(table|database|schema|view|index|column)|alter\s+table|create\s+(table|index|view|schema|database))\b",
    r"\b(add\s+column|rename\s+(table|column)|change\s+the\s+schema)\b",
)

_ADMIN_PATTERNS = (
    r"\b(grant|revoke|vacuum|reindex|cluster|analyze|refresh\s+materialized|pg_sleep|copy\s+\w+\s+to|listen|notify)\b",
    r"\b(kill\s+connections?|shutdown|restart\s+(postgres|the\s+database)|disable\s+constraints?)\b",
)

_EXFIL_PATTERNS = (
    r"\b(dump\s+(the\s+)?(database|db|all\s+tables)|export\s+everything|send\s+(me\s+)?(the\s+)?(passwords?|credentials?|secrets?))\b",
    r"\b(pg_read_file|lo_import|dblink|file_fdw)\b",
)

_OFF_TOPIC_PATTERNS = (
    r"\b(ignore\s+(previous|all)\s+instructions|jailbreak|system\s+prompt)\b",
    r"\b(write\s+(me\s+)?a\s+poem|tell\s+me\s+a\s+joke|what'?s\s+the\s+weather|who\s+are\s+you)\b",
)

_READ_HINTS = (
    r"\b(select|show|list|how\s+many|count|top|rank|average|avg|sum|total|trend|compare|which|what|when|where|find|fetch|get|report|metric|gmv|late|cancel|forecast)\b",
)

_JOKES: dict[SqlIntent, tuple[str, ...]] = {
    "mutate": (
        "I'd rewrite your rows, but my union card only covers SELECT.",
        "DELETE is how databases get separation anxiety. Read therapy only.",
        "Tempting! But if I mutate production I'll have to update my LinkedIn.",
        "I left my WRITE permissions in my other jacket. Fancy a COUNT(*)?",
    ),
    "schema_change": (
        "DROP TABLE is a lifestyle choice I don't support. Schema stays put.",
        "Altering tables mid-demo is how war stories start. Ask for a SELECT.",
        "I don't do interior design for schemas — only window shopping via SELECT.",
    ),
    "admin": (
        "Admin spells are sealed in the runbook, not the query box.",
        "VACUUM in public? Absolutely not. Pick a metric to inspect instead.",
        "GRANT/REVOKE is above my pay grade. I can still count late deliveries.",
    ),
    "exfiltrate": (
        "I don't do data heists. Ask for a narrow SELECT of demo metrics.",
        "Passwords and full dumps are off the menu. Special today: analytics.",
    ),
    "off_topic": (
        "Cute, but this is a warehouse, not a comedy club. Ask about GMV.",
        "I'll save the jokes for when you try to DROP something.",
    ),
}


@dataclass(frozen=True)
class IntentDecision:
    intent: SqlIntent
    allowed: bool
    reason: str
    joke: str | None = None


def _match_any(text: str, patterns: tuple[str, ...]) -> re.Match[str] | None:
    for pattern in patterns:
        hit = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if hit is not None:
            return hit
    return None


def _pick_joke(intent: SqlIntent, question: str) -> str:
    options = _JOKES.get(intent) or _JOKES["off_topic"]
    digest = hashlib.sha256(f"{intent}:{question.strip().lower()}".encode()).hexdigest()
    return options[int(digest[:8], 16) % len(options)]


def classify_sql_intent(question: str) -> IntentDecision:
    """Classify a plain-English ask before any model call.

    Only ``read`` is allowed through to SQL generation. Everything else returns
    a short reason plus a deterministic joke so the UI can refuse without being
    humourless.
    """
    text = " ".join(question.strip().split())
    if not text:
        return IntentDecision(
            intent="off_topic",
            allowed=False,
            reason="Empty question — ask for a read-only metric or listing.",
            joke=_pick_joke("off_topic", "empty"),
        )

    lowered = text.lower()

    if _match_any(lowered, _SCHEMA_PATTERNS):
        return IntentDecision(
            intent="schema_change",
            allowed=False,
            reason="That sounds like a schema change (DDL). This console is read-only.",
            joke=_pick_joke("schema_change", text),
        )
    if _match_any(lowered, _ADMIN_PATTERNS):
        return IntentDecision(
            intent="admin",
            allowed=False,
            reason="That sounds like database administration. Not available here.",
            joke=_pick_joke("admin", text),
        )
    if _match_any(lowered, _EXFIL_PATTERNS):
        return IntentDecision(
            intent="exfiltrate",
            allowed=False,
            reason="That sounds like a bulk dump or secret grab. Refused.",
            joke=_pick_joke("exfiltrate", text),
        )
    if _match_any(lowered, _MUTATE_PATTERNS):
        return IntentDecision(
            intent="mutate",
            allowed=False,
            reason="That sounds like a write or delete. Only SELECT / WITH queries are allowed.",
            joke=_pick_joke("mutate", text),
        )
    if _match_any(lowered, _OFF_TOPIC_PATTERNS) and not _match_any(lowered, _READ_HINTS):
        return IntentDecision(
            intent="off_topic",
            allowed=False,
            reason="That doesn't look like an analytics question about QuickCart data.",
            joke=_pick_joke("off_topic", text),
        )

    return IntentDecision(
        intent="read",
        allowed=True,
        reason="Looks like a read / analytics question.",
        joke=None,
    )


__all__ = ["IntentDecision", "SqlIntent", "classify_sql_intent"]
