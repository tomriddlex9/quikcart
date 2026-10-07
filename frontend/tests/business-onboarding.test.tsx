import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OnboardingStepper } from "@/components/business/onboarding-stepper";
import { GOALS, metricsForGoals } from "@/components/business/goal-picker";
import { RoleCardGroup } from "@/components/business/role-card-group";
import { withSpotlight } from "@/lib/business/journeys";

describe("metricsForGoals", () => {
  it("returns nothing for no goals", () => {
    expect(metricsForGoals([])).toEqual([]);
  });

  it("puts each goal's lead number first and caps at four", () => {
    const keys = metricsForGoals(["sales", "delivery", "stock", "customers"]);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(["sales_gmv", "on_time_rate", "stockout_risk_count", "active_customers"]);
  });

  it("only uses known goals", () => {
    expect(GOALS.map((g) => g.id)).toContain("sales");
    expect(metricsForGoals(["nope"])).toEqual([]);
  });
});

describe("withSpotlight", () => {
  it("adds a spot param for known pages and keeps the query", () => {
    expect(withSpotlight("/b/today")).toBe("/b/today?spot=attention");
    expect(withSpotlight("/b/products?tab=slow")).toBe("/b/products?tab=slow&spot=products");
  });
  it("leaves other links alone", () => {
    expect(withSpotlight("/b/money")).toBe("/b/money");
  });
});

describe("OnboardingStepper", () => {
  it("marks the current step", () => {
    render(<OnboardingStepper steps={["A", "B", "C"]} current={1} />);
    expect(screen.getByText("Step 2 of 3: B")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
  });
});

describe("RoleCardGroup", () => {
  const roles = [
    { value: "a", label: "Role A" },
    { value: "b", label: "Role B" },
  ];
  it("shows every role when unlocked", () => {
    render(<RoleCardGroup roles={roles} value="a" onChange={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
  it("shows only the signed-in role when locked", () => {
    render(<RoleCardGroup roles={roles} value="b" onChange={() => {}} locked />);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByText("Role B")).toBeInTheDocument();
  });
});
