import { describe, expect, it } from "vitest";
import { opsTourPlan } from "@/lib/ops-tour";

describe("opsTourPlan", () => {
  it("returns a 3-step plan for ops personas", () => {
    for (const persona of ["ops_manager", "inventory_manager", "admin"]) {
      const plan = opsTourPlan(persona);
      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
      expect(plan!.steps.every((s) => s.href.startsWith("/") && s.title && s.body)).toBe(true);
    }
  });

  it("returns null for business personas", () => {
    expect(opsTourPlan("business_exec")).toBeNull();
    expect(opsTourPlan(undefined)).toBeNull();
  });

  it("sends inventory managers to proposals", () => {
    const plan = opsTourPlan("inventory_manager")!;
    expect(plan.steps.some((s) => s.href === "/proposals")).toBe(true);
  });
});
