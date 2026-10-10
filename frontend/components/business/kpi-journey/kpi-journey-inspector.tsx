"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProvenance } from "@/lib/business/provenance-context";
import {
  layerAccent,
  type MetricLineageResponse,
  type MetricLineageStep,
} from "@/lib/business/provenance";
import { apiRoot } from "@/lib/business/use-business-api";
import { cn } from "@/lib/utils";

const LAYER_ORDER = ["raw", "bronze", "silver", "gold"] as const;

function MiniDag({
  steps,
  activeFqn,
  onSelect,
}: {
  steps: MetricLineageStep[];
  activeFqn: string | null;
  onSelect: (fqn: string) => void;
}) {
  const byLayer = useMemo(() => {
    const map = new Map<string, MetricLineageStep[]>();
    for (const layer of LAYER_ORDER) {
      map.set(
        layer,
        steps.filter((s) => s.layer === layer),
      );
    }
    return map;
  }, [steps]);

  return (
    <div
      className="flex flex-wrap items-stretch gap-2 overflow-x-auto py-1"
      data-testid="kpi-journey-dag"
      aria-label="Pipeline overview"
    >
      {LAYER_ORDER.map((layer, idx) => {
        const layerSteps = byLayer.get(layer) ?? [];
        if (layerSteps.length === 0) return null;
        return (
          <div key={layer} className="flex items-center gap-2">
            {idx > 0 ? (
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {layer}
              </span>
              <div className="flex flex-wrap gap-1">
                {layerSteps.slice(0, 3).map((step) => (
                  <button
                    key={step.fqn}
                    type="button"
                    onClick={() => onSelect(step.fqn)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-left text-[11px] transition-colors",
                      activeFqn === step.fqn
                        ? "border-foreground bg-secondary text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                    )}
                  >
                    {step.table.replace(/^(bronze_|silver_|gold_)/, "")}
                  </button>
                ))}
                {layerSteps.length > 3 ? (
                  <span className="self-center text-[10px] text-muted-foreground">
                    +{layerSteps.length - 3}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KpiJourneyInspector() {
  const { inspectMetric, closeInspector } = useProvenance();
  const [payload, setPayload] = useState<MetricLineageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeFqn, setActiveFqn] = useState<string | null>(null);
  const [activeOpId, setActiveOpId] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectMetric) {
      setPayload(null);
      setError(null);
      setActiveFqn(null);
      setActiveOpId(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${apiRoot()}/metrics/${encodeURIComponent(inspectMetric.key)}/lineage`, {
      headers: { Accept: "application/json" },
      credentials: process.env.NEXT_PUBLIC_API_BASE ? "include" : "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<MetricLineageResponse>;
      })
      .then((body) => {
        setPayload(body);
        const gold =
          body.steps.find((s) => s.layer === "gold" && s.column) ??
          body.steps.find((s) => s.layer === "gold") ??
          body.steps[body.steps.length - 1];
        setActiveFqn(gold?.fqn ?? null);
        setActiveOpId(gold?.ops[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load lineage");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [inspectMetric]);

  const activeStep = payload?.steps.find((s) => s.fqn === activeFqn) ?? null;
  const activeOp =
    activeStep?.ops.find((o) => o.id === activeOpId) ?? activeStep?.ops[0] ?? null;

  useEffect(() => {
    if (!inspectMetric) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInspector();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectMetric, closeInspector]);

  if (!inspectMetric) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kpi-journey-title"
      data-testid="kpi-journey-inspector"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeInspector();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              How this number is made
            </p>
            <h2 id="kpi-journey-title" className="truncate text-lg font-semibold tracking-tight">
              {inspectMetric.label}
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                {inspectMetric.display}
              </span>
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {payload?.formula_text ?? inspectMetric.plain_description}
            </p>
            {payload ? (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {payload.gold_source}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={closeInspector}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading Raw → Gold journey…</p>
          ) : null}
          {error ? (
            <p className="text-sm text-status-bad" role="alert">
              {error}
            </p>
          ) : null}
          {payload ? (
            <div className="space-y-5">
              <MiniDag
                steps={payload.steps}
                activeFqn={activeFqn}
                onSelect={(fqn) => {
                  setActiveFqn(fqn);
                  const step = payload.steps.find((s) => s.fqn === fqn);
                  setActiveOpId(step?.ops[0]?.id ?? null);
                }}
              />

              <ol className="space-y-3" data-testid="kpi-journey-rail">
                {payload.steps.map((step) => {
                  const selected = step.fqn === activeFqn;
                  return (
                    <li key={step.fqn}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFqn(step.fqn);
                          setActiveOpId(step.ops[0]?.id ?? null);
                        }}
                        className={cn(
                          "w-full rounded-xl border border-border bg-card p-3 text-left transition-colors border-l-4",
                          layerAccent(step.layer),
                          selected && "ring-1 ring-foreground/20",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {step.layer}
                          </span>
                          {step.row_count != null ? (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {step.row_count.toLocaleString()} rows
                            </span>
                          ) : null}
                        </div>
                        <p className="font-medium">{step.table}</p>
                        {step.column ? (
                          <p className="font-mono text-xs text-muted-foreground">
                            column: {step.column}
                          </p>
                        ) : null}
                        {step.columns.length > 0 ? (
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">
                            {step.columns.slice(0, 6).join(", ")}
                            {step.columns.length > 6 ? "…" : ""}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ol>

              {activeOp ? (
                <section
                  className="space-y-2 rounded-xl border border-border bg-card p-4"
                  data-testid="kpi-journey-code"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">{activeOp.name}</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {activeOp.engine}
                      {activeOp.source_path ? ` · ${activeOp.source_path}` : ""}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{activeOp.summary}</p>
                  {activeStep && activeStep.ops.length > 1 ? (
                    <div className="flex flex-wrap gap-1">
                      {activeStep.ops.map((op) => (
                        <button
                          key={op.id}
                          type="button"
                          onClick={() => setActiveOpId(op.id)}
                          className={cn(
                            "rounded-md px-2 py-1 text-[11px]",
                            op.id === activeOp.id
                              ? "bg-secondary text-foreground"
                              : "text-muted-foreground hover:bg-secondary/60",
                          )}
                        >
                          {op.id}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <pre className="max-h-72 overflow-auto rounded-lg bg-secondary/50 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {activeOp.code}
                  </pre>
                </section>
              ) : activeStep ? (
                <p className="text-sm text-muted-foreground">
                  No transform code catalogued for this table — it is a source or pass-through node.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
