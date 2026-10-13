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
