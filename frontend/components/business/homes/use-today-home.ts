"use client";

import { useMemo } from "react";
import { useBusiness } from "@/lib/business/business-context";
import type {
  MoneyResponse,
  ProductsResponse,
  StoreScorecardsResponse,
  TargetsResponse,
  TodayResponse,
} from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";
import {
  dailyPointsWithUsual,
} from "@/components/business/today-vs-usual-chart";

export const METRIC_LINKS: Record<string, string> = {
  sales_gmv: "/b/money",
  orders: "/b/stores",
  average_basket: "/b/money",
  on_time_rate: "/b/delivery",
  cancel_rate: "/b/stores",
  avg_delivery_minutes: "/b/delivery",
  stockout_risk_count: "/b/products?tab=running_low",
  active_customers: "/b/customers",
  repeat_rate: "/b/customers",
  availability_bestsellers: "/b/products?tab=bestsellers",
};

export function useTodayHome() {
  const { displayName, pinned, persona, personaView, scopes } = useBusiness();
  const today = useBusinessData<TodayResponse>("/today", { refreshMs: 15_000 });
  const stores = useBusinessData<StoreScorecardsResponse>("/stores/scorecards");
  const money = useBusinessData<MoneyResponse>("/money");
  const targets = useBusinessData<TargetsResponse>("/targets");
  const products = useBusinessData<ProductsResponse>("/products?tab=running_low&limit=8");

  const tiles = useMemo(() => {
    if (!today.data) return [];
    const all = [...today.data.headline, ...today.data.more];
    const picked = pinned
      .slice(0, 4)
      .map((key) => all.find((m) => m.key === key))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
    return picked.length > 0 ? picked : today.data.headline.slice(0, 4);
  }, [today.data, pinned]);

  const chartPoints = useMemo(
    () => (money.data ? dailyPointsWithUsual(money.data.daily_trend) : []),
    [money.data],
  );

  const cityRollup = useMemo(() => {
    if (!stores.data) return [];
    const byCity = new Map<
      string,
      { city: string; sales: number; late: number; n: number; salesDisplay: string }
    >();
    for (const s of stores.data.stores) {
      const city = s.city || "Unknown";
      const cur = byCity.get(city) ?? {
        city,
        sales: 0,
        late: 0,
        n: 0,
        salesDisplay: "—",
      };
      const salesMetric = s.metrics.sales_gmv;
      const lateMetric = s.metrics.late_rate ?? s.metrics.on_time_rate;
      cur.sales += salesMetric?.value ?? 0;
      cur.late += lateMetric?.value ?? 0;
      cur.n += 1;
      if (salesMetric?.display) cur.salesDisplay = salesMetric.display;
      byCity.set(city, cur);
    }
    return [...byCity.values()]
      .map((c) => ({
        city: c.city,
        sales: c.sales,
        late_rate: c.n ? c.late / c.n : 0,
        stores: c.n,
        sales_display: c.salesDisplay,
      }))
      .sort((a, b) => b.sales - a.sales);
  }, [stores.data]);

  const scopeHint = useMemo(() => {
    const first = scopes[0];
    if (!first) return "All stores";
    if (first.scope_type === "company") return "Company-wide";
    if (first.scope_type === "city") return first.scope_value;
    if (first.scope_type === "store") return `Store ${first.scope_value}`;
    if (first.scope_type === "category") return first.scope_value;
    return first.scope_value;
  }, [scopes]);

  return {
    displayName,
    persona,
    personaView,
    scopeHint,
    today,
    stores,
    money,
    targets,
    products,
    tiles,
    chartPoints,
    cityRollup,
  };
}
