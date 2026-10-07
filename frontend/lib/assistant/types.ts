/**
 * Hydrated assistant answer cards, mirroring `src/quickcart/agents/cards.py`
 * (the JSON the backend sends over SSE as `card` events and in `done`).
 * Every figure here is already rendered by the backend: never format or
 * recompute numbers on the client.
 */

export type CardStatus = "good" | "watch" | "bad" | "unknown";

export interface SeriesPoint {
  at: string;
  value: number | null;
  display: string;
}

export interface RiskItem {
  title: string;
  detail: string;
  severity: "watch" | "bad";
  store_id: number | null;
  ref: string | null;
}

export interface KpiCard {
  type: "kpi";
  ref: string;
  label: string;
  display: string;
  status: CardStatus;
  delta_display: string | null;
  baseline_display: string | null;
  compare_label: string | null;
  explanation: string | null;
  note: string | null;
}

export interface TrendCard {
  type: "trend";
  ref: string;
  title: string;
  unit: string | null;
  points: SeriesPoint[];
}

export interface CompareItem {
  ref: string;
  label: string;
  display: string;
  value: number | null;
  status: CardStatus;
  delta_display: string | null;
}

export interface CompareCard {
  type: "compare";
  title: string;
  items: CompareItem[];
}

export interface TableCard {
  type: "table";
  ref: string;
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface RiskListCard {
  type: "risk_list";
  ref: string;
  title: string;
  items: RiskItem[];
}

export interface ProposalCard {
  type: "proposal";
  ref: string;
  title: string;
  status: string;
  detail: string;
  proposal_id: number | null;
  proposal_type: string | null;
}

export type AssistantCard =
  | KpiCard
  | TrendCard
  | CompareCard
  | TableCard
  | RiskListCard
  | ProposalCard;

export const CARD_TYPES = ["kpi", "trend", "compare", "table", "risk_list", "proposal"] as const;

export interface Provenance {
  refs: string[];
  unresolved: string[];
  stray_numbers: string[];
  dropped_cards: number;
  repaired: boolean;
  cards_only: boolean;
  issues: string[];
}

export interface ToolStartEvent {
  name: string;
  step?: number;
}

/** Narrow an untyped SSE payload to a known card, or null when it is unusable. */
export function parseCard(raw: unknown): AssistantCard | null {
  if (!raw || typeof raw !== "object") return null;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string" || !(CARD_TYPES as readonly string[]).includes(type)) return null;
  return raw as AssistantCard;
}

/** Tolerant provenance parser; missing fields fall back to empty values. */
export function parseProvenance(raw: unknown): Provenance | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Provenance>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    refs: list(p.refs),
    unresolved: list(p.unresolved),
    stray_numbers: list(p.stray_numbers),
    dropped_cards: typeof p.dropped_cards === "number" ? p.dropped_cards : 0,
    repaired: Boolean(p.repaired),
    cards_only: Boolean(p.cards_only),
    issues: list(p.issues),
  };
}
