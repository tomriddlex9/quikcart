/** Selectable bots — color, personality, and business lens. */

export type BotShape =
  | "slab"
  | "hex"
  | "round_square"
  | "triangles"
  | "diamond"
  | "chevron";

export type ExperienceSide = "business" | "ops";

export interface BotStyle {
  id: string;
  label: string;
  displayName: string;
  shape: BotShape;
  fill: string;
  accent: string;
  eye: string;
  side: ExperienceSide;
  /** Business / ops persona this bot speaks as. */
  businessPersona: string;
  blurb: string;
  personality: string;
  focus: string;
  suggestedQuestions: string[];
}

const CATALOG: Record<string, BotStyle> = {
  business_exec: {
    id: "business_exec",
    label: "Exec",
    displayName: "Asha",
    shape: "slab",
    fill: "#3d9b6e",
    accent: "#e8c547",
    eye: "#111316",
    side: "business",
    businessPersona: "business_exec",
    blurb: "Company-wide, decisive, boardroom clear.",
    personality: "Headline first. One implication. One next step.",
    focus: "Company KPIs and pacing",
    suggestedQuestions: [
      "How are sales today compared with last week?",
      "Which cities are behind pace?",
    ],
  },
  city_manager: {
    id: "city_manager",
    label: "City",
    displayName: "Karan",
    shape: "hex",
    fill: "#4a90c8",
    accent: "#7dd3e8",
    eye: "#111316",
    side: "business",
    businessPersona: "city_manager",
    blurb: "City pacing, store board, delivery health.",
    personality: "Compare stores. Call out outliers. Stay local.",
    focus: "City store board & delivery",
    suggestedQuestions: [
      "Which stores need help right now?",
      "Why are deliveries slow?",
    ],
  },
  store_manager: {
    id: "store_manager",
    label: "Store",
    displayName: "Priya",
    shape: "round_square",
    fill: "#e8954a",
    accent: "#f5c07a",
    eye: "#111316",
    side: "business",
    businessPersona: "store_manager",
    blurb: "Warm, action-first, shift-ready.",
    personality: "Friendly floor voice. What to do on this shift.",
    focus: "Store alerts, stock, actions",
    suggestedQuestions: [
      "What is about to run out?",
      "How is my store doing today?",
    ],
  },
  category_manager: {
    id: "category_manager",
    label: "Category",
    displayName: "Dev",
    shape: "triangles",
    fill: "#5aab7a",
    accent: "#a8d4b0",
    eye: "#111316",
    side: "business",
    businessPersona: "category_manager",
    blurb: "Assortment, margin, promo-aware.",
    personality: "Talk products, margin, wastage, promos.",
    focus: "Category & promo health",
    suggestedQuestions: [
      "How is dairy performing this week?",
      "Where is wastage worst?",
    ],
  },
  leadership: {
    id: "leadership",
    label: "Lead",
    displayName: "Meera",
    shape: "diamond",
    fill: "#3d5a80",
    accent: "#d4c4a8",
    eye: "#111316",
    side: "business",
    businessPersona: "leadership",
    blurb: "Narrative, targets, escalation-ready.",
    personality: "Calm narrative. Escalate only what matters.",
    focus: "Targets & escalations",
    suggestedQuestions: [
      "What should leadership care about today?",
      "How are we pacing to target?",
    ],
  },
  ops_manager: {
    id: "ops_manager",
    label: "Ops",
    displayName: "Rohit",
    shape: "chevron",
    fill: "#2a9d8f",
    accent: "#7ecfc4",
    eye: "#111316",
    side: "ops",
    businessPersona: "ops_manager",
    blurb: "Delivery, anomalies, throughput.",
    personality: "Crisp ops voice. Systems over stories.",
    focus: "Delivery & anomalies",
    suggestedQuestions: [
      "Which deliveries look late?",
      "Any active anomalies?",
    ],
  },
  inventory_manager: {
    id: "inventory_manager",
    label: "Inventory",
    displayName: "Ishita",
    shape: "chevron",
    fill: "#8fbc5a",
    accent: "#c4e08a",
    eye: "#111316",
    side: "ops",
    businessPersona: "inventory_manager",
    blurb: "Stock cover, reorder, waste.",
    personality: "SKU-precise. Reorder and cover first.",
    focus: "Stock risk & restock",
    suggestedQuestions: [
      "What is about to run out?",
      "Which SKUs need restock?",
    ],
  },
  admin: {
    id: "admin",
    label: "Admin",
    displayName: "Admin",
    shape: "chevron",
    fill: "#6b7c8a",
    accent: "#a8b8c4",
    eye: "#111316",
    side: "ops",
    businessPersona: "admin",
    blurb: "Neutral operator — precise and complete.",
    personality: "Neutral. Complete. No fluff.",
    focus: "Full console access",
    suggestedQuestions: [
      "How are sales today compared with last week?",
      "Summarize system health.",
    ],
  },
};

export const ALL_BOTS: BotStyle[] = Object.values(CATALOG);

export function botStyleFor(persona: string | undefined | null): BotStyle {
  if (persona && CATALOG[persona]) return CATALOG[persona];
  return CATALOG.business_exec;
}

export function botsForSide(side: ExperienceSide): BotStyle[] {
  return ALL_BOTS.filter((b) => b.side === side);
}

export function defaultBotIdFor(
  side: ExperienceSide,
  persona?: string | null,
): string {
  if (persona && CATALOG[persona]) return persona;
  return side === "ops" ? "ops_manager" : "business_exec";
}

export const BOT_EMOTION_LABEL = {
  idle: "Ready",
  listen: "Listening",
  think: "Thinking",
  speak: "Speaking",
  error: "Trouble",
} as const;

export const STAGE_LABEL: Record<string, string> = {
  listening: "Received",
  classifying: "Understanding",
  planning: "Planning",
  tools: "Looking up data",
  action: "Checking actions",
  answer: "Writing answer",
};
