import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricTile } from "@/components/business/metric-tile";
import { ProvenanceModeToggle } from "@/components/business/kpi-journey/provenance-mode-toggle";
import { KpiJourneyInspector } from "@/components/business/kpi-journey/kpi-journey-inspector";
import { ProvenanceProvider } from "@/lib/business/provenance-context";
import { PROVENANCE_MODE_KEY } from "@/lib/business/provenance";
import { demoMetric } from "@/lib/business/demo-business";

function wrap(ui: ReactNode) {
  return render(
    <ProvenanceProvider>
      {ui}
      <KpiJourneyInspector />
    </ProvenanceProvider>,
  );
}

afterEach(() => {
  window.localStorage.removeItem(PROVENANCE_MODE_KEY);
  vi.unstubAllGlobals();
});

describe("provenance mode", () => {
  it("toggles and marks metric tiles as inspectable", () => {
    wrap(
      <>
        <ProvenanceModeToggle />
        <MetricTile metric={demoMetric("sales_gmv", 420_000, 380_000)} href="/b/money" />
      </>,
    );
    const tile = screen.getByTestId("metric-tile");
    expect(tile).toHaveAttribute("data-provenance", "off");
    fireEvent.click(screen.getByTestId("provenance-mode-toggle"));
    expect(tile).toHaveAttribute("data-provenance", "on");
    expect(window.localStorage.getItem(PROVENANCE_MODE_KEY)).toBe("1");
  });

  it("opens the KPI journey inspector when a tile is clicked in mode", async () => {
    const lineage = {
      metric_key: "sales_gmv",
      label: "Sales",
      plain_description: "Money customers spent",
      formula_text: "Sum of order totals",
      gold_source: "gold_store_hourly_metrics.gmv",
      unit: "inr",
      steps: [
        {
          layer: "raw",
          table: "orders",
          fqn: "raw.orders",
          role: "source",
          columns: ["order_id", "total_amount"],
          row_count: null,
          ops: [],
        },
        {
          layer: "gold",
          table: "gold_store_hourly_metrics",
          fqn: "gold.gold_store_hourly_metrics",
          role: "metric",
          columns: ["gmv"],
          row_count: null,
          column: "gmv",
          aggregation: "Sum of order totals",
          ops: [
            {
              id: "gold-build-store_hourly_metrics",
              name: "build_gold_store_hourly_metrics",
              layer: "gold",
              engine: "pyspark",
              summary: "Hourly store KPIs",
              code: "SELECT store_id, SUM(gmv) FROM silver_orders",
              inputs: ["silver.silver_orders"],
              outputs: ["gold.gold_store_hourly_metrics"],
              source_path: "src/quickcart/lakehouse/gold/marts.py::gold_store_hourly_metrics",
              rules: [],
            },
          ],
        },
      ],
      edges: [{ from: "raw.orders", to: "gold.gold_store_hourly_metrics", kind: "batch" }],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => lineage,
      }),
    );

    wrap(
      <>
        <ProvenanceModeToggle />
        <MetricTile metric={demoMetric("sales_gmv", 420_000, 380_000)} />
      </>,
    );
    fireEvent.click(screen.getByTestId("provenance-mode-toggle"));
    fireEvent.click(screen.getByTestId("metric-tile"));

    await waitFor(() => {
      expect(screen.getByTestId("kpi-journey-inspector")).toBeInTheDocument();
    });
    expect(screen.getByTestId("kpi-journey-rail")).toHaveTextContent("orders");
    expect(screen.getByTestId("kpi-journey-rail")).toHaveTextContent("gold_store_hourly_metrics");
    await waitFor(() => {
      expect(screen.getByTestId("kpi-journey-code")).toHaveTextContent("SUM(gmv)");
    });
  });
});
