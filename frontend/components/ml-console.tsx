"use client";

import { useState } from "react";
import { ArrowRight, CircleAlert, Search } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill } from "@/components/pill";
import { EmptyState, Skeleton } from "@/components/states";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { AnomalyRow, DemandForecastRow, DeliveryPrediction, StoreRow } from "@/lib/types";

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
  const tone =
    probability >= 0.7 ? "bg-destructive" : probability >= 0.4 ? "bg-chart-3" : "bg-chart-2";
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">P(late)</span>
        <span className="text-base tabular-nums">{pct}%</span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
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
          detail: `No scored row for order ${orderId.trim()} — the table may not be built, or the order sits outside the model's test window.`,
        });
      } else {
        setState({ status: "done", mode: "demo", data: DEMO_DELIVERY_PREDICTION });
      }
    }
  }

  const p = state.status === "done" ? (state.data.late_probability ?? 0) : 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Delivery delay</CardTitle>
        <CardDescription className="font-mono text-xs">
          GET /predictions/delivery/{"{order_id}"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="order id, e.g. 88041"
            inputMode="numeric"
            aria-label="Order id"
          />
          <Button type="submit" variant="outline" size="sm" disabled={state.status === "loading"}>
            <Search strokeWidth={1.75} />
            {state.status === "loading" ? "reading…" : "predict"}
          </Button>
        </form>

        <div className="mt-4">
          {state.status === "idle" ? (
            <p className="text-sm text-muted-foreground">
              Reads the scored row from <code>gold_delivery_predictions</code>: probability,
              predicted class, and the MLflow run behind it.
            </p>
          ) : state.status === "missing" ? (
            <EmptyState title="No prediction on file" hint={state.detail} />
          ) : state.status === "done" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={state.mode === "live" ? "teal" : "amber"}>
                  {state.mode === "live" ? "live · gold row" : "demo"}
                </Pill>
                {state.data.predicted_class !== undefined ? (
                  <Pill tone={Number(state.data.predicted_class) >= 1 ? "red" : "green"}>
                    predicted {Number(state.data.predicted_class) >= 1 ? "LATE" : "on time"}
                  </Pill>
                ) : null}
                {state.data.actual_class !== undefined && state.data.actual_class !== null ? (
                  <span className="text-xs text-muted-foreground">
                    actual: {Number(state.data.actual_class) >= 1 ? "late" : "on time"}
                  </span>
                ) : null}
              </div>
              {typeof state.data.late_probability === "number" ? (
                <ProbabilityBar probability={p} />
              ) : null}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs">
                <dt className="text-muted-foreground">model</dt>
                <dd className="truncate">{state.data.model_name ?? "—"}</dd>
                <dt className="text-muted-foreground">MLflow run</dt>
                <dd className="truncate">{state.data.model_version ?? "—"}</dd>
                <dt className="text-muted-foreground">predicted at</dt>
                <dd>{state.data.predicted_at ? formatDateTime(state.data.predicted_at) : "—"}</dd>
              </dl>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Demand forecast</CardTitle>
        <CardDescription className="font-mono text-xs">GET /predictions/demand</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            aria-label="Store"
          >
            <option value="">all stores</option>
            {(stores.data ?? []).map((s) => (
              <option key={s.store_id} value={s.store_id}>
                store {s.store_id}
              </option>
            ))}
          </select>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="category, e.g. dairy"
            aria-label="Category"
            className="flex-1"
          />
          <Button type="submit" variant="outline" size="sm" disabled={state.status === "loading"}>
            <Search strokeWidth={1.75} />
            {state.status === "loading" ? "reading…" : "forecast"}
          </Button>
        </form>

        <div className="mt-4">
          {state.status === "idle" ? (
            <p className="text-sm text-muted-foreground">
              Forecasts land in <code>gold_demand_forecasts</code> after each demand-model run.
              Filter by store and category to compare expected against actual units.
            </p>
          ) : state.status === "done" && rows.length === 0 ? (
            <EmptyState
              title="No forecast rows for that filter"
              hint="Either the table is not built yet, or the store/category filter matched nothing."
            />
          ) : state.status === "done" ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Pill tone={state.mode === "live" ? "teal" : "amber"}>
                  {state.mode === "live" ? "live · gold rows" : "demo"}
                </Pill>
                {version ? (
                  <span className="truncate text-xs text-muted-foreground">
                    model_version: {version}
                  </span>
                ) : null}
              </div>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs text-muted-foreground">store</TableHead>
                    <TableHead className="h-8 text-xs text-muted-foreground">category</TableHead>
                    <TableHead className="h-8 text-xs text-muted-foreground">date</TableHead>
                    <TableHead className="h-8 text-right text-xs text-muted-foreground">
                      expected
                    </TableHead>
                    <TableHead className="h-8 text-right text-xs text-muted-foreground">
                      actual
                    </TableHead>
                    <TableHead className="h-8 text-right text-xs text-muted-foreground">Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 20).map((r, i) => {
                    const exp = r.expected_units;
                    const act = r.actual_units;
                    const delta = exp !== undefined && act != null ? act - exp : null;
                    return (
                      <TableRow key={i}>
                        <TableCell className="py-1.5">{r.store_id ?? "—"}</TableCell>
                        <TableCell className="py-1.5">{r.category ?? "—"}</TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {r.forecast_date ?? r.day ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">
                          {exp !== undefined ? formatNumber(Math.round(exp)) : "—"}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {act == null ? "—" : formatNumber(Math.round(act))}
                        </TableCell>
                        <TableCell
                          className={`py-1.5 text-right tabular-nums ${
                            delta === null
                              ? "text-muted-foreground"
                              : Math.abs(delta) / Math.max(exp ?? 1, 1) > 0.15
                                ? "text-chart-3"
                                : "text-chart-2"
                          }`}
                        >
                          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {rows.length > 20 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  first 20 of {formatNumber(rows.length)} rows
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
    const dr =
      (SEVERITY_RANK[a.severity?.toUpperCase()] ?? 3) -
      (SEVERITY_RANK[b.severity?.toUpperCase()] ?? 3);
    if (dr !== 0) return dr;
    return String(b.observed_on ?? "").localeCompare(String(a.observed_on ?? ""));
  });

  return (
    <div>
      {demo ? <ApiBanner mode={anomalies.mode} error={anomalies.error} /> : null}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Anomalies</CardTitle>
          <CardDescription className="text-xs">
            severity, then recency · {rows.length} hits
          </CardDescription>
          <CardAction>
            <Pill tone={demo ? "amber" : "teal"}>
              {demo ? "demo data" : "live · gold_anomalies"}
            </Pill>
          </CardAction>
        </CardHeader>
        <CardContent>
          {anomalies.data === null ? (
            <Skeleton className="h-[220px] rounded-lg" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No anomalies detected"
              hint="gold_anomalies is empty — either the table is not built, or the detectors found nothing."
            />
          ) : (
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-xs text-muted-foreground">severity</TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">type</TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">store</TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">metric</TableHead>
                  <TableHead className="h-8 text-right text-xs text-muted-foreground">
                    observed
                  </TableHead>
                  <TableHead className="h-8 text-right text-xs text-muted-foreground">
                    expected
                  </TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">detector</TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">observed on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a, i) => {
                  const expected = a.expected_value;
                  const observed = a.observed_value;
                  const diverges =
                    expected != null &&
                    expected !== 0 &&
                    observed != null &&
                    (observed / expected >= 1.5 || observed / expected <= 0.66);
                  return (
                    <TableRow key={i}>
                      <TableCell className="py-1.5">
                        <Pill tone={severityTone(a.severity ?? "")}>{a.severity ?? "—"}</Pill>
                      </TableCell>
                      <TableCell className="py-1.5">{a.anomaly_type}</TableCell>
                      <TableCell className="py-1.5">{a.store_id}</TableCell>
                      <TableCell className="py-1.5 text-muted-foreground">{a.metric}</TableCell>
                      <TableCell
                        className={`py-1.5 text-right tabular-nums ${
                          a.severity?.toUpperCase() === "HIGH"
                            ? "text-destructive"
                            : diverges
                              ? "text-chart-3"
                              : ""
                        }`}
                      >
                        {observed ?? "—"}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {expected == null ? "—" : expected}
                      </TableCell>
                      <TableCell className="py-1.5 text-muted-foreground">{a.detector}</TableCell>
                      <TableCell className="py-1.5 text-muted-foreground">
                        {a.observed_on ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="mt-2.5 text-xs text-muted-foreground">
            Amber marks a ≥1.5× divergence from the detector baseline; red is HIGH severity.
            IsolationForest rows have no point expectation — the outlier score is under “observed”.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model cards — static documentation; metric VALUES are placeholders on
// purpose (real ones are re-measured per run and tracked in MLflow).
// ---------------------------------------------------------------------------

function ModelCardView({ card }: { card: ModelCard }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{card.title}</CardTitle>
        <CardDescription className="text-xs">{card.target}</CardDescription>
        <CardAction>
          <Pill>{card.kind}</Pill>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Accordion className="border-t border-border text-sm">
          <AccordionItem value="features">
            <AccordionTrigger className="text-xs">Features</AccordionTrigger>
            <AccordionContent className="text-xs text-muted-foreground">
              <p>{card.featuresSummary}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {card.featuresDetail.map((f) => (
                  <code key={f} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                    {f}
                  </code>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="baselines">
            <AccordionTrigger className="text-xs">Baselines &amp; split</AccordionTrigger>
            <AccordionContent className="text-xs text-muted-foreground">
              <ul className="space-y-1.5">
                {card.baselines.map((b) => (
                  <li key={b.name}>
                    <code className="text-foreground">{b.name}</code> — {b.note}
                  </li>
                ))}
                <li className="flex items-start gap-1.5">
                  <ArrowRight className="mt-0.5 size-3 shrink-0 text-chart-2" strokeWidth={1.75} />
                  <span>
                    <code className="text-chart-2">{card.candidate.name}</code> —{" "}
                    {card.candidate.note}
                  </span>
                </li>
              </ul>
              <p className="mt-2">{card.splitStrategy}</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="metrics">
            <AccordionTrigger className="text-xs">Metrics</AccordionTrigger>
            <AccordionContent className="text-xs text-muted-foreground">
              <p className="mb-2">
                Values are re-measured per run in MLflow — only the meaning is documented here.
              </p>
              <ul className="space-y-1.5">
                {card.metrics.map((m) => (
                  <li key={m.name}>
                    <code className="text-foreground">{m.name}</code> — {m.whatItMeans}
                    {m.unit ? ` (in ${m.unit})` : ""}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="leakage">
            <AccordionTrigger className="text-xs">
              <span className="flex items-center gap-1.5">
                <CircleAlert className="size-3 text-chart-3" strokeWidth={1.75} /> Leakage review
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-xs text-muted-foreground">
              <ul className="space-y-1">
                {card.leakageNotes.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="outputs">
            <AccordionTrigger className="text-xs">Where predictions land</AccordionTrigger>
            <AccordionContent className="text-xs text-muted-foreground">
              <code className="text-chart-2">{card.outputs.table}</code> — {card.outputs.how}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

export function MlConsole() {
  return (
    <Tabs defaultValue="predictions" className="gap-4">
      <TabsList>
        <TabsTrigger value="predictions">Predictions</TabsTrigger>
        <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
        <TabsTrigger value="models">Model cards</TabsTrigger>
      </TabsList>

      <TabsContent value="predictions">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <DeliveryLookup />
          <DemandLookup />
        </div>
      </TabsContent>

      <TabsContent value="anomalies">
        <AnomaliesPanel />
      </TabsContent>

      <TabsContent value="models">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {MODEL_CARDS.map((card) => (
            <ModelCardView key={card.id} card={card} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Documented from the training code in <code>src/quickcart/ml/</code>. Live values are the
          prediction rows under Predictions, which carry a real <code>model_version</code> per row.
        </p>
      </TabsContent>
    </Tabs>
  );
}
