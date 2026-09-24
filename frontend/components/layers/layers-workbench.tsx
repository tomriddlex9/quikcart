"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Layers as LayersIcon } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill, type PillTone } from "@/components/pill";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGetJson } from "@/lib/api";
import {
  DEMO_LAYER_SAMPLES,
  DEMO_LAYERS_CATALOG,
  type LayerOperation,
  type LayerSample,
  type LayersCatalog,
  type MedallionLayer,
} from "@/lib/layer-cube-types";
import { useApiData } from "@/lib/use-api";

const LAYER_ORDER: MedallionLayer[] = ["raw", "bronze", "silver", "quarantine", "gold"];

const LAYER_LABELS: Record<MedallionLayer, string> = {
  raw: "Raw",
  bronze: "Bronze",
  silver: "Silver",
  quarantine: "Quarantine",
  gold: "Gold",
};

const ENGINE_TONE: Record<LayerOperation["engine"], PillTone> = {
  pyspark: "teal",
  python: "neutral",
  sql: "amber",
  cdc: "green",
  stream: "teal",
  ml: "red",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function opsForLayer(catalog: LayersCatalog, layer: MedallionLayer): LayerOperation[] {
  if (layer === "quarantine") {
    return catalog.operations.filter((op) => op.impact.rows_quarantined > 0);
  }
  if (layer === "raw") return [];
  return catalog.operations.filter((op) => op.layer === layer);
}

function Meter({
  label,
  valueLabel,
  pct,
  tone = "bg-chart-2",
}: {
  label: string;
  valueLabel: string;
  pct: number;
  tone?: string;
}) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(Math.max(0, Math.min(100, pct))));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{valueLabel}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${tone} transition-[width] duration-700 ease-out`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function ImpactPanel({ op }: { op: LayerOperation }) {
  const { impact } = op;
  const rowsMax = Math.max(impact.rows_in, 1);
  const nullDelta = impact.null_rate_before - impact.null_rate_after;
  return (
    <div key={op.id} className="space-y-3">
      <Meter
        label="Rows in"
        valueLabel={impact.rows_in.toLocaleString()}
        pct={100}
        tone="bg-chart-1"
      />
      <Meter
        label="Rows out"
        valueLabel={impact.rows_out.toLocaleString()}
        pct={(impact.rows_out / rowsMax) * 100}
        tone="bg-chart-2"
      />
      <Meter
        label="Rows quarantined"
        valueLabel={impact.rows_quarantined.toLocaleString()}
        pct={(impact.rows_quarantined / rowsMax) * 100}
        tone="bg-destructive"
      />
      <Meter
        label="Quality lift"
        valueLabel={`${impact.quality_lift_pct.toFixed(1)}%`}
        pct={impact.quality_lift_pct}
        tone="bg-chart-3"
      />
      <div className="grid grid-cols-2 gap-3">
        <Meter
          label="Null rate before"
          valueLabel={`${(impact.null_rate_before * 100).toFixed(1)}%`}
          pct={impact.null_rate_before * 100}
          tone="bg-chart-4"
        />
        <Meter
          label="Null rate after"
          valueLabel={`${(impact.null_rate_after * 100).toFixed(1)}%`}
          pct={impact.null_rate_after * 100}
          tone="bg-chart-2"
        />
      </div>
      {nullDelta > 0 ? (
        <p className="text-xs text-muted-foreground">
          Null rate improved by <span className="text-foreground">{(nullDelta * 100).toFixed(1)} pts</span> across
          this hop. Latency: <span className="tabular-nums text-foreground">{impact.latency_ms.toLocaleString()}ms</span>.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Latency: <span className="tabular-nums text-foreground">{impact.latency_ms.toLocaleString()}ms</span>.
        </p>
      )}
    </div>
  );
}

function IoChips({ op }: { op: LayerOperation }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {op.inputs.map((input) => (
        <Badge key={input} variant="outline" className="font-mono">
          {input}
        </Badge>
      ))}
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      {op.outputs.map((output) => (
        <Badge key={output} variant="secondary" className="font-mono">
          {output}
        </Badge>
      ))}
    </div>
  );
}

function SampleTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  const columns = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((key) => set.add(key)));
    return Array.from(set);
  }, [rows]);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} className="whitespace-nowrap font-mono text-[10px] first:pl-3 last:pr-3">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={Math.max(columns.length, 1)} className="h-16 text-center text-xs text-muted-foreground">
                  No sample rows.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column) => (
                    <TableCell
                      key={column}
                      className="max-w-40 truncate whitespace-nowrap font-mono text-[10px] first:pl-3 last:pr-3"
                      title={formatValue(row[column])}
                    >
                      {formatValue(row[column])}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface SampleState {
  data: LayerSample | null;
  loading: boolean;
  isDemo: boolean;
  error: string | null;
}

function useLayerSample(op: LayerOperation | null): SampleState {
  const [state, setState] = useState<SampleState>({ data: null, loading: false, isDemo: false, error: null });

  useEffect(() => {
    if (!op) {
      setState({ data: null, loading: false, isDemo: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, isDemo: false, error: null });

    apiGetJson<LayerSample>(`/api/v1/layers/sample/${op.layer}?op=${encodeURIComponent(op.id)}`)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, isDemo: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const demo = DEMO_LAYER_SAMPLES[op.id] ?? {
          layer: op.layer,
          before: [],
          after: [],
          notes: ["No demo sample recorded for this operation yet."],
        };
        setState({
          data: demo,
          loading: false,
          isDemo: true,
          error: err instanceof Error ? err.message : "sample request failed",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [op]);

  return state;
}

export function LayersWorkbench() {
  const catalogState = useApiData<LayersCatalog>(
    "/api/v1/layers/operations",
    DEMO_LAYERS_CATALOG,
    60_000,
  );
  const catalog = catalogState.data ?? DEMO_LAYERS_CATALOG;

  const [layer, setLayer] = useState<MedallionLayer>("bronze");
  const ops = useMemo(() => opsForLayer(catalog, layer), [catalog, layer]);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(ops[0]?.id ?? null);

  useEffect(() => {
    setSelectedOpId(ops[0]?.id ?? null);
  }, [layer, ops]);

  const selectedOp = ops.find((op) => op.id === selectedOpId) ?? null;
  const sample = useLayerSample(selectedOp);
  const summary = catalog.layer_summaries[layer];

  return (
    <div>
      {catalogState.mode !== "live" ? (
        <ApiBanner mode={catalogState.mode} error={catalogState.error} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[9rem_16rem_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-16">
          <CardHeader className="border-b pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <LayersIcon className="size-4 text-muted-foreground" />
              Layers
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 py-2">
            <Tabs
              orientation="vertical"
              value={layer}
              onValueChange={(value) => setLayer(value as MedallionLayer)}
            >
              <TabsList variant="line" className="h-auto w-full">
                {LAYER_ORDER.map((entry) => (
                  <TabsTrigger key={entry} value={entry} className="w-full justify-start">
                    {LAYER_LABELS[entry]}
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {catalog.layer_summaries[entry]?.ops ?? 0}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="border-b pb-2">
            <CardTitle className="text-sm">{LAYER_LABELS[layer]} operations</CardTitle>
            <CardDescription className="text-xs">{summary?.purpose}</CardDescription>
          </CardHeader>
          <CardContent className="px-2 py-2">
            {catalogState.mode === "offline" && !catalogState.data ? (
              <div className="space-y-2 px-1">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : ops.length === 0 ? (
              <EmptyState
                className="border-0 px-1 py-6"
                title={layer === "raw" ? "Source of truth" : "No routed operations"}
                hint={
                  layer === "raw"
                    ? `${summary?.tables ?? 0} operational tables in PostgreSQL feed every downstream hop.`
                    : "No operation currently routes rows into this layer."
                }
              />
            ) : (
              <ScrollArea className="h-[24rem]">
                <div className="space-y-1 pr-2">
                  {ops.map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => setSelectedOpId(op.id)}
                      data-selected={selectedOpId === op.id}
                      className="relative flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-xs">{op.name}</span>
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">{op.summary}</span>
                      <span
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-foreground opacity-0 transition-opacity data-[selected=true]:opacity-100"
                        data-selected={selectedOpId === op.id}
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {selectedOp ? (
            <>
              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    {selectedOp.name}
                    <Pill tone={ENGINE_TONE[selectedOp.engine]}>{selectedOp.engine}</Pill>
                  </CardTitle>
                  <CardDescription>{selectedOp.summary}</CardDescription>
                  <CardAction>
                    <Badge variant="outline">{LAYER_LABELS[selectedOp.layer]}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  <IoChips op={selectedOp} />
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {selectedOp.code}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b pb-2">
                  <CardTitle className="text-sm">Impact</CardTitle>
                  <CardDescription className="text-xs">
                    Measured across the most recent run of this hop
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ImpactPanel op={selectedOp} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b pb-2">
                  <CardTitle className="text-sm">Before / after sample</CardTitle>
                  <CardAction className="flex items-center gap-2">
                    {sample.isDemo ? <Badge variant="outline">Demo rows</Badge> : null}
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  {sample.loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ) : sample.data ? (
                    <>
                      {sample.error ? (
                        <p className="text-xs text-muted-foreground">
                          Live sample failed ({sample.error}); showing a synthetic before/after.
                        </p>
                      ) : null}
                      <div className="grid gap-4 md:grid-cols-2">
                        <SampleTable title="Before" rows={sample.data.before} />
                        <SampleTable title="After" rows={sample.data.after} />
                      </div>
                      {sample.data.notes.length > 0 ? (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {sample.data.notes.map((note, index) => (
                            <li key={index}>• {note}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sample available.</p>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="grid min-h-[20rem] place-items-center">
              <p className="text-sm text-muted-foreground">
                {layer === "raw"
                  ? "Raw is the operational source — pick another layer to see its transformations."
                  : "Select an operation to inspect its code and impact."}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
