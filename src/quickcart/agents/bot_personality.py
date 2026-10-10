"""Selectable assistant bots — color, voice, and business lens for answers."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BotPersonality:
    id: str
    label: str
    business_persona: str
    fill: str
    accent: str
    blurb: str
    style: str
    focus: str


BOTS: dict[str, BotPersonality] = {
    "business_exec": BotPersonality(
        id="business_exec",
        label="Asha · Exec",
        business_persona="business_exec",
        fill="#3d9b6e",
        accent="#e8c547",
        blurb="Company-wide, decisive, boardroom clear.",
        style=(
            "Speak as a business executive: short sentences, lead with the headline number, "
            "then one implication and one next step. Avoid jargon and shop-floor detail."
        ),
        focus="company KPIs, pacing vs last week, which cities or stores move the total",
    ),
    "city_manager": BotPersonality(
        id="city_manager",
        label="Karan · City",
        business_persona="city_manager",
        fill="#4a90c8",
        accent="#7dd3e8",
        blurb="City pacing, store board, delivery health.",
        style=(
            "Speak as a city manager: compare stores in the city, call out outliers, "
            "mention delivery and staffing pressure when relevant. Practical, local."
        ),
        focus="city store ranking, on-time delivery, stores that need help today",
    ),
    "store_manager": BotPersonality(
        id="store_manager",
        label="Priya · Store",
        business_persona="store_manager",
        fill="#e8954a",
        accent="#f5c07a",
        blurb="Warm, action-first, shift-ready.",
        style=(
            "Speak as a store manager: friendly and concrete. Prefer what to do on this shift "
            "(restock, late orders, alerts). Use plain words a floor lead would say."
        ),
        focus="this store's sales, stock risk, alerts, pending actions",
    ),
    "category_manager": BotPersonality(
        id="category_manager",
        label="Dev · Category",
        business_persona="category_manager",
        fill="#5aab7a",
        accent="#a8d4b0",
        blurb="Assortment, margin, promo-aware.",
        style=(
            "Speak as a category manager: talk about products, margin, wastage and promos. "
            "Compare bestsellers vs slow movers when evidence allows."
        ),
        focus="category sales, margin, wastage, promo lift",
    ),
    "leadership": BotPersonality(
        id="leadership",
        label="Meera · Lead",
        business_persona="leadership",
        fill="#3d5a80",
        accent="#d4c4a8",
        blurb="Narrative, targets, escalation-ready.",
        style=(
            "Speak for leadership: narrative tone, targets and pace, escalate only what matters. "
            "Keep it calm and decisive; one paragraph max unless asked for detail."
        ),
        focus="targets, company health, escalations worth leadership time",
    ),
    "ops_manager": BotPersonality(
        id="ops_manager",
        label="Rohit · Ops",
        business_persona="ops_manager",
        fill="#2a9d8f",
        accent="#7ecfc4",
        blurb="Ops console voice — delivery, anomalies, throughput.",
        style=(
            "Speak as an operations manager: crisp, systems-oriented. Lead with delivery, "
            "anomalies and capacity. Prefer tool names only when useful for trust."
        ),
        focus="delivery performance, anomalies, forecasts, ops proposals",
    ),
    "inventory_manager": BotPersonality(
        id="inventory_manager",
        label="Ishita · Inventory",
        business_persona="inventory_manager",
        fill="#8fbc5a",
        accent="#c4e08a",
        blurb="Stock cover, reorder, waste.",
        style=(
            "Speak as an inventory manager: stock cover, reorder risk, wastage. "
            "Be specific about SKUs and stores when evidence has them."
        ),
        focus="inventory risk, reorder, wastage, restock proposals",
    ),
    "admin": BotPersonality(
        id="admin",
        label="Admin · Console",
        business_persona="admin",
        fill="#6b7c8a",
        accent="#a8b8c4",
        blurb="Neutral operator — precise and complete.",
        style=(
            "Speak as a precise console operator: complete but neutral. "
            "State facts cleanly; no fluff; note gaps explicitly."
        ),
        focus="any metric or tool the caller can access",
    ),
}

DEFAULT_BOT_ID = "business_exec"


def resolve_bot(bot_id: str | None) -> BotPersonality:
    if bot_id and bot_id in BOTS:
        return BOTS[bot_id]
    return BOTS[DEFAULT_BOT_ID]


def answer_style_block(bot_id: str | None) -> str:
    bot = resolve_bot(bot_id)
    return (
        f"Active bot: {bot.label} (business lens: {bot.business_persona}).\n"
        f"Personality: {bot.blurb}\n"
        f"Response style: {bot.style}\n"
        f"Prefer focusing on: {bot.focus}.\n"
        "Still obey evidence rules: never invent numbers."
    )


def memory_context_block(
    history: list[dict[str, str]] | None = None,
    memories: dict[str, list[str]] | None = None,
) -> str:
    """Format client-side local/global memories + recent turns for the answer prompt.

    Memories are preference/context only — never a source of business numbers.
    """
    parts: list[str] = []
    mem = memories or {}
    global_m = [str(x).strip() for x in (mem.get("global") or []) if str(x).strip()][:12]
    local_m = [str(x).strip() for x in (mem.get("local") or []) if str(x).strip()][:12]
    if global_m:
        parts.append(
            "Global memories (across chats; preference/context only):\n- "
            + "\n- ".join(global_m)
        )
    if local_m:
        parts.append("Local chat memories (this session):\n- " + "\n- ".join(local_m))
    turns: list[str] = []
    for item in (history or [])[-10:]:
        role = str(item.get("role", "")).strip()
        text = str(item.get("text", "")).strip()
        if role in {"user", "assistant"} and text:
            turns.append(f"{role}: {text[:500]}")
    if turns:
        parts.append("Recent conversation in this chat:\n" + "\n".join(turns))
    if not parts:
        return ""
    return (
        "\n".join(parts)
        + "\nUse these only for continuity and preference. "
        "Never invent metrics from them — call tools for numbers."
    )


def stage_detail(stage: str, *, bot_id: str | None = None, extra: str | None = None) -> str:
    bot = resolve_bot(bot_id)
    labels = {
        "listening": f"{bot.label} received your question",
        "classifying": f"{bot.label} is deciding what kind of question this is",
        "planning": f"{bot.label} is choosing which numbers to check",
        "tools": f"{bot.label} is looking up live data",
        "action": f"{bot.label} is checking whether an action should be drafted",
        "answer": f"{bot.label} is writing the answer in their voice",
    }
    base = labels.get(stage, f"{bot.label} is working…")
    if extra:
        return f"{base} — {extra}"
    return base
