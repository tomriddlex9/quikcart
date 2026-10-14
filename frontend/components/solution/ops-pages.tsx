"use client";

import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import type { MapPoint } from "@/components/solution/network-map-leaflet";
import {
  Bars,
  BarList,
  DataTable,
  ForecastChart,
  Kpi,
  KpiGrid,
  Panel,
  StatusBadge,
  TrendChart,
} from "@/components/solution/widgets";
import {
  ANOMALIES,
  DELIVERY_RISK,
  DELIVERY_RISK_RULE,
  EMERGENCY_COVER_HOURS,
  PREDICTION_EXPLAINED,
  FORECASTS,
  LATEST_MODEL_SCORE,
  MODEL_RUNS,
  OPEN_ORDERS_AT_RISK,
  OPS,
  OPS_STORES,
  ORDERS_FORECAST,
  PROPOSALS,
  QUALITY_TREND,
  RISKS,
  count,
  inr,
  pct,
  shortDate,
  timeIST,
} from "@/lib/solution-data";
import { cn } from "@/lib/utils";

const NetworkMapLeaflet = dynamic(
  () => import("@/components/solution/network-map-leaflet").then((m) => m.NetworkMapLeaflet),
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-xs text-muted-foreground">Loading map…</div> },
);

function lateTone(rate: number): "bad" | "watch" | "good" {
  if (rate > 0.09) return "bad";
  if (rate > OPS.kpis.late_delivery_rate) return "watch";
  return "good";
}
const TONE_COLOR = { bad: "#e5484d", watch: "#f5a524", good: "#30a46c" } as const;
const TONE_TEXT = { bad: "text-destructive", watch: "text-chart-3", good: "text-chart-2" } as const;

// ── Operations Manager ─────────────────────────────────────────────────────

export function OperationsPage() {
  const { kpis, trend, live } = OPS;
  const maxOrders = Math.max(...OPS_STORES.map((s) => s.orders));
  const points: MapPoint[] = OPS_STORES.map((s) => ({
    id: s.store_id,
    label: s.city,
    detail: `${pct(s.late_rate)} late · ${count(s.orders)} orders`,
    latitude: s.latitude,
    longitude: s.longitude,
    color: TONE_COLOR[lateTone(s.late_rate)],
    size: s.orders / maxOrders,
  }));

  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <Kpi label="Orders" value={count(kpis.orders_placed)} hint="all 10 stores" />
        <Kpi label="Sales (GMV)" value={inr(kpis.gmv)} hint="all 10 stores" />
        <Kpi label="Late deliveries" value={pct(kpis.late_delivery_rate)} hint="past the promised time" tone="watch" />
        <Kpi label="Cancellations" value={pct(kpis.cancellation_rate)} hint="of placed orders" />
      </KpiGrid>
      <KpiGrid cols={3}>
        <Kpi label="Deliveries in progress" value={count(OPS.activeDeliveries)} hint="right now" />
        <Kpi label="Payment failures" value={pct(OPS.paymentFailureRate)} hint="last 15 minutes" />
        <Kpi label="Open customer tickets" value={count(OPS.openTickets)} hint="awaiting resolution" />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Orders, last 30 days" note="All stores · weekends run higher">
          <TrendChart
            data={trend as unknown as Record<string, unknown>[]}
            xKey="day"
            xFormat={shortDate}
            series={[{ key: "orders", name: "Orders", kind: "area", axis: "left", color: "var(--chart-1)" }]}
            leftFormat={count}
            valueFormat={(_, v) => count(v)}
          />
        </Panel>
        <Panel title="Cancelled orders, last 30 days">
          <TrendChart
            data={trend as unknown as Record<string, unknown>[]}
            xKey="day"
            xFormat={shortDate}
            series={[{ key: "cancelled", name: "Cancelled", kind: "line", axis: "left", color: "var(--chart-4)" }]}
            leftFormat={count}
            valueFormat={(_, v) => count(v)}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Store performance" note={`Sorted by late rate · network average ${pct(kpis.late_delivery_rate)}`}>
          <DataTable
            head={[
              { label: "City" },
              { label: "Orders", align: "right" },
              { label: "Sales", align: "right" },
              { label: "Late", align: "right" },
              { label: "Cancelled", align: "right" },
            ]}
            rows={OPS_STORES.map((s) => [
              s.city,
              count(s.orders),
              inr(s.gmv),
              <span key="l" className={cn("font-medium", TONE_TEXT[lateTone(s.late_rate)])}>{pct(s.late_rate)}</span>,
              pct(s.cancel_rate),
            ])}
          />
        </Panel>
        <Panel title="Late deliveries by city" note="Red above 9% · amber above average · green at or below">
          <div className="h-[330px] overflow-hidden rounded-lg border border-border/60 bg-muted/20">
            <NetworkMapLeaflet points={points} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Live orders per minute" note={`Updated ${timeIST(live.generated_at)} IST`}>
          <Bars
            data={live.orders_per_minute.map((m) => ({ minute: m.minute.slice(11, 16), orders: m.orders }))}
            xKey="minute"
            bars={[{ key: "orders", name: "Orders", color: "var(--chart-1)" }]}
            format={count}
            height={200}
          />
        </Panel>
        <Panel title="Order status right now">
          <BarList
            rows={Object.entries(live.status_mix).map(([k, v]) => ({ label: k.replaceAll("_", " ").toLowerCase(), value: v }))}
            format={count}
          />
        </Panel>
      </div>

      <Panel title="Anomalies" note={`${ANOMALIES.length} open, most severe first · each store against its own normal`}>
        <DataTable
          minWidth={680}
          head={[
            { label: "Severity" },
            { label: "What" },
            { label: "City" },
            { label: "Observed", align: "right" },
            { label: "Expected", align: "right" },
            { label: "When (IST)" },
            { label: "Detector" },
          ]}
          rows={ANOMALIES.map((a) => {
            const isRate = a.metric.endsWith("_rate");
            const fmt = (v: number) => (isRate ? pct(v) : a.metric.includes("minutes") ? `${v} min` : count(v));
            return [
              <StatusBadge key="s" status={a.severity} />,
              a.title,
              a.city,
              fmt(a.observed_value),
              fmt(a.expected_value),
              timeIST(a.observed_on),
              a.detector,
            ];
          })}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <PredictionExplained />
        <Panel title="Late-delivery risk by city" note={`Risk rule, not the ML model. ${DELIVERY_RISK_RULE}`}>
          <DataTable
            minWidth={560}
            head={[
              { label: "City" },
              { label: "Risk" },
              { label: "Why" },
              { label: "Orders, last 15 min", align: "right" },
            ]}
            rows={DELIVERY_RISK.map((r) => [
              <span key="c" className="font-medium">{r.city}</span>,
              <StatusBadge key="l" status={r.level.toUpperCase()} />,
              <span key="w" className="text-xs text-muted-foreground">{r.reasons.join(" · ")}</span>,
              count(r.live15m),
            ])}
          />
        </Panel>
      </div>

      <Panel
        title="Open orders at risk"
        note={`${OPEN_ORDERS_AT_RISK.filter((o) => o.probability >= 0.5).length} of ${OPEN_ORDERS_AT_RISK.length} scored open orders above 50% · highest risk first`}
      >
        <DataTable
          minWidth={760}
          head={[
            { label: "Order" },
            { label: "City" },
            { label: "Status" },
            { label: "Scored (IST)" },
            { label: "Promise", align: "right" },
            { label: "Distance", align: "right" },
            { label: "Late chance", align: "right" },
            { label: "Main reason" },
          ]}
          rows={OPEN_ORDERS_AT_RISK.map((o) => [
            <span key="id" className="whitespace-nowrap font-medium">#{o.id}</span>,
            o.city,
            o.status,
            <span key="t" className="whitespace-nowrap">{timeIST(o.at)}</span>,
            <span key="pr" className="whitespace-nowrap">{o.promisedMin} min</span>,
            <span key="d" className="whitespace-nowrap">{o.distanceKm.toFixed(1)} km</span>,
            <span
              key="p"
              className={cn(
                "font-medium",
                o.probability >= 0.7 ? "text-destructive" : o.probability >= 0.5 ? "text-chart-3" : "text-chart-2",
              )}
            >
              {Math.round(o.probability * 100)}%
            </span>,
            <span key="r" className="text-xs text-muted-foreground">{o.reason}</span>,
          ])}
        />
      </Panel>
    </div>
  );
}

function PredictionExplained() {
  const p = OPS.prediction;
  const prob = p.late_probability ?? null;
  const usual = PREDICTION_EXPLAINED.storeLateRate;
  const times = prob != null && usual ? Math.round(prob / usual) : null;
  const correct = Number(p.actual_class) === Number(p.predicted_class);

  return (
    <Panel title="Late-delivery prediction, explained" note="Scored when the order is placed, before a rider picks it up">
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium">
            Order #{String(p.order_id ?? "—")} · {p.city}
          </div>
          <div className="text-xs text-muted-foreground">Scored {timeIST(p.predicted_at)} IST</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Chance this order is late</div>
            <div className="text-3xl font-semibold tabular-nums text-chart-3">{pct(prob, 0)}</div>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">{p.city}&apos;s usual late rate</div>
            <div className="text-3xl font-semibold tabular-nums">{pct(usual)}</div>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          {times ? (
            <p>
              About <strong>{times}×</strong> the store&apos;s usual late rate, so this order is flagged before it goes out.
            </p>
          ) : null}
          <p className={cn("font-medium", correct ? "text-chart-2" : "text-destructive")}>
            Outcome: the order {Number(p.actual_class) === 1 ? "arrived late" : "arrived on time"}, so the prediction was{" "}
            {correct ? "right" : "wrong"}.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">What the model looks at</div>
          <div className="flex flex-wrap gap-1.5">
            {PREDICTION_EXPLAINED.features.map((f) => (
              <span key={f} className="rounded-md bg-card px-2 py-0.5 text-xs ring-1 ring-foreground/10">
                {f}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Only facts known when the order is placed. Model: {PREDICTION_EXPLAINED.candidate ?? "—"}, compared with a{" "}
            {PREDICTION_EXPLAINED.baseline ?? "simpler"} baseline; trained on older orders and tested on newer ones.
          </p>
        </div>
      </div>
    </Panel>
  );
}

// ── Inventory & Planning ───────────────────────────────────────────────────

export function InventoryPage() {
  const emergency = RISKS.filter((r) => r.emergency).length;
  const pending = PROPOSALS.filter((p) => p.status === "PENDING").length;
  const qtyBySku = new Map(
    PROPOSALS.filter((p) => p.type === "RESTOCK" && p.quantity != null).map((p) => [p.action.match(/SKU-\d+/)?.[0], p.quantity]),
  );

  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <Kpi label="Products below reorder level" value={count(OPS.kpis.products_below_reorder)} hint="all stores" tone="watch" />
        <Kpi label="Emergency restocks" value={emergency} hint={`under ${EMERGENCY_COVER_HOURS} hours of stock`} tone="bad" />
        <Kpi label="Forecast error" value={pct(OPS.forecastMape)} hint="average, next-day demand" tone="good" />
        <Kpi label="Restocks waiting for approval" value={pending} />
      </KpiGrid>

      <Panel
        title="Inventory risk"
        note={`Stock cover = stock on hand ÷ average hourly sales (last 7 days). Under ${EMERGENCY_COVER_HOURS} hours is an emergency restock.`}
      >
        <DataTable
          minWidth={760}
          head={[
            { label: "Product" },
            { label: "Category" },
            { label: "City" },
            { label: "On hand", align: "right" },
            { label: "Reorder point", align: "right" },
            { label: "Sells / hour", align: "right" },
            { label: "Stock cover", align: "right" },
            { label: "Risk" },
            { label: "Restock qty", align: "right" },
          ]}
          rows={RISKS.map((r) => [
            r.name,
            <span key="c" className="capitalize">{r.category}</span>,
            r.city,
            r.on_hand_qty,
            r.reorder_point,
            r.avg_hourly_sales_7d,
            <span key="h" className={cn("font-medium", r.emergency ? "text-destructive" : "text-chart-3")}>{r.stock_cover_hours} h</span>,
            <StatusBadge key="r" status={r.emergency ? "bad" : "watch"} label={r.emergency ? "Emergency" : "Reorder"} />,
            count(qtyBySku.get(r.sku) ?? null),
          ])}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Demand forecast vs actual" note={`Next-day units per store and category · average error ${pct(OPS.forecastMape)}`}>
          <DataTable
            minWidth={420}
            head={[
              { label: "City" },
              { label: "Category" },
              { label: "For", align: "right" },
              { label: "Forecast", align: "right" },
              { label: "Actual", align: "right" },
            ]}
            rows={FORECASTS.map((f) => [
              f.city,
              <span key="c" className="capitalize">{f.category}</span>,
              shortDate(f.forecast_date),
              f.expected_units,
              f.actual_units ?? "pending",
            ])}
          />
        </Panel>
        <Panel title="Forecast vs actual (units)">
          <Bars
            data={FORECASTS.filter((f) => f.actual_units != null).map((f) => ({
              label: `${f.city} · ${f.category}`,
              forecast: f.expected_units,
              actual: f.actual_units,
            }))}
            xKey="label"
            bars={[
              { key: "forecast", name: "Forecast", color: "var(--chart-1)" },
              { key: "actual", name: "Actual", color: "var(--chart-2)" },
            ]}
            format={count}
            height={200}
          />
        </Panel>
      </div>

      <Panel title="Orders forecast, next 7 days" note="All stores · actual orders, then the forecast with its likely range">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <ForecastChart
            history={ORDERS_FORECAST.history}
            forecast={ORDERS_FORECAST.days}
            xFormat={shortDate}
            valueFormat={count}
            height={240}
          />
          <div className="grid content-start gap-2">
            {[
              ["Next 7 days", `${count(ORDERS_FORECAST.total)} orders`],
              [
                "vs last 7 days",
                ORDERS_FORECAST.vsLast7 == null
                  ? "—"
                  : `${ORDERS_FORECAST.vsLast7 > 0 ? "+" : ""}${(ORDERS_FORECAST.vsLast7 * 100).toFixed(1)}%`,
              ],
              [
                "Busiest day",
                `${new Date(`${ORDERS_FORECAST.peak.at}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" })}, ${count(ORDERS_FORECAST.peak.value)}`,
              ],
              ["Likely range", `±${pct(OPS.forecastMape)} per day`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-sm font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Restock & action proposals" note="Raised by QuickCart, approved by a person">
        <DataTable
          minWidth={620}
          head={[
            { label: "#" },
            { label: "Type" },
            { label: "Action" },
            { label: "City" },
            { label: "Raised (IST)" },
            { label: "Status" },
          ]}
          rows={PROPOSALS.map((p) => [
            p.id,
            p.type,
            p.action,
            p.city,
            timeIST(p.createdAt),
            <StatusBadge key="s" status={p.status} />,
          ])}
        />
      </Panel>
    </div>
  );
}

// ── Data & Model Health ────────────────────────────────────────────────────

const LAYER_ORDER = ["raw", "bronze", "silver", "gold"] as const;
const LAYER_LABEL: Record<string, string> = {
  raw: "Source (raw)",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  quarantine: "Quarantine",
};

export function DataHealthPage() {
  const { pipeline, layers, qualityScore, activity, models } = OPS;
  const summaries = layers.layer_summaries;

  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <Kpi label="Data quality score" value={`${qualityScore}/100`} tone="good" />
        <Kpi label="Refresh lag" value={`${pipeline.end_to_end_lag_seconds ?? "—"}s`} hint="source to Gold" />
        <Kpi label="Records in quarantine" value={count(summaries.quarantine?.row_estimate)} hint="failed validation, held for review" tone="watch" />
        <Kpi label="Gold rows" value={count(summaries.gold?.row_estimate)} hint="decision-ready" />
      </KpiGrid>

      <Panel title="Medallion pipeline" note="Rows at each layer">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch">
          {LAYER_ORDER.map((key, i) => {
            const s = summaries[key];
            return (
              <div key={key} className="contents">
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="text-sm font-medium">{LAYER_LABEL[key]}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{count(s?.row_estimate)}</div>
                  <div className="text-xs text-muted-foreground">
                    {s?.tables ?? "—"} tables · {s?.ops ?? "—"} steps
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{s?.purpose}</div>
                </div>
                {i < LAYER_ORDER.length - 1 ? (
                  <div className="hidden place-items-center text-muted-foreground md:grid">
                    <ArrowRight className="size-4" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Quarantine: {count(summaries.quarantine?.row_estimate)} rows in {summaries.quarantine?.tables ?? "—"} tables ·{" "}
          {summaries.quarantine?.purpose}
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Pipeline stages" note="Last run of each stage">
          <DataTable
            minWidth={460}
            head={[
              { label: "Stage" },
              { label: "Last run (IST)" },
              { label: "Rows in", align: "right" },
              { label: "Rows out", align: "right" },
              { label: "Lag", align: "right" },
            ]}
            rows={pipeline.heartbeats.map((h) => [
              h.stage.replaceAll("_", " "),
              timeIST(h.last_run_at),
              count(h.rows_in),
              count(h.rows_out),
              h.lag_seconds == null ? "—" : `${h.lag_seconds}s`,
            ])}
          />
        </Panel>
        <Panel title="Recent activity">
          <ul className="space-y-1.5 text-xs">
            {activity.map((e) => (
              <li key={e.id} className="grid grid-cols-[5.5rem_4.5rem_1fr] gap-2">
                <span className="tabular-nums text-muted-foreground">{timeIST(e.ts).split(", ")[1] ?? timeIST(e.ts)}</span>
                <span className={cn("font-medium", e.level === "warn" || e.level === "error" ? "text-chart-3" : "text-muted-foreground")}>
                  {e.source}
                </span>
                <span className="break-words font-mono">{e.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Models" note="What each model predicts and how it is built">
        <DataTable
          minWidth={760}
          head={[{ label: "Model" }, { label: "Type" }, { label: "Baseline" }, { label: "Candidate" }, { label: "Measured by" }, { label: "Latest score" }]}
          rows={models.map((m) => [
            <span key="t" className="font-medium">{m.title}</span>,
            m.kind,
            m.baselines.map((b) => b.name).join(", "),
            m.candidate.name,
            m.metrics.map((x) => x.name).join(", "),
            <span key="s" className="whitespace-nowrap font-medium">{LATEST_MODEL_SCORE[m.id] ?? "—"}</span>,
          ])}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Model accuracy over time" note="Weekly training runs · forecast error (left) and late-delivery ROC-AUC (right)">
          <TrendChart
            data={MODEL_RUNS as unknown as Record<string, unknown>[]}
            xKey="at"
            xFormat={shortDate}
            series={[
              { key: "mape", name: "Forecast error (MAPE)", kind: "line", axis: "left", color: "var(--chart-3)" },
              { key: "rocAuc", name: "Late-delivery ROC-AUC", kind: "line", axis: "right", color: "var(--chart-1)" },
            ]}
            leftFormat={(v) => pct(v, 0)}
            rightFormat={(v) => v.toFixed(2)}
            valueFormat={(k, v) => (k === "mape" ? pct(v) : v.toFixed(3))}
            leftDomain={[0.06, 0.12]}
            rightDomain={[0.76, 0.84]}
            height={230}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Forecast error falls from {pct(MODEL_RUNS[0].mape)} to {pct(MODEL_RUNS[MODEL_RUNS.length - 1].mape)}; late-delivery
            ROC-AUC rises from {MODEL_RUNS[0].rocAuc.toFixed(2)} to {MODEL_RUNS[MODEL_RUNS.length - 1].rocAuc.toFixed(2)}.
          </p>
        </Panel>
        <Panel title="Data quality over time" note="Last 14 days · quality score (line) and records quarantined per day (area)">
          <TrendChart
            data={QUALITY_TREND as unknown as Record<string, unknown>[]}
            xKey="at"
            xFormat={shortDate}
            series={[
              { key: "quarantined", name: "Quarantined", kind: "area", axis: "right", color: "var(--chart-4)" },
              { key: "score", name: "Quality score", kind: "line", axis: "left", color: "var(--chart-2)" },
            ]}
            leftFormat={(v) => `${v}`}
            rightFormat={count}
            valueFormat={(k, v) => (k === "score" ? `${v}/100` : `${count(v)} rows`)}
            leftDomain={[80, 100]}
            height={230}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {count(QUALITY_TREND.reduce((a, r) => a + r.quarantined, 0))} records quarantined over 14 days; today&apos;s score{" "}
            {QUALITY_TREND[QUALITY_TREND.length - 1].score}/100.
          </p>
        </Panel>
      </div>
    </div>
  );
}
