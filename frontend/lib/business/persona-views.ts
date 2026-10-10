/**
 * Layout registry for business personas. Same APIs and gold data; different
 * home composition, nav priority, KPI defaults, and hierarchy crumbs.
 */

import type { BusinessNavItem } from "@/lib/business-nav";
import { BUSINESS_NAV } from "@/lib/business-nav";
import type { BusinessPersona } from "@/lib/business/types";

export type PersonaHomeId =
  | "exec_scorecard"
  | "city_pacing"
  | "store_shift"
  | "category_matrix"
  | "narrative_digest";

export type PersonaPrimaryViz =
  | "exec_scorecard"
  | "city_map_board"
  | "store_shift"
  | "category_matrix"
  | "narrative_digest";

export type TodaySectionId =
  | "briefing"
  | "kpis"
  | "attention"
  | "board"
  | "chart"
  | "ask"
  | "checklist"
  | "actions"
  | "products"
  | "delivery"
  | "targets"
  | "cities"
  | "risks";

export type PersonaView = {
  persona: BusinessPersona;
  homeId: PersonaHomeId;
  /** Ordered primary nav hrefs (subset of BUSINESS_NAV). */
  navHrefs: string[];
  /** Mobile bottom tabs (4 real + More is added by the shell). */
  tabHrefs: string[];
  pinnedDefaults: string[];
  hierarchy: string[];
  primaryViz: PersonaPrimaryViz;
  sections: TodaySectionId[];
  /** Landmark test id / aria for Playwright. */
  landmark: string;
};

function navByHref(href: string): BusinessNavItem {
  const item = BUSINESS_NAV.find((n) => n.href === href);
  if (!item) throw new Error(`Unknown business nav href: ${href}`);
  return item;
}

export const PERSONA_VIEWS: Record<BusinessPersona, PersonaView> = {
  business_exec: {
    persona: "business_exec",
    homeId: "exec_scorecard",
    navHrefs: [
      "/b/today",
      "/b/stores",
      "/b/ask",
      "/b/actions",
      "/b/delivery",
      "/b/money",
      "/b/learn",
      "/b/settings",
    ],
    tabHrefs: ["/b/today", "/b/stores", "/b/ask", "/b/actions"],
    pinnedDefaults: ["sales_gmv", "orders", "on_time_rate", "cancel_rate"],
    hierarchy: ["Company", "City", "Store"],
    primaryViz: "exec_scorecard",
    sections: ["briefing", "kpis", "board", "attention", "ask", "checklist"],
    landmark: "exec-home",
  },
  city_manager: {
    persona: "city_manager",
    homeId: "city_pacing",
    navHrefs: [
      "/b/today",
      "/b/stores",
      "/b/targets",
      "/b/money",
      "/b/delivery",
      "/b/reports",
      "/b/ask",
      "/b/settings",
    ],
    tabHrefs: ["/b/today", "/b/stores", "/b/targets", "/b/money"],
    pinnedDefaults: ["sales_gmv", "orders", "on_time_rate", "average_basket"],
    hierarchy: ["City", "Store"],
    primaryViz: "city_map_board",
    sections: ["briefing", "targets", "kpis", "board", "delivery", "chart", "ask"],
    landmark: "city-home",
  },
  store_manager: {
    persona: "store_manager",
    homeId: "store_shift",
    navHrefs: [
      "/b/today",
      "/b/products",
      "/b/delivery",
      "/b/actions",
      "/b/stores",
      "/b/ask",
      "/b/settings",
    ],
    tabHrefs: ["/b/today", "/b/products", "/b/delivery", "/b/actions"],
    pinnedDefaults: ["sales_gmv", "orders", "on_time_rate", "stockout_risk_count"],
    hierarchy: ["Store", "SKU"],
    primaryViz: "store_shift",
    sections: ["briefing", "kpis", "products", "delivery", "actions", "ask"],
    landmark: "store-home",
  },
  category_manager: {
    persona: "category_manager",
    homeId: "category_matrix",
    navHrefs: [
      "/b/today",
      "/b/products",
      "/b/money",
      "/b/targets",
      "/b/stores",
      "/b/ask",
      "/b/settings",
    ],
    tabHrefs: ["/b/today", "/b/products", "/b/money", "/b/targets"],
    pinnedDefaults: ["sales_gmv", "average_basket", "stockout_risk_count", "cancel_rate"],
    hierarchy: ["Category", "SKU", "Store"],
    primaryViz: "category_matrix",
    sections: ["briefing", "kpis", "products", "chart", "attention", "ask"],
    landmark: "category-home",
  },
  leadership: {
    persona: "leadership",
    homeId: "narrative_digest",
    navHrefs: [
      "/b/today",
      "/b/reports",
      "/b/ask",
      "/b/targets",
      "/b/money",
      "/b/stores",
      "/b/settings",
    ],
    tabHrefs: ["/b/today", "/b/reports", "/b/ask", "/b/targets"],
    pinnedDefaults: ["sales_gmv", "orders", "on_time_rate", "active_customers"],
    hierarchy: ["Company", "City"],
    primaryViz: "narrative_digest",
    sections: ["briefing", "kpis", "cities", "targets", "risks", "ask"],
    landmark: "leadership-home",
  },
};

export function personaViewFor(persona: BusinessPersona): PersonaView {
  return PERSONA_VIEWS[persona] ?? PERSONA_VIEWS.business_exec;
}

export function personaPrimaryNav(persona: BusinessPersona): BusinessNavItem[] {
  return personaViewFor(persona).navHrefs.map(navByHref);
}

export function personaMobileTabs(persona: BusinessPersona): BusinessNavItem[] {
  return personaViewFor(persona).tabHrefs.map(navByHref);
}

export function personaMoreNav(persona: BusinessPersona): BusinessNavItem[] {
  const primary = new Set(personaViewFor(persona).navHrefs);
  const tabs = new Set(personaViewFor(persona).tabHrefs);
  // Everything not in mobile tabs goes to More; keep persona nav order first.
  const ordered = [
    ...personaViewFor(persona).navHrefs.filter((h) => !tabs.has(h)),
    ...BUSINESS_NAV.map((n) => n.href).filter((h) => !primary.has(h) && !tabs.has(h)),
  ];
  const seen = new Set<string>();
  return ordered
    .filter((h) => {
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    })
    .map(navByHref);
}

export function hierarchyCrumb(persona: BusinessPersona): string {
  return personaViewFor(persona).hierarchy.join(" → ");
}
