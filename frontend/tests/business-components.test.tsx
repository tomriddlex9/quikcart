import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricTile } from "@/components/business/metric-tile";
import { StatusBadge } from "@/components/business/status-badge";
import { JourneyPanel } from "@/components/business/journey-panel";
import { demoBusinessPayload, demoMetric } from "@/lib/business/demo-business";
import { normalizeJourneyLink } from "@/lib/business/journeys";
import { businessRouteFor, opsRouteFor } from "@/lib/business-nav";
import type { TodayResponse } from "@/lib/business/types";

describe("StatusBadge", () => {
  it("shows words, not just colour", () => {
    render(<StatusBadge status="bad" />);
    const badge = screen.getByText("Needs help");
    expect(badge).toBeInTheDocument();
    expect(badge.closest("[data-status]")).toHaveAttribute("data-status", "bad");
  });

  it("accepts a custom label", () => {
    render(<StatusBadge status="good" label="Fine" />);
    expect(screen.getByText("Fine")).toBeInTheDocument();
  });
});

describe("MetricTile", () => {
  it("renders value, plain-language change and status", () => {
    const metric = demoMetric("sales_gmv", 420_000, 380_000);
    render(<MetricTile metric={metric} />);
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByText("₹4.2L")).toBeInTheDocument();
    expect(screen.getByText("Up 11% on the same day last week")).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("What does this mean?")).toBeInTheDocument();
  });

  it("flags a bad metric", () => {
    render(<MetricTile metric={demoMetric("on_time_rate", 0.7, 0.9)} compact />);
    expect(screen.getByTestId("metric-tile")).toHaveAttribute("data-status", "bad");
    expect(screen.queryByText("What does this mean?")).not.toBeInTheDocument();
  });
});

describe("JourneyPanel", () => {
  it("shows progress and a Finish button on the last step", () => {
    render(
      <JourneyPanel
        step={{
          journey_id: "A",
          n: 4,
          total: 4,
          title: "Review",
          body: "Body",
          link: null,
          metric_keys: [],
          next_n: null,
          prev_n: 3,
        }}
        onBack={() => {}}
        onNext={() => {}}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finish/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back/ })).toBeEnabled();
  });
});

describe("demo fixtures", () => {
  it("scope the data per persona", () => {
    const exec = demoBusinessPayload("business_exec", "/stores/scorecards") as { stores: unknown[] };
    const city = demoBusinessPayload("city_manager", "/stores/scorecards") as { stores: unknown[] };
    const store = demoBusinessPayload("store_manager", "/stores/scorecards") as { stores: unknown[] };
    expect(exec.stores.length).toBeGreaterThan(city.stores.length);
    expect(store.stores).toHaveLength(1);
  });

  it("covers every business endpoint", () => {
    for (const path of [
      "/today",
      "/stores/scorecards",
      "/stores/1",
      "/products?tab=slow",
      "/delivery/health",
      "/customers/health",
      "/money",
      "/alerts",
      "/metrics",
      "/journeys",
      "/journeys/A/steps/1",
    ]) {
      expect(demoBusinessPayload("business_exec", path), path).toBeDefined();
    }
    const today = demoBusinessPayload("business_exec", "/today") as TodayResponse;
    expect(today.headline).toHaveLength(4);
  });

  it("does not leak out-of-scope stores", () => {
    expect(demoBusinessPayload("store_manager", "/stores/1")).toBeUndefined();
    expect(demoBusinessPayload("store_manager", "/stores/8")).toBeDefined();
  });
});

describe("navigation helpers", () => {
  it("maps routes between experiences", () => {
    expect(opsRouteFor("/b/actions")).toBe("/proposals");
    expect(opsRouteFor("/b/stores/3")).toBe("/map");
    expect(businessRouteFor("/proposals")).toBe("/b/actions");
    expect(businessRouteFor("/map")).toBe("/b/stores");
    expect(businessRouteFor("/somewhere-else")).toBe("/b/today");
  });

  it("rewrites legacy journey links", () => {
    expect(normalizeJourneyLink("/business/today")).toBe("/b/today");
    expect(normalizeJourneyLink("/business/products?tab=running_low")).toBe("/b/products?tab=running_low");
    expect(normalizeJourneyLink("/business/metrics/late_rate")).toBe("/b/learn");
    expect(normalizeJourneyLink("/business/alerts")).toBe("/b/actions");
    expect(normalizeJourneyLink(null)).toBeNull();
  });
});
