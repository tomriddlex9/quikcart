"use client";

import { useState } from "react";
import { ArrowRight, CircleAlert, Search } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill } from "@/components/pill";
import { EmptyState, Skeleton } from "@/components/states";
import { apiGetJson, type ApiMode } from "@/lib/api";
import {
  DEMO_ANOMALIES,
  DEMO_DELIVERY_PREDICTION,
  DEMO_DEMAND_FORECASTS,
  DEMO_STORES,
} from "@/lib/demo";
import { formatDateTime, formatNumber } from "@/lib/format";
import { MODEL_CARDS, type ModelCard } from "@/lib/model-cards";
import { useApiData } from "@/lib/use-api";
import type {
  AnomalyRow,
  DemandForecastRow,
  DeliveryPrediction,
  StoreRow,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Live predictions — on-demand lookups against the prediction endpoints.
// Network failures fall back to clearly-labeled demo rows (mode "demo");
// a 404 means the table or entity genuinely does not exist (mode "missing").
// ---------------------------------------------------------------------------

type LookupState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; mode: ApiMode; data: T }
  | { status: "missing"; detail: string };

function isHttpError(err: unknown, status: number): boolean {
  return err instanceof Error && err.message.includes(`HTTP ${status}`);
}

function ProbabilityBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  const tone = probability >= 0.7 ? "bg-red" : probability >= 0.4 ? "bg-amber" : "bg-teal";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted">P(late)</span>
        <span className="text-[15px] text-paper">{pct}%</span>
      </div>
      <div
        className="mt-1 h-2 w-full border border-line-soft bg-ink"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Predicted late-delivery probability"
      >
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DeliveryLookup() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<LookupState<DeliveryPrediction>>({ status: "idle" });

  async function lookup(orderId: string) {
    if (!orderId.trim()) return;
    setState({ status: "loading" });
    try {
      const data = await apiGetJson<DeliveryPrediction>(
        `/api/v1/predictions/delivery/${encodeURIComponent(orderId.trim())}`,
      );
      setState({ status: "done", mode: "live", data });
    } catch (err) {
      if (isHttpError(err, 404)) {
        setState({
          status: "missing",
          detail: `no delivery prediction for order ${orderId.trim()} — the table may not be built yet, or the order is outside the model's test window`,
        });
      } else {
        setState({ status: "done", mode: "demo", data: DEMO_DELIVERY_PREDICTION });
      }
    }
  }

  const p = state.status === "done" ? (state.data.late_probability ?? 0) : 0;

  return (
    <div className="panel px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-medium text-paper-dim">Delivery-delay lookup</h3>
        <span className="text-[10px] text-faint">GET /api/v1/predictions/delivery/{"{order_id}"}</span>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="order id, e.g. 88041"
          inputMode="numeric"
          className="min-w-0 flex-1 border border-line bg-ink px-3 py-1.5 text-[12.5px] text-paper placeholder:text-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="flex shrink-0 items-center gap-1.5 border border-line px-3 py-1.5 text-[11.5px] text-paper-dim transition-colors hover:border-amber-dim hover:text-paper disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          {state.status === "loading" ? "reading gold…" : "predict"}
        </button>
      </form>

      <div className="mt-4">
        {state.status === "idle" ? (
          <p className="text-[11.5px] leading-relaxed text-faint">
            Enter an order id to read its scored row from{" "}
            <code className="text-muted">gold_delivery_predictions</code> — probability,
            predicted class and the MLflow run that produced it.
          </p>
        ) : state.status === "missing" ? (
          <EmptyState title="No prediction on file" hint={state.detail} />
        ) : state.status === "done" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={state.mode === "live" ? "teal" : "amber"}>
                {state.mode === "live" ? "live · gold row" : "demo · illustrative"}
              </Pill>
              {state.data.predicted_class !== undefined ? (
                <Pill tone={Number(state.data.predicted_class) >= 1 ? "red" : "green"}>
                  predicted {Number(state.data.predicted_class) >= 1 ? "LATE" : "on time"}
                </Pill>
              ) : null}
              {state.data.actual_class !== undefined && state.data.actual_class !== null ? (
                <span className="text-[10.5px] text-faint">
                  actual: {Number(state.data.actual_class) >= 1 ? "late" : "on time"}
                </span>
              ) : null}
            </div>
            {typeof state.data.late_probability === "number" ? (
              <ProbabilityBar probability={p} />
            ) : null}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line-soft pt-3 text-[11px]">
              <dt className="text-faint">model</dt>
              <dd className="truncate text-paper-dim">{state.data.model_name ?? "—"}</dd>
              <dt className="text-faint">version (MLflow run)</dt>
              <dd className="truncate text-paper-dim">{state.data.model_version ?? "—"}</dd>
              <dt className="text-faint">predicted at</dt>
              <dd className="text-paper-dim">
                {state.data.predicted_at ? formatDateTime(state.data.predicted_at) : "—"}
              </dd>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DemandLookup() {
  const stores = useApiData<StoreRow[]>("/api/v1/stores", DEMO_STORES);
  const [storeId, setStoreId] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState<LookupState<DemandForecastRow[]>>({ status: "idle" });

  async function lookup() {
    setState({ status: "loading" });
    const params = new URLSearchParams();
    if (storeId) params.set("store_id", storeId);
    if (category.trim()) params.set("category", category.trim());
    const qs = params.toString();
    try {
      const data = await apiGetJson<DemandForecastRow[]>(
        `/api/v1/predictions/demand${qs ? `?${qs}` : ""}`,
      );
      setState({ status: "done", mode: "live", data });
    } catch {
      setState({ status: "done", mode: "demo", data: DEMO_DEMAND_FORECASTS });
    }
  }

  const rows = state.status === "done" ? state.data : [];
  const version = rows.find((r) => r.model_version)?.model_version;

  return (
    <div className="panel px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-medium text-paper-dim">Demand forecast lookup</h3>
        <span className="text-[10px] text-faint">GET /api/v1/predictions/demand</span>
      </div>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="border border-line bg-ink px-2.5 py-1.5 text-[12px] text-paper focus:border-amber focus:outline-none"
          aria-label="Store"
        >
          <option value="">all stores</option>
          {(stores.data ?? []).map((s) => (
            <option key={s.store_id} value={s.store_id}>
              store {s.store_id}
            </option>
          ))}
        </select>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="category (optional), e.g. dairy"
          className="min-w-0 flex-1 border border-line bg-ink px-3 py-1.5 text-[12.5px] text-paper placeholder:text-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="flex shrink-0 items-center gap-1.5 border border-line px-3 py-1.5 text-[11.5px] text-paper-dim transition-colors hover:border-amber-dim hover:text-paper disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          {state.status === "loading" ? "reading gold…" : "forecast"}
        </button>
      </form>

      <div className="mt-4">
        {state.status === "idle" ? (
          <p className="text-[11.5px] leading-relaxed text-faint">
            Forecasts persist to <code className="text-muted">gold_demand_forecasts</code> after
            each demand-model run — filter by store and category, then compare expected vs
            actual units once the forecast day has landed.
          </p>
        ) : state.status === "done" && rows.length === 0 ? (
          <EmptyState
            title="No forecast rows for that filter"
            hint="The table may not be built yet (run the Phase 11 demand model) or the store/category filter matched nothing."
          />
        ) : state.status === "done" ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Pill tone={state.mode === "live" ? "teal" : "amber"}>
                {state.mode === "live" ? "live · gold rows" : "demo · illustrative"}
              </Pill>
              {version ? (
                <span className="truncate text-[10.5px] text-faint">
                  model_version: {version}
                </span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11.5px]">
                <thead>
                  <tr className="border-b border-line-soft text-[10px] uppercase tracking-wide text-faint">
                    <th className="py-1.5 pr-3 font-medium">store</th>
                    <th className="py-1.5 pr-3 font-medium">category</th>
                    <th className="py-1.5 pr-3 font-medium">forecast date</th>
                    <th className="py-1.5 pr-3 text-right font-medium">expected</th>
                    <th className="py-1.5 pr-3 text-right font-medium">actual</th>
                    <th className="py-1.5 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => {
                    const exp = r.expected_units;
                    const act = r.actual_units;
                    const delta = exp !== undefined && act != null ? act - exp : null;
                    return (
                      <tr key={i} className="border-b border-line-soft/50 last:border-0">
                        <td className="py-1.5 pr-3 text-paper-dim">{r.store_id ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-paper-dim">{r.category ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-muted">
                          {r.forecast_date ?? r.day ?? "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-paper">
                          {exp !== undefined ? formatNumber(Math.round(exp)) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-muted">
                          {act == null ? "—" : formatNumber(Math.round(act))}
                        </td>
                        <td
                          className={`py-1.5 text-right ${
                            delta === null
                              ? "text-faint"
                              : Math.abs(delta) / Math.max(exp ?? 1, 1) > 0.15
                                ? "text-amber"
                                : "text-teal"
                          }`}
                        >
                          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 20 ? (
              <p className="mt-1.5 text-[10px] text-faint">
                showing the first 20 of {formatNumber(rows.length)} rows
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anomalies — severity-sorted table over GET /api/v1/anomalies.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function severityTone(severity: string): "red" | "amber" | "neutral" {
  const s = severity.toUpperCase();
  return s === "HIGH" ? "red" : s === "MEDIUM" ? "amber" : "neutral";
}

function AnomaliesPanel() {
  const anomalies = useApiData<AnomalyRow[]>("/api/v1/anomalies", DEMO_ANOMALIES, 30_000);
  const demo = anomalies.mode !== "live";

  const rows = [...(anomalies.data ?? [])].sort((a, b) => {
    const dr = (SEVERITY_RANK[a.severity?.toUpperCase()] ?? 3) -
      (SEVERITY_RANK[b.severity?.toUpperCase()] ?? 3);
    if (dr !== 0) return dr;
    return String(b.observed_on ?? "").localeCompare(String(a.observed_on ?? ""));
  });

  return (
    <section className="panel px-4 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[12px] font-medium text-paper-dim">
            Anomalies
            {demo ? (
              <Pill tone="amber" className="ml-2">
                demo data
              </Pill>
            ) : (
              <Pill tone="teal" className="ml-2">
                live · gold_anomalies
              </Pill>
            )}
          </h2>
          <p className="mt-0.5 text-[10.5px] text-faint">
            sorted by severity, then recency · from GET /api/v1/anomalies
          </p>
        </div>
        <span className="text-[10px] text-faint">{rows.length} hits</span>
      </div>

      {anomalies.data === null ? (
        <Skeleton className="h-[220px] rounded-xs border border-line-soft" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No anomalies detected"
          hint="gold_anomalies is empty — either the table is not built yet (run the Phase 11 anomaly model) or the detectors found nothing."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[10px] uppercase tracking-wide text-faint">
                <th className="py-1.5 pr-3 font-medium">severity</th>
                <th className="py-1.5 pr-3 font-medium">type</th>
                <th className="py-1.5 pr-3 font-medium">store</th>
                <th className="py-1.5 pr-3 font-medium">metric</th>
                <th className="py-1.5 pr-3 text-right font-medium">observed</th>
                <th className="py-1.5 pr-3 text-right font-medium">expected</th>
                <th className="py-1.5 pr-3 font-medium">detector</th>
                <th className="py-1.5 font-medium">observed on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => {
                const expected = a.expected_value;
                const observed = a.observed_value;
                const diverges =
                  expected != null &&
                  expected !== 0 &&
                  observed != null &&
                  (observed / expected >= 1.5 || observed / expected <= 0.66);
                const noExpectation = expected == null;
                return (
                  <tr key={i} className="border-b border-line-soft/50 last:border-0">
                    <td className="py-1.5 pr-3">
                      <Pill tone={severityTone(a.severity ?? "")}>{a.severity ?? "—"}</Pill>
                    </td>
                    <td className="py-1.5 pr-3 text-paper-dim">{a.anomaly_type}</td>
                    <td className="py-1.5 pr-3 text-paper-dim">{a.store_id}</td>
                    <td className="py-1.5 pr-3 text-muted">{a.metric}</td>
                    <td
                      className={`py-1.5 pr-3 text-right ${
                        a.severity?.toUpperCase() === "HIGH"
                          ? "text-red"
                          : diverges
                            ? "text-amber"
                            : "text-paper"
                      }`}
                    >
                      {observed ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-muted">
                      {noExpectation ? "—" : expected}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{a.detector}</td>
                    <td className="py-1.5 text-faint">{a.observed_on ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
        observed vs expected: amber marks a ≥1.5× divergence from the detector's baseline; red is a
        HIGH-severity hit. IsolationForest rows have no point expectation — the multivariate
        outlier score is shown under “observed”.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Model cards — static documentation; metric VALUES are placeholders on
// purpose (real ones are re-measured per run and tracked in MLflow).
// ---------------------------------------------------------------------------

function ModelCardView({ card }: { card: ModelCard }) {
  return (
    <article className="panel px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[16px] font-semibold text-paper">{card.title}</h3>
        <Pill tone="neutral">{card.kind}</Pill>
        <Pill tone="teal">documented</Pill>
      </div>

      <div className="mt-3 space-y-3 text-[11.5px] leading-relaxed">
        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-faint">target</div>
          <p className="text-paper-dim">{card.target}</p>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">features</div>
          <p className="text-paper-dim">{card.featuresSummary}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.featuresDetail.map((f) => (
              <code
                key={f}
                className="border border-line-soft bg-ink px-1.5 py-0.5 text-[10px] text-muted"
              >
                {f}
              </code>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">
            baseline → candidate
          </div>
          <ul className="space-y-1.5">
            {card.baselines.map((b) => (
              <li key={b.name} className="flex items-start gap-2 text-muted">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
                <span>
                  <code className="text-paper-dim">{b.name}</code> — {b.note}
                </span>
              </li>
            ))}
            <li className="flex items-start gap-2 text-muted">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" strokeWidth={1.75} />
              <span>
                <code className="text-teal">{card.candidate.name}</code> — {card.candidate.note}
              </span>
            </li>
          </ul>
        </div>

        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-faint">
            split strategy
          </div>
          <p className="text-paper-dim">{card.splitStrategy}</p>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">
            metrics <span className="normal-case text-faint/80">(placeholders — see note)</span>
          </div>
          <ul className="space-y-1.5">
            {card.metrics.map((m) => (
              <li key={m.name} className="flex items-start gap-2 text-muted">
                <code className="shrink-0 text-amber">{m.name}</code>
                <span>
                  {m.whatItMeans}
                  {m.unit ? <span className="text-faint"> (in {m.unit})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border border-amber-dim/30 bg-amber/5 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber">
            <CircleAlert className="h-3 w-3" strokeWidth={1.75} /> leakage review
          </div>
          <ul className="space-y-1">
            {card.leakageNotes.map((n, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-paper-dim">
                · {n}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-faint">
            where predictions land
          </div>
          <p className="text-paper-dim">
            <code className="text-teal">{card.outputs.table}</code> — {card.outputs.how}
          </p>
        </div>
      </div>
    </article>
  );
}

export function MlConsole() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-[11px] font-medium tracking-wide text-faint">
          live predictions
        </h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DeliveryLookup />
          <DemandLookup />
        </div>
      </section>

      <AnomaliesPanel />

      <section>
        <h2 className="mb-1 text-[11px] font-medium tracking-wide text-faint">models</h2>
        <p className="mb-3 max-w-[80ch] text-[11.5px] leading-relaxed text-muted">
          The three Phase 11 models, documented from the training code.{" "}
          <span className="text-amber">Metric numbers are illustrative placeholders</span> — they
          are re-measured on every training run and tracked in MLflow (experiments{" "}
          <code>quickcart-delivery-delay</code>, <code>quickcart-demand-forecast</code>,{" "}
          <code>quickcart-anomaly-detection</code>).{" "}
          <span className="text-teal">Live values</span> are the prediction rows above, which carry
          a real <code>model_version</code> (MLflow run id) per row.
        </p>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {MODEL_CARDS.map((card) => (
            <ModelCardView key={card.id} card={card} />
          ))}
        </div>
      </section>

      <p className="text-[10.5px] text-faint">
        Sources: <code>gold_delivery_predictions</code>, <code>gold_demand_forecasts</code>,{" "}
        <code>gold_anomalies</code> via <code>GET /api/v1/predictions/delivery/{"{order_id}"}</code>,{" "}
        <code>GET /api/v1/predictions/demand</code>, <code>GET /api/v1/anomalies</code>. Model
        documentation: <code>src/quickcart/ml/*.py</code>, kit/03 §11.
      </p>
    </div>
  );
}
