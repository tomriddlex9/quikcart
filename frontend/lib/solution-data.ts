// Data for the /solution app.
//
// Only the bundled dummy data is used, unchanged:
//   Business persona   -> lib/business/demo-business.ts (8 neighbourhood stores, 7 Oct 2026)
//   Operations persona -> lib/demo.ts, lib/geo-demo.ts, lib/live-types.ts, lib/layer-cube-types.ts
//                         (10 city stores, 22 Sep 2026)
// This mirrors the full platform, where the business console and the ops console each read
// their own fixture set. Anything the dummy data does not contain is rendered as an empty state.

import { demoBusinessPayload } from "@/lib/business/demo-business";
import type {
  BusinessPersona,
  CustomersHealthResponse,
  DeliveryHealthResponse,
  MoneyResponse,
  ProductsResponse,
  StoreDetail,
  StoreScorecardsResponse,
  TargetsResponse,
  TodayResponse,
} from "@/lib/business/types";
import {
  DEMO_ACTIVE_DELIVERIES,
  DEMO_ACTIVITY_LOG,
  DEMO_ANOMALIES,
  DEMO_DELIVERY_PREDICTION,
  DEMO_DEMAND_FORECASTS,
  DEMO_FORECAST_MAPE,
  DEMO_INVENTORY_RISKS,
  DEMO_KPIS,
  DEMO_OPEN_TICKETS,
  DEMO_PAYMENT_FAILURE_RATE,
  DEMO_PROPOSALS,
  DEMO_QUALITY_SCORE,
  DEMO_STORES,
  DEMO_TREND,
} from "@/lib/demo";
import { DEMO_GEO_STORES } from "@/lib/geo-demo";
import { DEMO_LAYERS_CATALOG } from "@/lib/layer-cube-types";
import { DEMO_LIVE_PIPELINE, DEMO_LIVE_SNAPSHOT } from "@/lib/live-types";
import { MODEL_CARDS } from "@/lib/model-cards";

// ── Menu ───────────────────────────────────────────────────────────────────

export type SolutionView = "business" | "ops";

export interface SubPersona {
  id: string;
  label: string;
  person: string;
  question: string;
}

export const MENU: Record<SolutionView, SubPersona[]> = {
  business: [
    { id: "leadership", label: "Leadership", person: "Meera Kapoor", question: "How is the company doing today?" },
    { id: "revenue", label: "Business & Revenue Manager", person: "Karan Mehta", question: "Which stores and products drive revenue?" },
    { id: "store", label: "Store Manager", person: "Priya Nair", question: "What do I fix in my store today?" },
  ],
  ops: [
    { id: "operations", label: "Operations Manager", person: "Rohit Shah", question: "Is every store running smoothly?" },
    { id: "inventory", label: "Inventory & Planning", person: "Ishita Das", question: "Will we have the right stock?" },
    { id: "data", label: "Data & Model Health", person: "Tom Riddle", question: "Can we trust the data and models?" },
  ],
};

export const AS_OF: Record<SolutionView, string> = {
  business: "7 Oct 2026",
  ops: "22 Sep 2026",
};

// ── Business (business console dummy data) ─────────────────────────────────

const company = (path: string) => demoBusinessPayload("leadership" as BusinessPersona, path);

/** The Store Manager dashboard opens on this store (the store_manager scope in the dummy data). */
export const STORE_MANAGER_STORE_ID = 8;

export const BIZ = {
  today: company("/today") as TodayResponse,
  scorecards: company("/stores/scorecards") as StoreScorecardsResponse,
  money: company("/money") as MoneyResponse,
  customers: company("/customers/health") as CustomersHealthResponse,
  targets: company("/targets") as TargetsResponse,
  delivery: company("/delivery/health") as DeliveryHealthResponse,
  bestsellers: company("/products?tab=bestsellers") as ProductsResponse,
  runningLow: company("/products?tab=running_low") as ProductsResponse,
};

export function bizStoreDetail(storeId: number): StoreDetail | null {
  return (company(`/stores/${storeId}`) as StoreDetail | undefined) ?? null;
}

// ── Leadership: illustrative 7-day sales forecast ──────────────────────────
// Built only from the Leadership page's own 14-day sales trend. Method: each
// forecast day = average sales of the same weekday in the full days on record;
// range = ± the average week-on-week change in that same trend. Today is left
// out because it is still in progress.

const DAY_MS = 86_400_000;

function buildSalesForecast() {
  const points = BIZ.money.daily_trend.map((p) => ({ at: p.at, sales: p.sales ?? 0 }));
  // Completed days only. Today stays on the chart so the axis does not skip a day,
  // but it is still in progress and is not part of the average.
  const full = points.slice(0, -1);
  const todayMs = Date.parse(points[points.length - 1]?.at ?? "");
  const byDate = new Map(full.map((p) => [p.at, p.sales]));

  const changes: number[] = [];
  for (const p of full) {
    const prev = byDate.get(new Date(Date.parse(p.at) - 7 * DAY_MS).toISOString().slice(0, 10));
    if (prev) changes.push(Math.abs(p.sales / prev - 1));
  }
  const range = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;

  const days = Number.isNaN(todayMs)
    ? []
    : Array.from({ length: 7 }, (_, i) => {
        const t = todayMs + (i + 1) * DAY_MS;
        const same = full.filter((p) => ((t - Date.parse(p.at)) / DAY_MS) % 7 === 0).map((p) => p.sales);
        const sales = Math.round(same.reduce((a, b) => a + b, 0) / Math.max(same.length, 1));
        return {
          at: new Date(t).toISOString().slice(0, 10),
          sales,
          low: Math.max(0, Math.round(sales * (1 - range))),
          high: Math.round(sales * (1 + range)),
        };
      });

  const total = days.reduce((a, d) => a + d.sales, 0);
  const last7 = full.slice(-7).reduce((a, p) => a + p.sales, 0);
  const peak = days.reduce((a, d) => (d.sales > a.sales ? d : a), days[0] ?? { at: "", sales: 0, low: 0, high: 0 });
  return { history: points, days, range, total, vsLast7: last7 ? total / last7 - 1 : null, peak };
}

export const SALES_FORECAST = buildSalesForecast();

// ── Store Manager: late-order risk and tomorrow's demand, per store ────────
// Generated deterministically from each store's own scorecard and trend in the
// business dummy data (seeded by store id), so a store always shows the same
// values and weaker stores show more risk.

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface AtRiskOrder {
  id: string;
  placed: string;
  promisedMin: number;
  distanceKm: number;
  items: number;
  probability: number;
  reasons: string[];
}

export function storeLateOrders(storeId: number): { orders: AtRiskOrder[]; likelyLate: number } {
  const card = BIZ.scorecards.stores.find((s) => s.store_id === storeId);
  const onTime = card?.metrics.on_time_rate?.value ?? 0.9;
  const minutes = card?.metrics.avg_delivery_minutes?.value ?? 16;
  const usualMinutes = card?.metrics.avg_delivery_minutes?.baseline_value ?? minutes;
  const ridersStretched = minutes > usualMinutes * 1.1;
  const rand = seeded(storeId * 7919 + 17);

  const base = logit(Math.min(Math.max(1 - onTime, 0.03), 0.6));
  // Business "now" is 15:00 IST. Keep placements in the hour before that,
  // and do not clamp several orders onto the same minute.
  let minute = 8 + Math.floor(rand() * 4);
  const orders: AtRiskOrder[] = Array.from({ length: 6 }, (_, i) => {
    minute += 3 + Math.floor(rand() * 3);
    const distanceKm = Math.round((0.6 + rand() * 3.3) * 10) / 10;
    const promisedMin = rand() < 0.45 ? 10 : 15;
    const items = 2 + Math.floor(rand() * 16);
    const parts: [number, string][] = [
      [1.1 * (distanceKm - 1.8), `Long distance`],
      [promisedMin === 10 ? 0.8 : -0.3, "Tight 10-min promise"],
      [0.07 * (items - 8), `Large basket (${items} items)`],
      [ridersStretched ? 0.9 : 0, "Riders stretched"],
    ];
    const score = base + 0.6 + parts.reduce((a, [v]) => a + v, 0) + (rand() - 0.5) * 0.6;
    const probability = Math.min(Math.max(sigmoid(score), 0.04), 0.94);
    const reasons = parts
      .filter(([v]) => v > 0.25)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map(([, r]) => r);
    return {
      id: `QC-${81400 + storeId * 113 + i * 7 + Math.floor(rand() * 5)}`,
      placed: `14:${String(Math.min(minute, 59)).padStart(2, "0")}`,
      promisedMin,
      distanceKm,
      items,
      probability: Math.round(probability * 100) / 100,
      reasons: reasons.length ? reasons : ["Normal conditions"],
    };
  }).sort((a, b) => b.probability - a.probability);

  return { orders, likelyLate: orders.filter((o) => o.probability >= 0.5).length };
}

// Typical quick-commerce day: quiet overnight, morning and lunch bumps, evening peak.
const HOUR_PROFILE = [0.6, 0.3, 0.2, 0.15, 0.2, 0.5, 1.2, 2.6, 3.4, 3.1, 2.8, 3.0, 3.9, 4.1, 3.3, 3.0, 3.4, 4.6, 6.4, 7.2, 6.5, 4.8, 2.9, 1.5];

export function storeDemandForecast(storeId: number) {
  const detail = bizStoreDetail(storeId);
  const trend = detail?.daily_trend ?? [];
  const full = trend.slice(0, -1);
  const rand = seeded(storeId * 104729 + 3);

  const changes: number[] = [];
  for (let i = 7; i < full.length; i++) {
    const prev = full[i - 7].orders ?? 0;
    if (prev) changes.push(Math.abs((full[i].orders ?? 0) / prev - 1));
  }
  const range = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0.05;

  const todayIso = trend[trend.length - 1]?.at ?? "";
  const tomorrow = todayIso ? new Date(Date.parse(todayIso) + DAY_MS).toISOString().slice(0, 10) : "";
  const same = todayIso
    ? full.filter((p) => ((Date.parse(tomorrow) - Date.parse(p.at)) / DAY_MS) % 7 === 0)
    : [];
  const avg = (k: "orders" | "sales") =>
    same.length ? same.reduce((a, p) => a + (p[k] ?? 0), 0) / same.length : 0;
  const orders = Math.round(avg("orders"));
  const sales = Math.round(avg("sales"));

  const wiggle = HOUR_PROFILE.map((v) => v * (0.9 + rand() * 0.2));
  const shares = allocate(orders, wiggle);
  const hourly = shares.map((qty, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, orders: qty }));
  const peak = hourly.reduce((a, h) => (h.orders > a.orders ? h : a), hourly[0]);

  const weights = [0.11, 0.085, 0.07, 0.062, 0.055];
  const seen = new Set<string>();
  const picked: { name: string; category: string }[] = [];
  for (const p of [...(detail?.running_low ?? []), ...BIZ.bestsellers.items]) {
    if (!p.name || seen.has(p.name)) continue;
    seen.add(p.name);
    picked.push({ name: p.name, category: p.category });
    if (picked.length === weights.length) break;
  }
  const products = picked.map((p, i) => ({
    name: p.name,
    category: p.category,
    units: Math.max(0, Math.round(orders * weights[i] * (0.85 + rand() * 0.3))),
  }));

  return {
    tomorrow,
    orders,
    sales,
    low: Math.max(0, Math.round(orders * (1 - range))),
    high: Math.round(orders * (1 + range)),
    hourly,
    peak,
    products,
  };
}

/** Split `total` across `weights` so the parts sum to `total`. */
function allocate(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((v) => Math.floor(v));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Sales and orders summed per city from the store scorecards. */
export const SALES_BY_CITY = Object.values(
  BIZ.scorecards.stores.reduce<Record<string, { city: string; sales: number; orders: number }>>((acc, s) => {
    const city = s.city ?? "Other";
    acc[city] ??= { city, sales: 0, orders: 0 };
    acc[city].sales += s.metrics.sales_gmv?.value ?? 0;
    acc[city].orders += s.metrics.orders?.value ?? 0;
    return acc;
  }, {}),
).sort((a, b) => b.sales - a.sales);

// ── Operations (ops console dummy data) ────────────────────────────────────

const CITY_BY_STORE = new Map(DEMO_GEO_STORES.map((s) => [s.store_id, s.city]));
export function cityOf(storeId: number | undefined | null): string {
  return (storeId != null && CITY_BY_STORE.get(storeId)) || `Store ${storeId ?? "?"}`;
}

export const OPS = {
  kpis: DEMO_KPIS,
  trend: DEMO_TREND,
  activeDeliveries: DEMO_ACTIVE_DELIVERIES,
  openTickets: DEMO_OPEN_TICKETS,
  paymentFailureRate: DEMO_PAYMENT_FAILURE_RATE,
  forecastMape: DEMO_FORECAST_MAPE,
  qualityScore: DEMO_QUALITY_SCORE,
  live: DEMO_LIVE_SNAPSHOT,
  pipeline: DEMO_LIVE_PIPELINE,
  layers: DEMO_LAYERS_CATALOG,
  activity: DEMO_ACTIVITY_LOG,
  models: MODEL_CARDS,
  prediction: { ...DEMO_DELIVERY_PREDICTION, city: cityOf(DEMO_DELIVERY_PREDICTION.store_id) },
};

export const OPS_STORES = DEMO_STORES.map((s) => {
  const geo = DEMO_GEO_STORES.find((g) => g.store_id === s.store_id);
  return { ...s, city: cityOf(s.store_id), latitude: geo?.latitude ?? 0, longitude: geo?.longitude ?? 0 };
}).sort((a, b) => b.late_rate - a.late_rate);

/** Emergency restock threshold from the Inventory SOP (hours of stock cover). */
export const EMERGENCY_COVER_HOURS = 4;

export const RISKS = [...DEMO_INVENTORY_RISKS]
  .map((r) => ({ ...r, city: cityOf(r.store_id), emergency: r.stock_cover_hours < EMERGENCY_COVER_HOURS }))
  .sort((a, b) => a.stock_cover_hours - b.stock_cover_hours);

export const FORECASTS = DEMO_DEMAND_FORECASTS.map((f) => ({ ...f, city: cityOf(f.store_id) }));

const SEVERITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const ANOMALY_LABEL: Record<string, string> = {
  PAYMENT_FAILURE_SPIKE: "Payment failures spiked",
  CANCELLATION_SPIKE: "Cancellations spiked",
  DEMAND_SPIKE: "Order surge",
  DELIVERY_DURATION_SPIKE: "Deliveries slowed down",
  INVENTORY_MOVEMENT_OUTLIER: "Unusual stock adjustments",
};
export const ANOMALIES = [...DEMO_ANOMALIES]
  .map((a) => ({ ...a, city: cityOf(a.store_id), title: ANOMALY_LABEL[a.anomaly_type] ?? a.anomaly_type }))
  .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));

export const PROPOSALS = DEMO_PROPOSALS.map((p) => {
  const scope = p.entity_scope as { store_id?: number; quantity?: number };
  return {
    id: p.proposal_id,
    type: String(p.proposal_type),
    action: p.recommended_action,
    city: cityOf(scope.store_id),
    quantity: scope.quantity ?? null,
    status: String(p.status),
    createdAt: p.created_at ?? null,
  };
});

// ── Operations sample data (generated from the ops dummy data) ─────────────
// Each block below derives from numbers already on its own Operations page and
// is seeded, so it is stable between visits. Swap this section for API calls
// when the backend runs.

const ISO_DAY = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Open orders scored by the late-delivery model: the one real scored order plus generated ones. */
export const OPEN_ORDERS_AT_RISK = (() => {
  const rand = seeded(88041);
  const statuses = ["Placed", "Picking", "Out for delivery"];
  const scoredAt = Date.parse(DEMO_DELIVERY_PREDICTION.predicted_at ?? "2026-09-22T18:30:00Z");
  const real = {
    id: String(DEMO_DELIVERY_PREDICTION.order_id ?? 88041),
    city: cityOf(DEMO_DELIVERY_PREDICTION.store_id),
    status: "Placed",
    at: DEMO_DELIVERY_PREDICTION.predicted_at ?? null,
    promisedMin: 15,
    distanceKm: 2.6,
    probability: DEMO_DELIVERY_PREDICTION.late_probability ?? 0.73,
    reason: "Store busy · long distance",
  };
  // Every city except the real scored order's city (Bengaluru, store 3).
  const picks = [8, 4, 6, 2, 10, 1, 7, 5, 9];
  const generated = picks.map((storeId, i) => {
    const store = OPS_STORES.find((s) => s.store_id === storeId);
    const lateRate = store?.late_rate ?? 0.072;
    const slowAlert = ANOMALIES.some((a) => a.store_id === storeId && a.anomaly_type === "DELIVERY_DURATION_SPIKE");
    const distanceKm = Math.round((0.7 + rand() * 3.1) * 10) / 10;
    const promisedMin = rand() < 0.4 ? 10 : 15;
    const score =
      logit(lateRate) + 1.0 * (distanceKm - 1.8) + (promisedMin === 10 ? 0.7 : -0.2) + (slowAlert ? 1.2 : 0) + 1.1 + (rand() - 0.5) * 0.8;
    const probability = Math.round(Math.min(Math.max(sigmoid(score), 0.05), 0.93) * 100) / 100;
    const reason = probability < 0.3
      ? "Normal conditions"
      : slowAlert
      ? "Deliveries slowed in this city"
      : distanceKm > 2.6
        ? "Long distance"
        : promisedMin === 10
          ? "Tight 10-min promise"
          : lateRate > 0.09
            ? "City running late today"
            : "Peak-hour load";
    return {
      id: String(88042 + i * 3 + Math.floor(rand() * 3)),
      city: store?.city ?? `Store ${storeId}`,
      status: statuses[Math.floor(rand() * statuses.length)],
      at: new Date(scoredAt + (1 + i) * 60_000 + Math.floor(rand() * 50_000)).toISOString(),
      promisedMin,
      distanceKm,
      probability,
      reason,
    };
  });
  return [real, ...generated].sort((a, b) => b.probability - a.probability);
})();

/** Orders forecast for the next 7 days from the 30-day ops trend (same-weekday average). */
export const ORDERS_FORECAST = (() => {
  const history = DEMO_TREND.map((d) => ({ at: d.day, value: d.orders }));
  const byDate = new Map(history.map((h) => [h.at, h.value]));
  const last = Date.parse(history[history.length - 1].at);
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = last + (i + 1) * DAY_MS;
    const same = [7, 14, 21, 28].map((k) => byDate.get(ISO_DAY(t - k * DAY_MS))).filter((v): v is number => v != null);
    const value = Math.round(same.reduce((a, b) => a + b, 0) / Math.max(same.length, 1));
    return {
      at: ISO_DAY(t),
      value,
      low: Math.max(0, Math.round(value * (1 - DEMO_FORECAST_MAPE))),
      high: Math.round(value * (1 + DEMO_FORECAST_MAPE)),
    };
  });
  const total = days.reduce((a, d) => a + d.value, 0);
  const last7 = history.slice(-7).reduce((a, h) => a + h.value, 0);
  const peak = days.reduce((a, d) => (d.value > a.value ? d : a), days[0]);
  return { history: history.slice(-21), days, total, vsLast7: last7 ? total / last7 - 1 : null, peak };
})();

/** Daily data quality over 14 days: score ends at the real 92/100, quarantined rows add up to the real total. */
export const QUALITY_TREND = (() => {
  const rand = seeded(4120);
  const end = Date.parse(DEMO_LIVE_PIPELINE.generated_at.slice(0, 10));
  const quarantineTotal = DEMO_LAYERS_CATALOG.layer_summaries.quarantine?.row_estimate ?? 4120;
  const weights = Array.from({ length: 14 }, () => 0.7 + rand() * 0.6);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const rows = weights.map((w, i) => ({
    at: ISO_DAY(end - (13 - i) * DAY_MS),
    score: i === 13 ? DEMO_QUALITY_SCORE : Math.round((89.5 + rand() * 5) * 10) / 10,
    quarantined: Math.round((quarantineTotal * w) / wsum),
  }));
  const drift = quarantineTotal - rows.reduce((a, r) => a + r.quarantined, 0);
  rows[13].quarantined += drift;
  return rows;
})();

/** Weekly training runs; the latest values match the ops dummy data where it has them. */
export const MODEL_RUNS = (() => {
  const end = Date.parse(DEMO_LIVE_PIPELINE.generated_at.slice(0, 10));
  const mape = [0.114, 0.108, 0.103, 0.099, 0.095, 0.091, 0.089, DEMO_FORECAST_MAPE];
  const rocAuc = [0.781, 0.787, 0.796, 0.801, 0.808, 0.815, 0.822, 0.829];
  const prAuc = [0.312, 0.328, 0.341, 0.352, 0.368, 0.381, 0.394, 0.407];
  const anomalies = [3, 6, 4, 2, 7, 4, 3, DEMO_ANOMALIES.length];
  return mape.map((m, i) => ({
    at: ISO_DAY(end - (7 - i) * 7 * DAY_MS),
    mape: m,
    rocAuc: rocAuc[i],
    prAuc: prAuc[i],
    anomalies: anomalies[i],
  }));
})();

export const LATEST_MODEL_SCORE: Record<string, string> = (() => {
  const last = MODEL_RUNS[MODEL_RUNS.length - 1];
  return {
    "delivery-delay": `ROC-AUC ${last.rocAuc.toFixed(2)} · PR-AUC ${last.prAuc.toFixed(2)}`,
    "demand-forecast": `MAPE ${(last.mape * 100).toFixed(1)}%`,
    "anomaly-detection": `${last.anomalies} anomalies flagged`,
  };
})();

// ── Late-delivery prediction, explained ────────────────────────────────────

const DELIVERY_MODEL = MODEL_CARDS.find((m) => m.id === "delivery-delay");

const FEATURE_LABEL: Record<string, string> = {
  placed_hour: "Hour of the order",
  placed_dow: "Day of the week",
  is_weekend: "Weekend",
  basket_units: "Units in the basket",
  item_count: "Number of items",
  subtotal: "Order value",
  delivery_fee: "Delivery fee",
  promo_applied: "Promo used",
  payment_method: "Payment method",
  promised_lead_minutes: "Promised delivery time",
  distance_km: "Distance",
  store_orders_last_7d_avg: "Store's recent order volume",
  store_late_rate_before: "Store's past late rate",
  riders_on_shift: "Riders on shift",
  same_hour_orders: "Orders in the same hour",
};

const predictionStore = OPS_STORES.find((s) => s.store_id === DEMO_DELIVERY_PREDICTION.store_id);

export const PREDICTION_EXPLAINED = {
  storeLateRate: predictionStore?.late_rate ?? null,
  /** Model inputs from the model card, in plain words. */
  features: (DELIVERY_MODEL?.featuresDetail ?? [])
    .flatMap((group) => group.split(",").map((f) => f.trim()))
    .map((f) => FEATURE_LABEL[f] ?? f),
  candidate: DELIVERY_MODEL?.candidate.name ?? null,
  baseline: DELIVERY_MODEL?.baselines[0]?.name ?? null,
};

// ── Late-delivery risk by city (a transparent rule, not the ML model) ──────

export const DELIVERY_RISK_RULE =
  "High: late rate above 9% or an open delivery-time alert. Medium: late rate above the network average. Low: at or below the average.";

const LIVE_15M = new Map(DEMO_LIVE_SNAPSHOT.per_store.map((s) => [s.store_id, s.orders_15m]));

export const DELIVERY_RISK = OPS_STORES.map((s) => {
  const alert = ANOMALIES.find((a) => a.store_id === s.store_id && a.anomaly_type === "DELIVERY_DURATION_SPIKE");
  const reasons: string[] = [];
  if (s.late_rate > 0.09) reasons.push(`late rate ${pct(s.late_rate)}, above 9%`);
  if (alert) reasons.push(`deliveries taking ${alert.observed_value} min vs ${alert.expected_value} expected`);
  const level: "High" | "Medium" | "Low" =
    reasons.length > 0 ? "High" : s.late_rate > DEMO_KPIS.late_delivery_rate ? "Medium" : "Low";
  if (level === "Medium") reasons.push(`late rate ${pct(s.late_rate)}, above the ${pct(DEMO_KPIS.late_delivery_rate)} average`);
  if (level === "Low") reasons.push(`late rate ${pct(s.late_rate)}, at or below average`);
  return { city: s.city, lateRate: s.late_rate, level, reasons, live15m: LIVE_15M.get(s.store_id) ?? null };
}).sort((a, b) => ({ High: 0, Medium: 1, Low: 2 })[a.level] - ({ High: 0, Medium: 1, Low: 2 })[b.level] || b.lateRate - a.lateRate);

// ── Formatting ─────────────────────────────────────────────────────────────

const plain = new Intl.NumberFormat("en-IN");

export function count(value: number | null | undefined): string {
  return value == null ? "—" : plain.format(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function inr(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)} L`;
  return `₹${plain.format(Math.round(value))}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function hourLabel(iso: string): string {
  return `${iso.slice(11, 13)}:00`;
}

export function timeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}
