"""Answer cards + provenance for the Assistant v2 (Phase B4).

The model never writes a figure itself. Tools return **facts** (`Fact`, each
with a stable ``ref``), the model answers with an `AnswerDraft` made of

* a short ``summary`` that may embed ``{{ref}}`` placeholders, and
* ``cards`` that only *point at* facts by ``ref``,

and `hydrate_answer` turns that draft into an `AnswerEnvelope` whose numbers
are rendered from the facts. Provenance is enforced in three steps:

1. every card ref must resolve to a fact of the right kind, otherwise the card
   is dropped and the problem is recorded;
2. every ``{{ref}}`` placeholder must resolve, otherwise its sentence is dropped;
3. any figure left in free text that no fact contains (a *stray number*) causes
   its sentence to be dropped (repair); when nothing verifiable is left the
   answer degrades to **cards-only** — never to an unverified claim.

Pure functions only: no I/O, no clock, deterministic.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, ValidationError

Status = Literal["good", "watch", "bad", "unknown"]

MAX_FOLLOWUPS = 3
MAX_CARDS = 6
MAX_FOLLOWUP_CHARS = 90
CARDS_ONLY_SUMMARY = "Here is what the data shows."
NO_VERIFIED_SUMMARY = (
    "I could not verify any figures for that question, so I am not reporting numbers."
)

# --------------------------------------------------------------------------- #
# Evidence (what tools hand back)
# --------------------------------------------------------------------------- #


class SeriesPoint(BaseModel):
    at: str
    value: float | None = None
    display: str = "—"


class RiskItem(BaseModel):
    title: str
    detail: str = ""
    severity: Literal["watch", "bad"] = "watch"
    store_id: int | None = None
    ref: str | None = None


class Fact(BaseModel):
    """One citable piece of evidence. ``ref`` is its stable address."""

    ref: str
    kind: Literal["metric", "series", "table", "risk_list", "proposal", "note"] = "metric"
    label: str = ""
    value: float | None = None
    display: str = ""
    unit: str | None = None
    status: Status = "unknown"
    delta_pct: float | None = None
    baseline_display: str | None = None
    compare_label: str | None = None
    explanation: str | None = None
    as_of: str | None = None
    points: list[SeriesPoint] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    items: list[RiskItem] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


class EvidenceStore(dict[str, Fact]):
    """``ref → Fact``; later facts replace earlier ones with the same ref."""

    def add(self, fact: Fact | Mapping[str, Any]) -> Fact:
        parsed = fact if isinstance(fact, Fact) else Fact.model_validate(fact)
        self[parsed.ref] = parsed
        return parsed

    def add_many(self, facts: Iterable[Fact | Mapping[str, Any]] | Mapping[str, Any]) -> None:
        if isinstance(facts, Mapping):
            facts = facts.values()
        for fact in facts:
            self.add(fact)


# --------------------------------------------------------------------------- #
# Draft side (what the model emits: refs only, never rendered numbers)
# --------------------------------------------------------------------------- #


class KpiDraft(BaseModel):
    type: Literal["kpi"]
    ref: str
    note: str | None = None


class TrendDraft(BaseModel):
    type: Literal["trend"]
    ref: str
    title: str | None = None


class CompareDraft(BaseModel):
    type: Literal["compare"]
    refs: list[str] = Field(min_length=2)
    title: str | None = None


class TableDraft(BaseModel):
    type: Literal["table"]
    ref: str
    title: str | None = None
    limit: int | None = Field(default=None, ge=1, le=50)


class RiskListDraft(BaseModel):
    type: Literal["risk_list"]
    ref: str
    title: str | None = None


class ProposalDraft(BaseModel):
    type: Literal["proposal"]
    ref: str


CardDraft = Annotated[
    KpiDraft | TrendDraft | CompareDraft | TableDraft | RiskListDraft | ProposalDraft,
    Field(discriminator="type"),
]


class AnswerDraft(BaseModel):
    """The model's structured final reply (also the Gemini response schema)."""

    summary: str = Field(
        description="1-3 short sentences. Never type a figure: embed {{ref}} placeholders."
    )
    cards: list[CardDraft] = Field(
        default_factory=list, description=f"At most {MAX_CARDS} cards; refs from tool results."
    )
    followups: list[str] = Field(
        default_factory=list,
        description=f"At most {MAX_FOLLOWUPS} short next questions, no numbers.",
    )


# --------------------------------------------------------------------------- #
# Rendered side (what the API/UI receives)
# --------------------------------------------------------------------------- #


class KpiCard(BaseModel):
    type: Literal["kpi"] = "kpi"
    ref: str
    label: str
    display: str
    status: Status = "unknown"
    delta_display: str | None = None
    baseline_display: str | None = None
    compare_label: str | None = None
    explanation: str | None = None
    note: str | None = None


class TrendCard(BaseModel):
    type: Literal["trend"] = "trend"
    ref: str
    title: str
    unit: str | None = None
    points: list[SeriesPoint]


class CompareItem(BaseModel):
    ref: str
    label: str
    display: str
    value: float | None = None
    status: Status = "unknown"
    delta_display: str | None = None


class CompareCard(BaseModel):
    type: Literal["compare"] = "compare"
    title: str
    items: list[CompareItem]


class TableCard(BaseModel):
    type: Literal["table"] = "table"
    ref: str
    title: str
    columns: list[str]
    rows: list[dict[str, Any]]


class RiskListCard(BaseModel):
    type: Literal["risk_list"] = "risk_list"
    ref: str
    title: str
    items: list[RiskItem]


class ProposalCard(BaseModel):
    type: Literal["proposal"] = "proposal"
    ref: str
    title: str
    status: str
    detail: str = ""
    proposal_id: int | None = None
    proposal_type: str | None = None


Card = Annotated[
    KpiCard | TrendCard | CompareCard | TableCard | RiskListCard | ProposalCard,
    Field(discriminator="type"),
]


class Provenance(BaseModel):
    refs: list[str] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    stray_numbers: list[str] = Field(default_factory=list)
    dropped_cards: int = 0
    repaired: bool = False
    cards_only: bool = False
    issues: list[str] = Field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not (self.unresolved or self.stray_numbers or self.dropped_cards)


class AnswerEnvelope(BaseModel):
    summary: str
    cards: list[Card] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list)
    provenance: Provenance = Field(default_factory=Provenance)


# --------------------------------------------------------------------------- #
# Number scanning
# --------------------------------------------------------------------------- #

_ISO_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b")
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_NUMBER_RE = re.compile(
    r"(?P<cur>₹\s?)?(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?P<unit>\s?(?:%|Cr\b|crore\b|L\b|lakh\b|lakhs\b|K\b))?",
    re.IGNORECASE,
)
_WINDOW_RE = re.compile(r"^\s*-?\s*(?:day|days|week|weeks|hour|hours|hr|hrs)\b", re.IGNORECASE)
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([^{}|]+?)\s*(?:\|\s*(\w+)\s*)?\}\}")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9₹\"'(\[{])|\n+")
_UNIT_SCALE = {"cr": 1e7, "crore": 1e7, "l": 1e5, "lakh": 1e5, "lakhs": 1e5, "k": 1e3}
ABS_TOLERANCE = 0.051
REL_TOLERANCE = 0.01


def extract_numbers(text: str) -> list[tuple[str, float]]:
    """``(token, value)`` for every figure in free text (scaled for L / Cr / K).

    Dates, bare years and "N days/weeks/hours" windows are not figures.
    """
    cleaned = _ISO_DATE_RE.sub(" ", text)
    cleaned = _YEAR_RE.sub(" ", cleaned)
    found: list[tuple[str, float]] = []
    for match in _NUMBER_RE.finditer(cleaned):
        tail = cleaned[match.end() :]
        if not match.group("unit") and _WINDOW_RE.match(tail):
            continue
        value = float(match.group("num").replace(",", ""))
        unit = (match.group("unit") or "").strip().lower()
        value *= _UNIT_SCALE.get(unit, 1.0)
        found.append((match.group(0).strip(), value))
    return found


def _walk_numbers(node: Any, sink: set[float]) -> None:
    if isinstance(node, bool) or node is None:
        return
    if isinstance(node, (int, float)):
        sink.add(float(node))
        return
    if isinstance(node, str):
        for _, value in extract_numbers(node):
            sink.add(value)
        return
    if isinstance(node, Mapping):
        for item in node.values():
            _walk_numbers(item, sink)
        return
    if isinstance(node, (list, tuple, set, frozenset)):
        sink.add(float(len(node)))
        for item in node:
            _walk_numbers(item, sink)


def allowed_numbers(facts: Iterable[Fact]) -> set[float]:
    """Every figure the evidence legitimately contains (plus x100 for fractions)."""
    sink: set[float] = set()
    for fact in facts:
        _walk_numbers(fact.model_dump(mode="json", exclude={"ref"}), sink)
        _walk_numbers(fact.ref, sink)
    scaled = {v * 100.0 for v in sink if 0 < abs(v) <= 1.0}
    return sink | scaled


def _is_allowed(value: float, allowed: set[float]) -> bool:
    return any(abs(value - a) <= max(ABS_TOLERANCE, REL_TOLERANCE * abs(a)) for a in allowed)


def find_stray_numbers(
    text: str, evidence: Mapping[str, Fact], *, extra_allowed: Iterable[float] = ()
) -> list[str]:
    """Figures in ``text`` that no fact in ``evidence`` contains."""
    allowed = allowed_numbers(evidence.values()) | {float(v) for v in extra_allowed}
    return [token for token, value in extract_numbers(text) if not _is_allowed(value, allowed)]


# --------------------------------------------------------------------------- #
# Summary rendering (placeholders + sentence-level repair)
# --------------------------------------------------------------------------- #


def delta_display(delta_pct: float | None) -> str | None:
    if delta_pct is None:
        return None
    sign = "+" if delta_pct >= 0 else "-"
    return f"{sign}{abs(delta_pct):.1f}%"


def _placeholder_text(fact: Fact, mode: str | None) -> str | None:
    if mode == "delta":
        return delta_display(fact.delta_pct)
    if mode == "label":
        return fact.label or None
    if mode == "baseline":
        return fact.baseline_display
    return fact.display or None


class SummaryResult(BaseModel):
    text: str
    refs: list[str] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    stray_numbers: list[str] = Field(default_factory=list)
    dropped_sentences: int = 0


def split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_SPLIT_RE.split(text.strip())
    return [part.strip() for part in parts if part and part.strip()]


def render_sentence(
    sentence: str, evidence: Mapping[str, Fact], allowed: set[float]
) -> tuple[str | None, list[str], list[str], list[str]]:
    """Render one sentence → ``(text | None, refs, unresolved, strays)``.

    ``None`` means the sentence could not be verified and must be dropped.
    """
    refs: list[str] = []
    unresolved: list[str] = []

    def substitute(match: re.Match[str]) -> str:
        ref, mode = match.group(1), match.group(2)
        fact = evidence.get(ref)
        rendered = _placeholder_text(fact, mode) if fact is not None else None
        if rendered is None:
            unresolved.append(ref)
            return ""
        refs.append(ref)
        return rendered

    rendered_text = _PLACEHOLDER_RE.sub(substitute, sentence)
    if unresolved:
        return None, refs, unresolved, []
    strays = [
        token for token, value in extract_numbers(rendered_text) if not _is_allowed(value, allowed)
    ]
    if strays:
        return None, refs, [], strays
    return rendered_text.strip(), refs, [], []


def render_summary(
    text: str, evidence: Mapping[str, Fact], *, extra_allowed: Iterable[float] = ()
) -> SummaryResult:
    """Render placeholders and drop every sentence that cannot be verified."""
    allowed = allowed_numbers(evidence.values()) | {float(v) for v in extra_allowed}
    kept: list[str] = []
    result = SummaryResult(text="")
    for sentence in split_sentences(text):
        rendered, refs, unresolved, strays = render_sentence(sentence, evidence, allowed)
        result.refs.extend(refs)
        if rendered is None:
            result.dropped_sentences += 1
            result.unresolved.extend(unresolved)
            result.stray_numbers.extend(strays)
            continue
        if rendered:
            kept.append(rendered)
    result.text = " ".join(kept)
    return result


# --------------------------------------------------------------------------- #
# Card hydration
# --------------------------------------------------------------------------- #


def _fact_for(ref: str, kind: str, evidence: Mapping[str, Fact], prov: Provenance) -> Fact | None:
    fact = evidence.get(ref)
    if fact is None:
        prov.unresolved.append(ref)
        prov.issues.append(f"card ref {ref!r} does not resolve to any evidence")
        return None
    if fact.kind != kind:
        prov.issues.append(f"card ref {ref!r} is a {fact.kind}, expected {kind}")
        return None
    return fact


def _hydrate_card(
    draft: CardDraft, evidence: Mapping[str, Fact], allowed: set[float], prov: Provenance
) -> Card | None:
    if isinstance(draft, KpiDraft):
        fact = _fact_for(draft.ref, "metric", evidence, prov)
        if fact is None:
            return None
        note = draft.note
        if note:
            rendered, _, unresolved, strays = render_sentence(note, evidence, allowed)
            if rendered is None:
                prov.stray_numbers.extend(strays)
                prov.unresolved.extend(unresolved)
                prov.repaired = True
            note = rendered
        prov.refs.append(fact.ref)
        return KpiCard(
            ref=fact.ref,
            label=fact.label,
            display=fact.display,
            status=fact.status,
            delta_display=delta_display(fact.delta_pct),
            baseline_display=fact.baseline_display,
            compare_label=fact.compare_label,
            explanation=fact.explanation,
            note=note or None,
        )
    if isinstance(draft, TrendDraft):
        fact = _fact_for(draft.ref, "series", evidence, prov)
        if fact is None:
            return None
        prov.refs.append(fact.ref)
        return TrendCard(
            ref=fact.ref,
            title=draft.title or fact.label,
            unit=fact.unit,
            points=list(fact.points),
        )
    if isinstance(draft, CompareDraft):
        items: list[CompareItem] = []
        for ref in draft.refs:
            fact = _fact_for(ref, "metric", evidence, prov)
            if fact is not None:
                items.append(
                    CompareItem(
                        ref=ref,
                        label=fact.label,
                        display=fact.display,
                        value=fact.value,
                        status=fact.status,
                        delta_display=delta_display(fact.delta_pct),
                    )
                )
        if len(items) < 2:
            prov.issues.append("compare card needs at least two resolvable metric refs")
            return None
        prov.refs.extend(item.ref for item in items)
        return CompareCard(title=draft.title or "Comparison", items=items)
    if isinstance(draft, TableDraft):
        fact = _fact_for(draft.ref, "table", evidence, prov)
        if fact is None:
            return None
        rows = fact.rows[: draft.limit] if draft.limit else fact.rows
        prov.refs.append(fact.ref)
        return TableCard(
            ref=fact.ref, title=draft.title or fact.label, columns=list(fact.columns), rows=rows
        )
    if isinstance(draft, RiskListDraft):
        fact = _fact_for(draft.ref, "risk_list", evidence, prov)
        if fact is None:
            return None
        prov.refs.append(fact.ref)
        return RiskListCard(ref=fact.ref, title=draft.title or fact.label, items=list(fact.items))
    fact = _fact_for(draft.ref, "proposal", evidence, prov)
    if fact is None:
        return None
    prov.refs.append(fact.ref)
    pid = fact.data.get("proposal_id")
    return ProposalCard(
        ref=fact.ref,
        title=fact.label or "Proposed action",
        status=str(fact.data.get("status", "PENDING")),
        detail=fact.display,
        proposal_id=int(pid) if isinstance(pid, (int, float)) else None,
        proposal_type=fact.data.get("proposal_type"),
    )


def _clean_followups(followups: Iterable[str], evidence: Mapping[str, Fact]) -> list[str]:
    cleaned: list[str] = []
    for item in followups:
        text = " ".join(item.split())
        if not text or len(text) > MAX_FOLLOWUP_CHARS or text in cleaned:
            continue
        if find_stray_numbers(text, evidence):
            continue
        cleaned.append(text)
    return cleaned[:MAX_FOLLOWUPS]


def hydrate_answer(
    draft: AnswerDraft | Mapping[str, Any],
    evidence: Mapping[str, Fact | Mapping[str, Any]],
    *,
    extra_allowed: Iterable[float] = (),
) -> AnswerEnvelope:
    """Draft + evidence → verified envelope (rendered numbers, provenance, repair)."""
    store = EvidenceStore()
    store.add_many(dict(evidence))
    if not isinstance(draft, AnswerDraft):
        parsed = parse_answer_draft(draft)  # tolerant: oversize lists trimmed, bad cards skipped
        if parsed is None:
            raise ValueError("draft has no summary")
        draft = parsed
    allowed = allowed_numbers(store.values()) | {float(v) for v in extra_allowed}
    prov = Provenance()

    cards: list[Card] = []
    for card_draft in draft.cards[:MAX_CARDS]:
        card = _hydrate_card(card_draft, store, allowed, prov)
        if card is None:
            prov.dropped_cards += 1
        else:
            cards.append(card)

    summary = render_summary(draft.summary, store, extra_allowed=extra_allowed)
    prov.refs.extend(summary.refs)
    prov.unresolved.extend(summary.unresolved)
    prov.stray_numbers.extend(summary.stray_numbers)
    if summary.unresolved:
        prov.issues.append(f"unresolved placeholders: {sorted(set(summary.unresolved))}")
    if summary.stray_numbers:
        prov.issues.append(f"figures not backed by evidence: {summary.stray_numbers}")

    text = summary.text
    if summary.dropped_sentences:
        prov.repaired = True
        if not text:
            prov.cards_only = True
            text = CARDS_ONLY_SUMMARY if cards else NO_VERIFIED_SUMMARY
    elif not text:
        # An empty summary is not a provenance failure; give the cards a lead-in.
        text = CARDS_ONLY_SUMMARY if cards else ""

    prov.refs = list(dict.fromkeys(prov.refs))
    prov.unresolved = list(dict.fromkeys(prov.unresolved))
    return AnswerEnvelope(
        summary=text,
        cards=cards,
        followups=_clean_followups(draft.followups, store),
        provenance=prov,
    )


def parse_answer_draft(raw: Mapping[str, Any] | None) -> AnswerDraft | None:
    """Tolerant draft parser: bad cards are skipped, a usable summary is kept."""
    if not isinstance(raw, Mapping):
        return None
    summary = raw.get("summary")
    if not isinstance(summary, str):
        answer = raw.get("answer")  # the planned-pipeline schema
        if not isinstance(answer, str):
            return None
        summary = answer
    cards: list[Any] = []
    for item in raw.get("cards") or []:
        try:
            cards.append(AnswerDraft.model_validate({"summary": "", "cards": [item]}).cards[0])
        except (ValidationError, IndexError):
            continue
    followups = [f for f in (raw.get("followups") or []) if isinstance(f, str)]
    return AnswerDraft(summary=summary, cards=cards, followups=followups)


def proposal_fact_from_row(row: Mapping[str, Any]) -> Fact:
    """Fact for a freshly created PENDING proposal (planned pipeline + draft_action)."""
    pid = row.get("proposal_id")
    scope = row.get("entity_scope") or {}
    kind = str(row.get("proposal_type", "RESTOCK"))
    detail = str(row.get("recommended_action") or row.get("reason") or "")
    return Fact(
        ref=f"proposal:{pid}",
        kind="proposal",
        label=f"{kind.title().replace('_', ' ')} proposal",
        display=detail,
        data={
            "proposal_id": pid,
            "status": row.get("status", "PENDING"),
            "proposal_type": kind,
            "entity_scope": dict(scope) if isinstance(scope, Mapping) else {},
        },
    )
