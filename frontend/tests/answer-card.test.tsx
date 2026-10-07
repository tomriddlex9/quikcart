import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerCard } from "@/components/assistant/answer-card";
import { HowIGotThis } from "@/components/assistant/how-i-got-this";
import { parseCard } from "@/lib/assistant/types";
import type { KpiCard } from "@/lib/assistant/types";

const kpi: KpiCard = {
  type: "kpi",
  ref: "metric:sales_gmv",
  label: "Sales",
  display: "₹4.2L",
  status: "good",
  delta_display: "+10.5%",
  baseline_display: "₹3.8L",
  compare_label: "vs last week",
  explanation: null,
  note: null,
};

describe("AnswerCard", () => {
  it("renders a kpi card with backend-rendered figures and plain status", () => {
    render(<AnswerCard card={kpi} />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("₹4.2L")).toBeInTheDocument();
    expect(screen.getByText("+10.5%")).toBeInTheDocument();
    expect(screen.getByText(/vs last week/)).toBeInTheDocument();
  });

  it("ignores unknown card types", () => {
    expect(parseCard({ type: "mystery" })).toBeNull();
    expect(parseCard(kpi)).not.toBeNull();
  });
});

describe("HowIGotThis", () => {
  it("explains sources without jargon", () => {
    render(
      <HowIGotThis
        provenance={{
          refs: ["a", "b"],
          unresolved: [],
          stray_numbers: [],
          dropped_cards: 0,
          repaired: false,
          cards_only: false,
          issues: [],
        }}
        tools={["get_sales"]}
      />,
    );
    expect(screen.getByText("How I got this")).toBeInTheDocument();
    expect(screen.getByText(/2 sources/)).toBeInTheDocument();
  });
});
