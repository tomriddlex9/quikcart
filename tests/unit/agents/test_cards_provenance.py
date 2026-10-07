"""Answer cards + provenance: refs resolve, numbers render from facts, strays are repaired."""

from __future__ import annotations

import pytest

from quickcart.agents.cards import (
    CARDS_ONLY_SUMMARY,
    NO_VERIFIED_SUMMARY,
    AnswerDraft,
    EvidenceStore,
    Fact,
    RiskItem,
    SeriesPoint,
    extract_numbers,
    find_stray_numbers,
    hydrate_answer,
    parse_answer_draft,
)

pytestmark = pytest.mark.unit


def _evidence() -> EvidenceStore:
    store = EvidenceStore()
    store.add(
        Fact(
            ref="metric:sales_gmv:all",
            label="Sales",
            value=250000.0,
            display="₹2.50 L",
            unit="inr",
            status="good",
            delta_pct=25.0,
            baseline_display="₹2.00 L",
            compare_label="the same day last week",
            explanation="Sales are ₹2.50 L, up 25.0% on the same day last week.",
        )
    )
    store.add(
        Fact(
            ref="metric:on_time_rate:all",
            label="On-time rate",
            value=0.78,
            display="78.0%",
            unit="pct",
            status="watch",
            delta_pct=-15.2,
        )
    )
    store.add(
        Fact(
            ref="series:sales_gmv:all",
            kind="series",
            label="Sales · all stores",
            points=[SeriesPoint(at="2026-09-21", value=1.0, display="₹1.00 L")],
        )
    )
    store.add(
        Fact(
            ref="stores:on_time_rate",
            kind="table",
            label="Stores by on-time rate",
            columns=["Store", "On-time rate"],
            rows=[
                {"Store": "Koramangala", "On-time rate": "70.0%"},
                {"Store": "Other", "On-time rate": "90.0%"},
            ],
        )
    )
    store.add(
        Fact(
            ref="risk:attention",
            kind="risk_list",
            label="Needs attention",
            items=[RiskItem(title="Check on-time rate", detail="78.0%", severity="watch")],
        )
    )
    store.add(
        Fact(
            ref="proposal:42",
            kind="proposal",
            label="Restock proposal",
            display="Restock 50 units",
            data={"proposal_id": 42, "status": "PENDING"},
        )
    )
    return store


def _draft(**kw) -> AnswerDraft:
    return AnswerDraft.model_validate({"summary": "", "cards": [], **kw})


def test_placeholders_render_from_facts_and_all_card_types_hydrate() -> None:
    draft = _draft(
        summary="Sales are {{metric:sales_gmv:all}}, {{metric:sales_gmv:all|delta}} on last week.",
        cards=[
            {"type": "kpi", "ref": "metric:sales_gmv:all"},
            {"type": "trend", "ref": "series:sales_gmv:all"},
            {"type": "compare", "refs": ["metric:sales_gmv:all", "metric:on_time_rate:all"]},
            {"type": "table", "ref": "stores:on_time_rate", "limit": 1},
            {"type": "risk_list", "ref": "risk:attention"},
            {"type": "proposal", "ref": "proposal:42"},
        ],
        followups=["Which stores are weakest?"],
    )
    env = hydrate_answer(draft, _evidence())
    assert env.summary == "Sales are ₹2.50 L, +25.0% on last week."
    kinds = [c.type for c in env.cards]
    assert kinds == ["kpi", "trend", "compare", "table", "risk_list", "proposal"]
    kpi = env.cards[0]
    assert kpi.display == "₹2.50 L" and kpi.delta_display == "+25.0%" and kpi.status == "good"
    assert len(env.cards[3].rows) == 1  # limit honoured
    assert env.cards[5].proposal_id == 42
    assert env.provenance.clean and not env.provenance.repaired
    assert "metric:sales_gmv:all" in env.provenance.refs
    assert env.followups == ["Which stores are weakest?"]


def test_unresolved_card_refs_are_dropped_and_recorded() -> None:
    env = hydrate_answer(
        _draft(
            summary="Here you go.",
            cards=[
                {"type": "kpi", "ref": "metric:ghost:all"},
                {"type": "kpi", "ref": "metric:sales_gmv:all"},
                {"type": "trend", "ref": "metric:sales_gmv:all"},  # wrong kind
            ],
        ),
        _evidence(),
    )
    assert [c.ref for c in env.cards] == ["metric:sales_gmv:all"]
    assert env.provenance.dropped_cards == 2
    assert env.provenance.unresolved == ["metric:ghost:all"]
    assert not env.provenance.clean


def test_compare_needs_two_resolvable_refs() -> None:
    env = hydrate_answer(
        _draft(cards=[{"type": "compare", "refs": ["metric:sales_gmv:all", "metric:nope:all"]}]),
        _evidence(),
    )
    assert env.cards == [] and env.provenance.dropped_cards == 1


def test_stray_number_sentence_is_dropped_others_kept() -> None:
    env = hydrate_answer(
        _draft(
            summary="Sales are {{metric:sales_gmv:all}}. Revenue will hit 9,99,000 tomorrow. "
            "Delivery needs a look."
        ),
        _evidence(),
    )
    assert env.summary == "Sales are ₹2.50 L. Delivery needs a look."
    assert env.provenance.repaired and env.provenance.stray_numbers == ["9,99,000"]
    assert not env.provenance.cards_only


def test_all_sentences_stray_falls_back_to_cards_only() -> None:
    env = hydrate_answer(
        _draft(
            summary="Sales were 12345 yesterday.",
            cards=[{"type": "kpi", "ref": "metric:sales_gmv:all"}],
        ),
        _evidence(),
    )
    assert env.provenance.cards_only and env.summary == CARDS_ONLY_SUMMARY
    assert len(env.cards) == 1


def test_stray_numbers_without_any_card_say_nothing_was_verified() -> None:
    env = hydrate_answer(_draft(summary="We sold 77 units."), EvidenceStore())
    assert env.summary == NO_VERIFIED_SUMMARY and env.cards == []


def test_unresolved_placeholder_drops_its_sentence() -> None:
    env = hydrate_answer(
        _draft(summary="Sales are {{metric:ghost:all}}. Delivery needs a look."),
        _evidence(),
    )
    assert env.summary == "Delivery needs a look."
    assert env.provenance.unresolved == ["metric:ghost:all"]


def test_numbers_present_in_evidence_are_allowed_in_free_text() -> None:
    store = _evidence()
    assert find_stray_numbers("On-time rate is 78.0%.", store) == []
    assert find_stray_numbers("Sales reached ₹2.5 L.", store) == []  # rounding tolerance
    assert find_stray_numbers("Sales reached ₹3 L.", store) == ["₹3 L"]
    assert find_stray_numbers("Compared with the last 7 days on 2026-09-22.", store) == []
    assert find_stray_numbers("Two stores.", store) == []  # words are not figures


def test_extract_numbers_scales_indian_units() -> None:
    values = dict(extract_numbers("₹2.50 L, ₹1.2 Cr, 4,350 and 12.5%"))
    assert values["₹2.50 L"] == pytest.approx(250000)
    assert values["₹1.2 Cr"] == pytest.approx(12_000_000)
    assert values["4,350"] == 4350 and values["12.5%"] == 12.5


def test_card_note_with_stray_number_is_removed() -> None:
    env = hydrate_answer(
        _draft(cards=[{"type": "kpi", "ref": "metric:sales_gmv:all", "note": "Up 999 percent!"}]),
        _evidence(),
    )
    assert env.cards[0].note is None and env.provenance.repaired


def test_followups_with_figures_or_overlong_text_are_dropped() -> None:
    env = hydrate_answer(
        {
            "summary": "",
            "followups": ["Is 4242 good?", "x" * 200, "What changed?", "What changed?", "a", "b"],
        },
        _evidence(),
    )
    assert env.followups == ["What changed?", "a", "b"]


def test_parse_answer_draft_is_tolerant() -> None:
    draft = parse_answer_draft(
        {
            "summary": "ok",
            "cards": [{"type": "kpi", "ref": "r"}, {"type": "mystery", "ref": "r"}, {"nope": 1}],
            "followups": ["q", 5],
        }
    )
    assert draft is not None and [c.type for c in draft.cards] == ["kpi"]
    assert draft.followups == ["q"]
    assert parse_answer_draft({"answer": "planned-style"}).summary == "planned-style"
    assert parse_answer_draft(None) is None and parse_answer_draft({"x": 1}) is None


def test_hydrate_accepts_plain_dicts() -> None:
    env = hydrate_answer(
        {"summary": "{{metric:on_time_rate:all}}", "cards": []},
        {"metric:on_time_rate:all": {"ref": "metric:on_time_rate:all", "display": "78.0%"}},
    )
    assert env.summary == "78.0%"
