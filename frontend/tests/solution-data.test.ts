import { describe, expect, it } from "vitest";
import { bizStoreDetail, OPEN_ORDERS_AT_RISK, ORDERS_FORECAST, QUALITY_TREND, SALES_FORECAST, storeDemandForecast, storeLateOrders, BIZ, MODEL_RUNS } from "@/lib/solution-data";
import { DEMO_ANOMALIES, DEMO_DELIVERY_PREDICTION, DEMO_FORECAST_MAPE, DEMO_QUALITY_SCORE } from "@/lib/demo";
import { DEMO_LAYERS_CATALOG } from "@/lib/layer-cube-types";

const DAY_MS = 86_400_000;

function nextDay(iso: string): string {
  return new Date(Date.parse(iso) + DAY_MS).toISOString().slice(0, 10);
}

describe("solution sample data", () => {
  it("keeps the leadership sales chart continuous and leaves today out of the average", () => {
    const { history, days } = SALES_FORECAST;
    expect(history.length).toBeGreaterThan(1);
    expect(days).toHaveLength(7);
    for (let i = 1; i < history.length; i++) expect(history[i].at).toBe(nextDay(history[i - 1].at));
    expect(days[0].at).toBe(nextDay(history[history.length - 1].at));
    for (const day of days) {
      expect(day.low).toBeGreaterThanOrEqual(0);
      expect(day.low).toBeLessThanOrEqual(day.sales);
      expect(day.high).toBeGreaterThanOrEqual(day.sales);
    }
  });

  it("makes each store's hourly forecast add up, and lists that store's running-low line first", () => {
    for (const card of BIZ.scorecards.stores) {
      const forecast = storeDemandForecast(card.store_id);
      const late = storeLateOrders(card.store_id);
      expect(forecast.hourly.reduce((sum, row) => sum + row.orders, 0)).toBe(forecast.orders);
      expect(forecast.low).toBeGreaterThanOrEqual(0);
      expect(forecast.low).toBeLessThanOrEqual(forecast.orders);
      expect(forecast.high).toBeGreaterThanOrEqual(forecast.orders);
      const own = bizStoreDetail(card.store_id)?.running_low[0]?.name;
      if (own) expect(forecast.products[0]?.name).toBe(own);
      expect(new Set(late.orders.map((order) => order.placed)).size).toBe(late.orders.length);
      expect(late.orders.every((order) => order.placed.startsWith("14:"))).toBe(true);
      expect(late.orders.every((order) => order.probability >= 0.04 && order.probability <= 0.94)).toBe(true);
    }
  });

  it("keeps the one scored order and covers every other city with sample orders", () => {
    const real = OPEN_ORDERS_AT_RISK.find((order) => order.id === String(DEMO_DELIVERY_PREDICTION.order_id));
    expect(real?.probability).toBe(DEMO_DELIVERY_PREDICTION.late_probability);
    expect(new Set(OPEN_ORDERS_AT_RISK.map((order) => order.id)).size).toBe(OPEN_ORDERS_AT_RISK.length);
    expect(new Set(OPEN_ORDERS_AT_RISK.map((order) => order.city)).size).toBe(10);
  });

  it("anchors generated ops series on the real fixture totals", () => {
    expect(ORDERS_FORECAST.days[0].at).toBe(nextDay(ORDERS_FORECAST.history.at(-1)!.at));
    for (const day of ORDERS_FORECAST.days) {
      expect(day.low).toBeLessThanOrEqual(day.value);
      expect(day.high).toBeGreaterThanOrEqual(day.value);
    }
    expect(QUALITY_TREND.at(-1)?.score).toBe(DEMO_QUALITY_SCORE);
    expect(QUALITY_TREND.reduce((sum, row) => sum + row.quarantined, 0)).toBe(
      DEMO_LAYERS_CATALOG.layer_summaries.quarantine?.row_estimate,
    );
    expect(MODEL_RUNS.at(-1)?.mape).toBe(DEMO_FORECAST_MAPE);
    expect(MODEL_RUNS.at(-1)?.anomalies).toBe(DEMO_ANOMALIES.length);
  });
});
