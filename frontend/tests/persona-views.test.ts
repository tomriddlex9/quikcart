import { describe, expect, it } from "vitest";
import {
  hierarchyCrumb,
  personaMobileTabs,
  personaMoreNav,
  personaPrimaryNav,
  personaViewFor,
  PERSONA_VIEWS,
} from "@/lib/business/persona-views";
import type { BusinessPersona } from "@/lib/business/types";

const PERSONAS: BusinessPersona[] = [
  "business_exec",
  "city_manager",
  "store_manager",
  "category_manager",
  "leadership",
];

describe("persona view registry", () => {
  it("defines a distinct home for every business persona", () => {
    const homes = new Set(PERSONAS.map((p) => personaViewFor(p).homeId));
    expect(homes.size).toBe(PERSONAS.length);
  });

  it("orders store manager nav around products and delivery", () => {
    const hrefs = personaPrimaryNav("store_manager").map((n) => n.href);
    expect(hrefs.slice(0, 4)).toEqual([
      "/b/today",
      "/b/products",
      "/b/delivery",
      "/b/actions",
    ]);
  });

  it("orders leadership nav around reports and ask", () => {
    const hrefs = personaPrimaryNav("leadership").map((n) => n.href);
    expect(hrefs.slice(0, 4)).toEqual(["/b/today", "/b/reports", "/b/ask", "/b/targets"]);
  });

  it("keeps more nav non-empty and free of mobile tab duplicates", () => {
    for (const persona of PERSONAS) {
      const tabs = new Set(personaMobileTabs(persona).map((t) => t.href));
      const more = personaMoreNav(persona);
      expect(more.length).toBeGreaterThan(0);
      for (const item of more) {
        expect(tabs.has(item.href)).toBe(false);
      }
    }
  });

  it("exposes hierarchy crumbs", () => {
    expect(hierarchyCrumb("business_exec")).toContain("Company");
    expect(hierarchyCrumb("store_manager")).toBe("Store → SKU");
    expect(PERSONA_VIEWS.city_manager.landmark).toBe("city-home");
  });
});
