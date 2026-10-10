/**
 * Single frontend catalog of demo personas. Labels/blurbs still come from the
 * API (/auth/demo-personas); this file owns landing routes, highlights, and the
 * business-vs-ops sets used by middleware and offline fixtures.
 */

export type ExperienceSide = "business" | "ops";

export type PersonaScope = {
  scope_type: "company" | "city" | "store" | "category";
  scope_value: string;
};

export type PersonaCatalogEntry = {
  persona: string;
  label: string;
  displayName: string;
  side: ExperienceSide;
  landing: string;
  landingLabel: string;
  highlights: string[];
  /** Offline/demo scopes used when the API payload has no scopes. */
  scopes: PersonaScope[];
};

export const PERSONA_CATALOG: readonly PersonaCatalogEntry[] = [
  {
    persona: "business_exec",
    label: "Business Executive",
    displayName: "Asha Rao",
    side: "business",
    landing: "/b/today",
    landingLabel: "Today",
    highlights: ["Company-wide KPIs", "Drill into any store", "Ask in plain English"],
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
  {
    persona: "city_manager",
    label: "City Manager",
    displayName: "Karan Mehta",
    side: "business",
    landing: "/b/today",
    landingLabel: "Today",
    highlights: ["Bengaluru store board", "Delivery health", "Morning briefing"],
    scopes: [{ scope_type: "city", scope_value: "Bengaluru" }],
  },
  {
    persona: "store_manager",
    label: "Store Manager",
    displayName: "Priya Nair",
    side: "business",
    landing: "/b/today",
    landingLabel: "Today",
    highlights: ["Your store today", "What's running low", "Actions to approve"],
    scopes: [{ scope_type: "store", scope_value: "8" }],
  },
  {
    persona: "category_manager",
    label: "Category Manager",
    displayName: "Dev Malhotra",
    side: "business",
    landing: "/b/today",
    landingLabel: "Today",
    highlights: ["Dairy category view", "Bestsellers & slow movers", "Promo-ready numbers"],
    scopes: [{ scope_type: "category", scope_value: "Dairy" }],
  },
  {
    persona: "leadership",
    label: "Leadership",
    displayName: "Meera Kapoor",
    side: "business",
    landing: "/b/today",
    landingLabel: "Today",
    highlights: ["Targets & pace", "Approve escalations", "Money health"],
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
  {
    persona: "ops_manager",
    label: "Operations Manager",
    displayName: "Rohit Shah",
    side: "ops",
    landing: "/",
    landingLabel: "Overview",
    highlights: ["Live order stream", "Read-only SQL", "Pipeline status"],
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
  {
    persona: "inventory_manager",
    label: "Inventory Manager",
    displayName: "Ishita Das",
    side: "ops",
    landing: "/",
    landingLabel: "Overview",
    highlights: ["Restock proposals", "Approve actions", "Agent suggestions"],
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
  {
    persona: "admin",
    label: "Administrator",
    displayName: "Tom Riddle",
    side: "ops",
    landing: "/",
    landingLabel: "Overview",
    highlights: ["Users & audit", "System map", "Cannot approve proposals"],
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
] as const;

export const BUSINESS_PERSONA_IDS: ReadonlySet<string> = new Set(
  PERSONA_CATALOG.filter((p) => p.side === "business").map((p) => p.persona),
);

export const OPS_PERSONA_IDS: ReadonlySet<string> = new Set(
  PERSONA_CATALOG.filter((p) => p.side === "ops").map((p) => p.persona),
);

export function personaEntry(persona: string | undefined | null): PersonaCatalogEntry | undefined {
  if (!persona) return undefined;
  return PERSONA_CATALOG.find((p) => p.persona === persona);
}

export function personasForSide(side: ExperienceSide): PersonaCatalogEntry[] {
  return PERSONA_CATALOG.filter((p) => p.side === side);
}

export function isBusinessPersonaId(persona: string | undefined | null): boolean {
  return !!persona && BUSINESS_PERSONA_IDS.has(persona);
}

export function isOpsPersonaId(persona: string | undefined | null): boolean {
  return !!persona && OPS_PERSONA_IDS.has(persona);
}

/** Human-readable scope for chips and login cards. */
export function scopeLabel(
  scopes: ReadonlyArray<{ scope_type: string; scope_value: string }> | undefined | null,
): string {
  const first = scopes?.[0];
  if (!first || first.scope_type === "company") return "All stores";
  switch (first.scope_type) {
    case "city":
      return `${first.scope_value} stores`;
    case "store":
      return `Store ${first.scope_value}`;
    case "category":
      return `${first.scope_value} category`;
    default:
      return first.scope_value;
  }
}

export function initials(displayName: string): string {
  const parts = displayName.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
