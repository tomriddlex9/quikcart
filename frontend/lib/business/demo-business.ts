// Offline fixtures for every /api/v1/b/* endpoint, shaped per persona, so the
// business console is fully usable without the API (demo mode or API outage).

import { formatBusinessINR, formatCount, formatMinutes, formatShare } from "@/lib/business/format";
import type {
  AlertsResponse,
  AttentionItem,
  BusinessPersona,
  BusinessScope,
  CategoryMoney,
  CustomersHealthResponse,
  DeliveryHealthResponse,
  JourneyStep,
  JourneySummary,
  Meta,
  MetricDefinition,
  MetricUnit,
  MetricValue,
  MetricsCatalogResponse,
  MoneyResponse,
  ProductRow,
  ProductTab,
  ProductsResponse,
  Status,
  StoreDetail,
  StoreScorecard,
  StoreScorecardsResponse,
  TodayResponse,
  TrendPoint,
} from "@/lib/business/types";

export const DEFAULT_DEMO_PERSONA: BusinessPersona = "business_exec";

export const DEMO_PERSONAS: { persona: BusinessPersona; label: string; displayName: string }[] = [
  { persona: "business_exec", label: "Business executive", displayName: "Asha Rao" },
  { persona: "city_manager", label: "City manager (Bengaluru)", displayName: "Karan Mehta" },
  { persona: "store_manager", label: "Store manager (Store 8)", displayName: "Priya Nair" },
  { persona: "category_manager", label: "Category manager (Dairy)", displayName: "Dev Malhotra" },
  { persona: "leadership", label: "Leadership", displayName: "Meera Kapoor" },
];

export function isBusinessPersonaName(value: string | null | undefined): value is BusinessPersona {
  return DEMO_PERSONAS.some((p) => p.persona === value);
}

export function demoDisplayName(persona: BusinessPersona): string {
  return DEMO_PERSONAS.find((p) => p.persona === persona)?.displayName ?? "there";
}

export function demoScopes(persona: BusinessPersona): BusinessScope[] {
  switch (persona) {
    case "city_manager":
      return [{ scope_type: "city", scope_value: "Bengaluru" }];
    case "store_manager":
      return [{ scope_type: "store", scope_value: "8" }];
    case "category_manager":
      return [{ scope_type: "category", scope_value: "Dairy" }];
    default:
      return [{ scope_type: "company", scope_value: "*" }];
  }
}

// --- metric registry (plain language) ------------------------------------------------------

interface MetricSpec {
  label: string;
  unit: MetricUnit;
  direction: "higher_better" | "lower_better";
  description: string;
  formula: string;
  synonyms: string[];
  watchAt?: number;
  badAt?: number;
  relWatch?: number;
  relBad?: number;
  partial?: string;
}

const SPECS: Record<string, MetricSpec> = {
  sales_gmv: {
    label: "Sales",
    unit: "inr",
    direction: "higher_better",
    description: "Money customers spent on orders that were not cancelled.",
    formula: "Sum of order totals for every order that was not cancelled.",
    synonyms: ["sales", "gmv", "revenue"],
    relWatch: 15,
    relBad: 30,
  },
  orders: {
    label: "Orders",
    unit: "count",
    direction: "higher_better",
    description: "How many orders customers placed, including ones later cancelled.",
    formula: "Count of orders placed in the period.",
    synonyms: ["orders", "order count"],
    relWatch: 15,
    relBad: 30,
  },
  average_basket: {
    label: "Average basket",
    unit: "inr",
    direction: "higher_better",
    description: "How much a typical successful order is worth.",
    formula: "Sales divided by the number of orders that were not cancelled.",
    synonyms: ["aov", "average order value", "basket size"],
    relWatch: 10,
    relBad: 20,
  },
  cancel_rate: {
    label: "Cancelled orders",
    unit: "pct",
    direction: "lower_better",
    description: "Share of orders that were cancelled before they reached the customer.",
    formula: "Cancelled orders divided by orders placed.",
    synonyms: ["cancellations", "cancel rate"],
    watchAt: 0.04,
    badAt: 0.08,
  },
  on_time_rate: {
    label: "On-time deliveries",
    unit: "pct",
    direction: "higher_better",
    description: "Share of deliveries that arrived within the promised time.",
    formula: "Deliveries within the promised time divided by completed deliveries.",
    synonyms: ["on time", "punctuality"],
    watchAt: 0.9,
    badAt: 0.8,
  },
  late_rate: {
    label: "Late deliveries",
    unit: "pct",
    direction: "lower_better",
    description: "Share of deliveries that arrived after the promised time.",
    formula: "Late deliveries divided by completed deliveries.",
    synonyms: ["late", "delays"],
    watchAt: 0.1,
    badAt: 0.2,
  },
  avg_delivery_minutes: {
    label: "Delivery time",
    unit: "minutes",
    direction: "lower_better",
    description: "Average minutes from order placed to delivered.",
    formula: "Average of delivered time minus placed time.",
    synonyms: ["delivery time", "eta"],
    watchAt: 18,
    badAt: 24,
  },
  payment_failure_rate: {
    label: "Failed payments",
    unit: "pct",
    direction: "lower_better",
    description: "Share of payment attempts that did not go through.",
    formula: "Failed payment attempts divided by all attempts.",
    synonyms: ["payment failures"],
    watchAt: 0.05,
    badAt: 0.1,
    partial: "Needs the payments feed; shown from a sample until it is connected.",
  },
  availability_bestsellers: {
    label: "Bestsellers in stock",
    unit: "pct",
    direction: "higher_better",
    description: "Share of top-selling products that are on the shelf right now.",
    formula: "Bestseller lines with stock above zero divided by all bestseller lines.",
    synonyms: ["availability", "in stock"],
    watchAt: 0.95,
    badAt: 0.9,
  },
  stockout_risk_count: {
    label: "Items about to run out",
    unit: "count",
    direction: "lower_better",
    description: "Stock lines at or below their reorder level that may sell out soon.",
    formula: "Count of stock lines with on-hand at or below the reorder point.",
    synonyms: ["running low", "stockout risk"],
    watchAt: 5,
    badAt: 12,
  },
  active_customers: {
    label: "Active customers",
    unit: "count",
    direction: "higher_better",
    description: "Customers who placed at least one order in the period.",
    formula: "Distinct customers with an order in the period.",
    synonyms: ["customers", "active users"],
    relWatch: 10,
    relBad: 20,
  },
  repeat_rate: {
    label: "Repeat customers",
    unit: "pct",
    direction: "higher_better",
    description: "Share of today's customers who have ordered from QuickCart before.",
    formula: "Customers with an earlier order divided by active customers.",
    synonyms: ["repeat", "returning customers", "retention"],
    watchAt: 0.55,
    badAt: 0.45,
  },
};

function display(value: number | null, unit: MetricUnit): string {
  if (value === null) return "—";
  switch (unit) {
    case "inr":
      return formatBusinessINR(value);
    case "pct":
      return formatShare(value);
    case "minutes":
      return formatMinutes(value);
    default:
      return formatCount(value);
  }
}

function statusFor(spec: MetricSpec, value: number, baseline: number | null): Status {
  const ranks: Status[] = [];
  const lower = spec.direction === "lower_better";
  if (spec.badAt !== undefined && spec.watchAt !== undefined) {
    const bad = lower ? value >= spec.badAt : value <= spec.badAt;
    const watch = lower ? value >= spec.watchAt : value <= spec.watchAt;
    ranks.push(bad ? "bad" : watch ? "watch" : "good");
  }
  if (spec.relBad !== undefined && spec.relWatch !== undefined && baseline) {
    const change = ((value - baseline) / baseline) * 100;
    const adverse = lower ? change : -change;
    ranks.push(adverse >= spec.relBad ? "bad" : adverse >= spec.relWatch ? "watch" : "good");
  }
  if (ranks.includes("bad")) return "bad";
  if (ranks.includes("watch")) return "watch";
  return ranks.length > 0 ? "good" : "unknown";
}

const COMPARE_LABEL = "the same day last week";

export function demoMetric(key: string, value: number | null, baseline: number | null): MetricValue {
  const spec = SPECS[key];
  const change =
    value !== null && baseline ? Math.round(((value - baseline) / baseline) * 1000) / 10 : null;
  const dir = change === null ? "none" : Math.abs(change) < 0.5 ? "flat" : change > 0 ? "up" : "down";
  const shown = display(value, spec.unit);
  const explanation =
    dir === "flat" || dir === "none"
      ? `${spec.label} is ${shown}, about the same as ${COMPARE_LABEL}.`
      : `${spec.label} is ${shown}, ${dir} ${Math.abs(change as number).toFixed(1)}% on ${COMPARE_LABEL}.`;
  return {
    key,
    label: spec.label,
    value,
    display: shown,
    unit: spec.unit,
    status: value === null ? "unknown" : statusFor(spec, value, baseline),
    direction: spec.direction,
    baseline_value: baseline,
    baseline_display: baseline === null ? null : display(baseline, spec.unit),
    delta_pct: change,
    compare_to: "same_day_last_week",
    compare_label: COMPARE_LABEL,
    explanation,
    plain_description: spec.description,
    is_partial: spec.partial !== undefined,
    as_of: DAY,
  };
}

// --- store seed data ------------------------------------------------------------------------

const DAY = "2026-10-07";

interface StoreSeed {
  id: number;
  name: string;
  city: string;
  sales: number;
  salesBase: number;
  orders: number;
  ordersBase: number;
  onTime: number;
  onTimeBase: number;
  cancel: number;
  cancelBase: number;
  minutes: number;
  minutesBase: number;
  lowStock: number;
}

const STORES: StoreSeed[] = [
  { id: 1, name: "Koramangala", city: "Bengaluru", sales: 412_000, salesBase: 398_000, orders: 1180, ordersBase: 1150, onTime: 0.94, onTimeBase: 0.93, cancel: 0.021, cancelBase: 0.022, minutes: 14.2, minutesBase: 14.8, lowStock: 3 },
  { id: 2, name: "Indiranagar", city: "Bengaluru", sales: 368_000, salesBase: 371_000, orders: 1040, ordersBase: 1055, onTime: 0.91, onTimeBase: 0.92, cancel: 0.028, cancelBase: 0.025, minutes: 15.6, minutesBase: 15.1, lowStock: 4 },
  { id: 3, name: "HSR Layout", city: "Bengaluru", sales: 254_000, salesBase: 331_000, orders: 760, ordersBase: 980, onTime: 0.78, onTimeBase: 0.9, cancel: 0.071, cancelBase: 0.03, minutes: 25.4, minutesBase: 16.2, lowStock: 9 },
  { id: 4, name: "Whitefield", city: "Bengaluru", sales: 286_000, salesBase: 301_000, orders: 842, ordersBase: 880, onTime: 0.87, onTimeBase: 0.91, cancel: 0.045, cancelBase: 0.031, minutes: 19.8, minutesBase: 16.9, lowStock: 6 },
  { id: 5, name: "Bandra West", city: "Mumbai", sales: 391_000, salesBase: 366_000, orders: 1095, ordersBase: 1020, onTime: 0.92, onTimeBase: 0.91, cancel: 0.024, cancelBase: 0.026, minutes: 15.1, minutesBase: 15.4, lowStock: 2 },
  { id: 6, name: "Powai", city: "Mumbai", sales: 301_000, salesBase: 312_000, orders: 880, ordersBase: 905, onTime: 0.9, onTimeBase: 0.9, cancel: 0.033, cancelBase: 0.03, minutes: 16.4, minutesBase: 16.1, lowStock: 5 },
  { id: 7, name: "Saket", city: "Delhi", sales: 334_000, salesBase: 329_000, orders: 960, ordersBase: 948, onTime: 0.93, onTimeBase: 0.92, cancel: 0.026, cancelBase: 0.027, minutes: 14.9, minutesBase: 15.0, lowStock: 3 },
  { id: 8, name: "Jayanagar", city: "Bengaluru", sales: 218_000, salesBase: 224_000, orders: 640, ordersBase: 655, onTime: 0.89, onTimeBase: 0.9, cancel: 0.036, cancelBase: 0.033, minutes: 17.2, minutesBase: 16.8, lowStock: 6 },
];

function scopedSeeds(persona: BusinessPersona): StoreSeed[] {
  if (persona === "city_manager") return STORES.filter((s) => s.city === "Bengaluru");
  if (persona === "store_manager") return STORES.filter((s) => s.id === 8);
  return STORES;
}

/** Category managers see their category only: roughly a fifth of each store's numbers. */
function factor(persona: BusinessPersona): number {
  return persona === "category_manager" ? 0.18 : 1;
}

const STATUS_RANK: Record<Status, number> = { unknown: 0, good: 1, watch: 2, bad: 3 };

function worst(statuses: Status[]): Status {
  return statuses.reduce<Status>(
    (acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc),
    "unknown",
  );
}

function scorecard(seed: StoreSeed, k: number): StoreScorecard {
  const orders = Math.round(seed.orders * k);
  const ordersBase = Math.round(seed.ordersBase * k);
  const sales = Math.round(seed.sales * k);
  const salesBase = Math.round(seed.salesBase * k);
  const metrics: Record<string, MetricValue> = {
    sales_gmv: demoMetric("sales_gmv", sales, salesBase),
    orders: demoMetric("orders", orders, ordersBase),
    average_basket: demoMetric("average_basket", Math.round(sales / orders), Math.round(salesBase / ordersBase)),
    cancel_rate: demoMetric("cancel_rate", seed.cancel, seed.cancelBase),
    on_time_rate: demoMetric("on_time_rate", seed.onTime, seed.onTimeBase),
    avg_delivery_minutes: demoMetric("avg_delivery_minutes", seed.minutes, seed.minutesBase),
    stockout_risk_count: demoMetric("stockout_risk_count", seed.lowStock, null),
  };
  const attention: string[] = [];
  if (metrics.on_time_rate.status !== "good") attention.push("Deliveries are running late.");
  if (metrics.sales_gmv.status !== "good") attention.push("Sales are down on last week.");
  if (metrics.cancel_rate.status !== "good") attention.push("More orders are being cancelled than usual.");
  if (metrics.stockout_risk_count.status !== "good") attention.push("Several items may sell out soon.");
  return {
    store_id: seed.id,
    store_name: seed.name,
    city: seed.city,
    status: worst(Object.values(metrics).map((m) => m.status)),
    metrics,
    attention,
  };
}

function meta(note: string | null = null): Meta {
  return {
    as_of_day: DAY,
    is_today: true,
    source: "serving",
    generated_at: `${DAY}T09:30:00Z`,
    compare_label: COMPARE_LABEL,
    note,
  };
}

// --- aggregate helpers ----------------------------------------------------------------------

function sum(seeds: StoreSeed[], pick: (s: StoreSeed) => number, k: number): number {
  return Math.round(seeds.reduce((acc, s) => acc + pick(s), 0) * k);
}

function weighted(seeds: StoreSeed[], value: (s: StoreSeed) => number, weight: (s: StoreSeed) => number): number {
  const total = seeds.reduce((acc, s) => acc + weight(s), 0);
  return seeds.reduce((acc, s) => acc + value(s) * weight(s), 0) / total;
}

function aggregate(persona: BusinessPersona) {
  const seeds = scopedSeeds(persona);
  const k = factor(persona);
  const sales = sum(seeds, (s) => s.sales, k);
  const salesBase = sum(seeds, (s) => s.salesBase, k);
  const orders = sum(seeds, (s) => s.orders, k);
  const ordersBase = sum(seeds, (s) => s.ordersBase, k);
  const onTime = weighted(seeds, (s) => s.onTime, (s) => s.orders);
  const onTimeBase = weighted(seeds, (s) => s.onTimeBase, (s) => s.ordersBase);
  const cancel = weighted(seeds, (s) => s.cancel, (s) => s.orders);
  const cancelBase = weighted(seeds, (s) => s.cancelBase, (s) => s.ordersBase);
  const minutes = weighted(seeds, (s) => s.minutes, (s) => s.orders);
  const minutesBase = weighted(seeds, (s) => s.minutesBase, (s) => s.ordersBase);
  const lowStock = Math.round(seeds.reduce((acc, s) => acc + s.lowStock, 0) * (k < 1 ? 0.5 : 1));
  const customers = Math.round(orders * 0.82);
  const customersBase = Math.round(ordersBase * 0.83);
  return { seeds, k, sales, salesBase, orders, ordersBase, onTime, onTimeBase, cancel, cancelBase, minutes, minutesBase, lowStock, customers, customersBase };
}

// --- endpoint builders ----------------------------------------------------------------------

function today(persona: BusinessPersona): TodayResponse {
  const a = aggregate(persona);
  const cards = a.seeds.map((s) => scorecard(s, a.k));
  const headline = [
    demoMetric("sales_gmv", a.sales, a.salesBase),
    demoMetric("orders", a.orders, a.ordersBase),
    demoMetric("average_basket", Math.round(a.sales / a.orders), Math.round(a.salesBase / a.ordersBase)),
    demoMetric("on_time_rate", a.onTime, a.onTimeBase),
  ];
  const more = [
    demoMetric("cancel_rate", a.cancel, a.cancelBase),
    demoMetric("avg_delivery_minutes", a.minutes, a.minutesBase),
    demoMetric("stockout_risk_count", a.lowStock, null),
    demoMetric("active_customers", a.customers, a.customersBase),
    demoMetric("repeat_rate", 0.61, 0.6),
  ];
  const scopeWord =
    persona === "store_manager" ? "Your store" : persona === "city_manager" ? "Bengaluru" : "QuickCart";
  const sales = headline[0];
  const trend =
    sales.delta_pct === null || Math.abs(sales.delta_pct) < 0.5
      ? "about the same as"
      : `${sales.delta_pct > 0 ? "up" : "down"} ${Math.abs(sales.delta_pct).toFixed(0)}% on`;
  const needHelp = cards.filter((c) => c.status === "bad").length;
  const summary =
    `${scopeWord} has made ${sales.display} so far today, ${trend} ${COMPARE_LABEL}. ` +
    (needHelp > 0
      ? `${needHelp} ${needHelp === 1 ? "store needs" : "stores need"} help.`
      : "Every store is holding steady.");
  return { meta: meta(), summary, headline, more, attention: attention(persona) };
}

function attention(persona: BusinessPersona): AttentionItem[] {
  const cards = scopedSeeds(persona).map((s) => scorecard(s, factor(persona)));
  const items: AttentionItem[] = [];
  for (const c of cards) {
    const late = c.metrics.on_time_rate;
    if (late.status !== "good") {
      items.push({
        id: `late-${c.store_id}`,
        severity: late.status === "bad" ? "bad" : "watch",
        title: `${c.store_name}: deliveries are late`,
        detail: `Only ${late.display} arrived on time (usually ${late.baseline_display ?? "higher"}).`,
        metric_key: "on_time_rate",
        store_id: c.store_id,
        store_name: c.store_name,
      });
    }
    const sales = c.metrics.sales_gmv;
    if (sales.status !== "good") {
      items.push({
        id: `sales-${c.store_id}`,
        severity: sales.status === "bad" ? "bad" : "watch",
        title: `${c.store_name}: sales are down`,
        detail: sales.explanation,
        metric_key: "sales_gmv",
        store_id: c.store_id,
        store_name: c.store_name,
      });
    }
    const low = c.metrics.stockout_risk_count;
    if (low.status === "bad") {
      items.push({
        id: `stock-${c.store_id}`,
        severity: "bad",
        title: `${c.store_name}: ${low.display} items may sell out`,
        detail: "These are at or below their reorder level.",
        metric_key: "stockout_risk_count",
        store_id: c.store_id,
        store_name: c.store_name,
      });
    }
  }
  return items.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "bad" ? -1 : 1)).slice(0, 8);
}

function scorecards(persona: BusinessPersona): StoreScorecardsResponse {
  const k = factor(persona);
  const stores = scopedSeeds(persona)
    .map((s) => scorecard(s, k))
    .sort(
      (a, b) =>
        STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
        (b.metrics.sales_gmv.value ?? 0) - (a.metrics.sales_gmv.value ?? 0),
    );
  return { meta: meta(), stores };
}

const HOUR_SHAPE = [0.2, 0.1, 0.05, 0.05, 0.1, 0.3, 0.7, 1.1, 1.3, 1.1, 0.9, 1.0, 1.4, 1.5, 1.2, 1.0, 1.1, 1.6, 2.2, 2.4, 2.0, 1.4, 0.8, 0.4];

function hourly(seed: StoreSeed, k: number): TrendPoint[] {
  const total = HOUR_SHAPE.reduce((a, b) => a + b, 0);
  return HOUR_SHAPE.slice(0, 10).map((shape, hour) => ({
    at: `${DAY}T${String(hour).padStart(2, "0")}:00:00Z`,
    sales: Math.round(((seed.sales * k) / total) * shape),
    orders: Math.round(((seed.orders * k) / total) * shape),
  }));
}

function daily(salesToday: number, ordersToday: number): TrendPoint[] {
  const wiggle = [0.92, 0.96, 1.04, 1.1, 0.98, 0.88, 0.9, 0.95, 1.0, 1.06, 1.12, 1.0, 0.94, 1];
  return wiggle.map((w, i) => {
    const date = new Date(Date.UTC(2026, 9, 7 - (13 - i)));
    return {
      at: date.toISOString().slice(0, 10),
      sales: Math.round(salesToday * w * (i === 13 ? 1 : 1.12)),
      orders: Math.round(ordersToday * w * (i === 13 ? 1 : 1.12)),
    };
  });
}

function storeDetail(persona: BusinessPersona, id: number): StoreDetail | null {
  const seed = scopedSeeds(persona).find((s) => s.id === id);
  if (!seed) return null;
  const k = factor(persona);
  const card = scorecard(seed, k);
  return {
    meta: meta(),
    scorecard: card,
    hourly_trend: hourly(seed, k),
    daily_trend: daily(Math.round(seed.sales * k), Math.round(seed.orders * k)),
    running_low: products(persona, "running_low").items.filter((p) => p.store_id === id).slice(0, 5),
  };
}

const PRODUCT_SEED: { id: number; sku: string; name: string; category: string }[] = [
  { id: 1042, sku: "SKU-01042", name: "Whole Milk 1L", category: "Dairy" },
  { id: 1043, sku: "SKU-01043", name: "Curd 400g", category: "Dairy" },
  { id: 1044, sku: "SKU-01044", name: "Paneer 200g", category: "Dairy" },
  { id: 1101, sku: "SKU-01101", name: "Farm Eggs (12)", category: "Eggs & Meat" },
  { id: 1210, sku: "SKU-01210", name: "Bananas 1kg", category: "Fruit & Veg" },
  { id: 1211, sku: "SKU-01211", name: "Tomatoes 500g", category: "Fruit & Veg" },
  { id: 1305, sku: "SKU-01305", name: "Sourdough Loaf", category: "Bakery" },
  { id: 1402, sku: "SKU-01402", name: "Instant Noodles 4-pack", category: "Snacks" },
  { id: 1403, sku: "SKU-01403", name: "Masala Chips 150g", category: "Snacks" },
  { id: 1510, sku: "SKU-01510", name: "Cold Coffee 250ml", category: "Beverages" },
];

function products(persona: BusinessPersona, tab: ProductTab): ProductsResponse {
  const stores = scopedSeeds(persona);
  const pool = persona === "category_manager" ? PRODUCT_SEED.filter((p) => p.category === "Dairy") : PRODUCT_SEED;
  const copy = {
    running_low: {
      title: "Running low",
      description: "These lines are at or below their reorder level and may sell out soon.",
    },
    bestsellers: { title: "Bestsellers", description: "What customers are buying most today." },
    slow: { title: "Slow movers", description: "Lines that are barely selling. Consider a promotion." },
  }[tab];
  const items: ProductRow[] = pool.slice(0, 8).map((p, i) => {
    const store = stores[i % stores.length];
    const onHand = tab === "running_low" ? 4 + ((i * 7) % 20) : 40 + i * 9;
    const reorder = 30;
    const units = tab === "slow" ? 2 + (i % 4) : 90 - i * 7;
    const revenue = units * (38 + i * 11);
    const cover = tab === "running_low" ? Math.round((1.2 + i * 0.7) * 10) / 10 : null;
    const status: Status = tab === "running_low" ? (i < 3 ? "bad" : "watch") : tab === "slow" ? "watch" : "good";
    return {
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      store_id: store.id,
      store_name: store.name,
      on_hand_qty: onHand,
      reorder_point: reorder,
      units_sold: units,
      revenue,
      revenue_display: formatBusinessINR(revenue),
      stock_cover_hours: cover,
      status,
      note:
        tab === "running_low"
          ? `Only ${onHand} left; about ${cover} hours of stock at the current pace.`
          : tab === "bestsellers"
            ? `${units} sold today across ${store.name}.`
            : `Just ${units} sold today. Stock is sitting on the shelf.`,
    };
  });
  return { meta: meta(), tab, ...copy, items };
}

function delivery(persona: BusinessPersona): DeliveryHealthResponse {
  const a = aggregate(persona);
  const k = factor(persona);
  const by_store = a.seeds
    .map((s) => {
      const onTime = demoMetric("on_time_rate", s.onTime, s.onTimeBase);
      const mins = demoMetric("avg_delivery_minutes", s.minutes, s.minutesBase);
      return {
        store_id: s.id,
        store_name: s.name,
        status: worst([onTime.status, mins.status]),
        on_time_rate: onTime,
        avg_delivery_minutes: mins,
      };
    })
    .sort((x, y) => STATUS_RANK[y.status] - STATUS_RANK[x.status] || (x.on_time_rate.value ?? 1) - (y.on_time_rate.value ?? 1));
  return {
    meta: meta(),
    metrics: [
      demoMetric("on_time_rate", a.onTime, a.onTimeBase),
      demoMetric("late_rate", 1 - a.onTime, 1 - a.onTimeBase),
      demoMetric("avg_delivery_minutes", a.minutes, a.minutesBase),
    ],
    by_store,
    in_progress: { Packing: Math.round(24 * k), "On the way": Math.round(38 * k), "Waiting for a rider": Math.round(6 * k) },
    riders: { Available: Math.round(31 * k), "On a delivery": Math.round(52 * k), "On break": Math.round(9 * k) },
  };
}

function customers(persona: BusinessPersona): CustomersHealthResponse {
  const a = aggregate(persona);
  return {
    meta: meta(),
    metrics: [
      demoMetric("active_customers", a.customers, a.customersBase),
      demoMetric("repeat_rate", 0.61, 0.6),
      demoMetric("cancel_rate", a.cancel, a.cancelBase),
    ],
    new_customers: Math.round(a.customers * 0.14),
    total_customers: Math.round(a.customers * 11.5),
    top_customers: [
      { customer_code: "C-20418", orders: 9, spend: 8420, spend_display: formatBusinessINR(8420), last_order_at: `${DAY}T08:12:00Z` },
      { customer_code: "C-10977", orders: 7, spend: 6130, spend_display: formatBusinessINR(6130), last_order_at: `${DAY}T07:40:00Z` },
      { customer_code: "C-31202", orders: 6, spend: 5980, spend_display: formatBusinessINR(5980), last_order_at: `${DAY}T06:55:00Z` },
      { customer_code: "C-08844", orders: 6, spend: 4710, spend_display: formatBusinessINR(4710), last_order_at: `${DAY}T09:05:00Z` },
    ],
  };
}

function money(persona: BusinessPersona): MoneyResponse {
  const a = aggregate(persona);
  const basket = Math.round(a.sales / a.orders);
  const discounts = Math.round(a.sales * 0.052);
  const refunds = Math.round(a.sales * 0.011);
  const mix: [string, number][] = [
    ["Fruit & Veg", 0.22],
    ["Dairy", 0.2],
    ["Snacks", 0.17],
    ["Beverages", 0.14],
    ["Bakery", 0.1],
    ["Eggs & Meat", 0.09],
    ["Household", 0.08],
  ];
  const categories = persona === "category_manager" ? mix.filter(([c]) => c === "Dairy") : mix;
  const by_category: CategoryMoney[] = categories.map(([category, share]) => {
    const value = Math.round(a.sales * (persona === "category_manager" ? 1 : share));
    return {
      category,
      sales: value,
      sales_display: formatBusinessINR(value),
      share_pct: persona === "category_manager" ? 1 : share,
      units: Math.round(value / 64),
    };
  });
  return {
    meta: meta(),
    sales: demoMetric("sales_gmv", a.sales, a.salesBase),
    average_basket: demoMetric("average_basket", basket, Math.round(a.salesBase / a.ordersBase)),
    discounts,
    discounts_display: formatBusinessINR(discounts),
    discount_share_pct: 0.052,
    refunds,
    refunds_display: formatBusinessINR(refunds),
    net_sales: a.sales - discounts - refunds,
    net_sales_display: formatBusinessINR(a.sales - discounts - refunds),
    by_category,
    daily_trend: daily(a.sales, a.orders),
  };
}

function alerts(persona: BusinessPersona): AlertsResponse {
  return {
    meta: meta(),
    items: attention(persona),
    note: "Alert rules are not configured yet; this list shows what is currently off track.",
  };
}

function catalog(): MetricsCatalogResponse {
  const metrics: MetricDefinition[] = Object.entries(SPECS).map(([key, s]) => ({
    key,
    label: s.label,
    plain_description: s.description,
    formula_text: s.formula,
    unit: s.unit,
    direction: s.direction,
    gold_source: "serving",
    synonyms: s.synonyms,
    compare_default: "same_day_last_week",
    watch_at: s.watchAt ?? null,
    bad_at: s.badAt ?? null,
    is_partial: s.partial !== undefined,
    partial_note: s.partial ?? null,
  }));
  return { metrics };
}

// --- journeys A–C (static, also used when the API returns thin data) ---------------------------

interface StepSeed {
  title: string;
  body: string;
  link: string;
  keys: string[];
}

export const JOURNEYS: Record<string, { summary: JourneySummary; steps: StepSeed[] }> = {
  A: {
    summary: {
      id: "A",
      title: "Start my day",
      audience: "Store and operations managers",
      summary: "Check how the day compares, spot the stores that need help, and see what is about to run out.",
      step_count: 4,
    },
    steps: [
      { title: "See today at a glance", body: "Start with sales, orders, and the average basket. Each number is compared with the same day last week.", link: "/b/today", keys: ["sales_gmv", "orders", "average_basket"] },
      { title: "Find the stores that need help", body: "Stores are sorted with the ones needing help first. Open one to see its hourly pattern.", link: "/b/stores", keys: ["on_time_rate", "cancel_rate"] },
      { title: "Check what is running low", body: "These lines are at or below their reorder level and may sell out soon.", link: "/b/products?tab=running_low", keys: ["stockout_risk_count", "availability_bestsellers"] },
      { title: "Review what needs attention", body: "Anything that crossed a watch or bad line shows on Today and in Actions.", link: "/b/actions", keys: [] },
    ],
  },
  B: {
    summary: {
      id: "B",
      title: "Why are deliveries slow?",
      audience: "Delivery and rider operations",
      summary: "Follow late deliveries from the company view down to the store.",
      step_count: 4,
    },
    steps: [
      { title: "Check delivery health", body: "On-time share, late share, and average delivery time for the day.", link: "/b/delivery", keys: ["on_time_rate", "late_rate", "avg_delivery_minutes"] },
      { title: "Compare stores", body: "The table lists stores with the slowest deliveries first, so you can see whether slowness is everywhere or in a few places.", link: "/b/delivery", keys: ["on_time_rate"] },
      { title: "Understand the number", body: "Read exactly how late deliveries are defined before acting on them.", link: "/b/learn", keys: ["late_rate"] },
      { title: "Look at the weakest store", body: "Open the weakest store to compare its hourly orders with its delivery times.", link: "/b/stores", keys: ["orders"] },
    ],
  },
  C: {
    summary: {
      id: "C",
      title: "Is the money healthy?",
      audience: "Finance and leadership",
      summary: "Sales, discounts, refunds, and which categories carry the day.",
      step_count: 4,
    },
    steps: [
      { title: "Sales and basket", body: "Total sales and the average basket against last week.", link: "/b/money", keys: ["sales_gmv", "average_basket"] },
      { title: "Discounts and refunds", body: "How much was given away and how much came back.", link: "/b/money", keys: [] },
      { title: "Category mix", body: "Which categories contribute the most sales today.", link: "/b/money", keys: [] },
      { title: "Customer health", body: "Active and returning customers behind the sales.", link: "/b/customers", keys: ["active_customers", "repeat_rate"] },
    ],
  },
};

export function journeyStepFixture(id: string, n: number): JourneyStep | null {
  const journey = JOURNEYS[id.toUpperCase()];
  if (!journey || n < 1 || n > journey.steps.length) return null;
  const step = journey.steps[n - 1];
  return {
    journey_id: id.toUpperCase(),
    n,
    total: journey.steps.length,
    title: step.title,
    body: step.body,
    link: step.link,
    metric_keys: step.keys,
    next_n: n < journey.steps.length ? n + 1 : null,
    prev_n: n > 1 ? n - 1 : null,
  };
}

// --- router ---------------------------------------------------------------------------------

/** Fixture for a `/b` sub-path such as `/today` or `/products?tab=slow`; undefined if unknown. */
export function demoBusinessPayload(persona: BusinessPersona, path: string): unknown {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const clean = pathname.replace(/\/+$/, "");
  if (clean === "/today") return today(persona);
  if (clean === "/stores/scorecards") return scorecards(persona);
  if (clean === "/products") {
    const tab = params.get("tab");
    return products(persona, tab === "bestsellers" || tab === "slow" ? tab : "running_low");
  }
  if (clean === "/delivery/health") return delivery(persona);
  if (clean === "/customers/health") return customers(persona);
  if (clean === "/money") return money(persona);
  if (clean === "/targets") {
    return {
      meta: today(persona).meta,
      period_start: "2026-09-01",
      period_label: "This month",
      items: [
        {
          scope_type: "global",
          scope_value: "all",
          scope_label: "All stores",
          metric_key: "sales_gmv",
          metric_label: "Sales",
          period_type: "month",
          period_start: "2026-09-01",
          target_value: 12_000_000,
          target_display: "₹1.2Cr",
          actual_value: 8_400_000,
          actual_display: "₹84L",
          pace_pct: 70,
          status: "watch",
          set_by: "simulator",
        },
      ],
      note: null,
    };
  }
  if (clean === "/reports") {
    return { meta: today(persona).meta, items: [], note: "No saved reports in sample data." };
  }
  if (clean === "/alerts") return alerts(persona);
  if (clean === "/metrics") return catalog();
  if (clean === "/journeys") return Object.values(JOURNEYS).map((j) => j.summary);
  const store = /^\/stores\/(\d+)$/.exec(clean);
  if (store) return storeDetail(persona, Number(store[1])) ?? undefined;
  const step = /^\/journeys\/([A-Za-z])\/steps\/(\d+)$/.exec(clean);
  if (step) return journeyStepFixture(step[1], Number(step[2])) ?? undefined;
  return undefined;
}
