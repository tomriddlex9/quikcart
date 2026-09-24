"use client";

import { useMemo, useState } from "react";
import {
  Boxes,
  Braces,
  ChevronRight,
  Clock,
  Database,
  GitBranch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill, StatusDot } from "@/components/pill";
import { Loading } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
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
const LAYER_TONE: Record<MedallionLayer, "neutral" | "amber" | "teal" | "red" | "green"> = {
  raw: "neutral",
  bronze: "amber",
  silver: "teal",
  quarantine: "red",
  gold: "green",
};
const ENGINE_LABEL: Record<LayerOperation["engine"], string> = {
  pyspark: "PySpark",
  python: "Python",
  sql: "SQL",
  cdc: "CDC",
  stream: "Stream",
  ml: "ML",
};

function Medallion({ activeLayer }: { activeLayer: MedallionLayer | "all" }) {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {LAYER_ORDER.map((layer, i) => (
        <div key={layer} className="flex flex-1 items-center gap-2">
          <div
            className={
              "flex-1 rounded-lg border px-3 py-2.5 transition-colors " +
              (activeLayer === layer
                ? "border-chart-2/50 bg-chart-2/10"
                : "border-border bg-muted/40")
            }
          >
            <div className="font-mono text-xs tracking-widest">{LAYER_LABELS[layer].toUpperCase()}</div>
          </div>
          {i < LAYER_ORDER.length - 1 ? (
            <ChevronRight
              className="size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Meter({
  label,
  value,
  max = 100,
  suffix = "%",
  tone = "teal",
}: {
  label: string;
  value: number;
  max?: number;
  suffix?: string;
  tone?: "teal" | "amber" | "red";
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const barColor =
    tone === "red" ? "bg-destructive" : tone === "amber" ? "bg-chart-3" : "bg-chart-2";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-foreground">
          {suffix === "%" ? `${value.toFixed(1)}%` : `${formatNumber(value)}${suffix}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${barColor} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ImpactMeters({ op }: { op: LayerOperation }) {
  const { impact } = op;
  const dropRate = impact.rows_in > 0 ? ((impact.rows_in - impact.rows_out) / impact.rows_in) * 100 : 0;
  const quarantineRate = impact.rows_in > 0 ? (impact.rows_quarantined / impact.rows_in) * 100 : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Meter
        label="rows in -> out"
        value={impact.rows_out}
        max={Math.max(impact.rows_in, impact.rows_out, 1)}
        suffix=""
      />
      <Meter
        label="quarantined"
        value={quarantineRate}
        tone={quarantineRate > 0 ? "red" : "teal"}
      />
      <Meter label="quality lift" value={impact.quality_lift_pct} tone="teal" />
      <Meter
        label="dropped / filtered"
        value={dropRate}
        tone={dropRate > 5 ? "amber" : "teal"}
      />
      <Meter
        label="null rate before -> after"
        value={impact.null_rate_before * 100}
        tone="amber"
      />
      <Meter label={`latency`} value={impact.latency_ms} max={Math.max(impact.latency_ms, 1)} suffix="ms" />
    </div>
  );
}

function OperationRow({
  op,
  active,
  onSelect,
}: {
  op: LayerOperation;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors " +
        (active
          ? "border-chart-2/50 bg-chart-2/8"
          : "border-border bg-card hover:bg-muted/50")
      }
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <code className="truncate text-xs font-medium">{op.name}</code>
          <Badge variant="outline" className="text-[10px]">
            {ENGINE_LABEL[op.engine]}
          </Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">{op.summary}</span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatNumber(op.impact.rows_out)}
        <span className="ml-1 text-[10px]">rows</span>
      </span>
    </button>
  );
}

function SampleTable({ rows, title }: { rows: Record<string, unknown>[]; title: string }) {
  if (rows.length === 0) {
    return (
      <div className="grid h-16 place-items-center text-xs text-muted-foreground">
        No {title.toLowerCase()} rows for this layer.
      </div>
    );
  }
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap font-mono text-[10px] first:pl-3 last:pr-3">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c} className="whitespace-nowrap font-mono text-[11px] first:pl-3 last:pr-3">
                  {row[c] === null || row[c] === undefined ? (
                    <span className="text-muted-foreground">NULL</span>
                  ) : (
                    String(row[c])
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BeforeAfter({ sample }: { sample: LayerSample }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <GitBranch className="size-3" strokeWidth={1.75} />
            BEFORE
          </div>
          <Card size="sm" className="overflow-hidden">
            <SampleTable rows={sample.before} title="before" />
          </Card>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-chart-2">
            <Sparkles className="size-3" strokeWidth={1.75} />
            AFTER
          </div>
          <Card size="sm" className="overflow-hidden border-chart-2/30">
            <SampleTable rows={sample.after} title="after" />
          </Card>
        </div>
      </div>
      {sample.notes.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {sample.notes.map((note, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LayersWorkbench() {
  const catalogState = useApiData<LayersCatalog>(
    "/api/v1/layers/operations",
    DEMO_LAYERS_CATALOG,
    60_000,
  );
  const catalog = catalogState.data ?? DEMO_LAYERS_CATALOG;
  const demo = catalogState.mode !== "live";

  const [activeLayer, setActiveLayer] = useState<MedallionLayer | "all">("bronze");
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);

  const opsForLayer = useMemo(
    () =>
      activeLayer === "all"
        ? catalog.operations
        : catalog.operations.filter((op) => op.layer === activeLayer),
    [catalog.operations, activeLayer],
  );

  const selectedOp =
    catalog.operations.find((op) => op.id === selectedOpId) ?? opsForLayer[0] ?? null;

  const sampleLayer = selectedOp?.layer === "raw" ? "raw" : selectedOp?.layer ?? "bronze";
  const sampleState = useApiData<LayerSample>(
    selectedOp ? `/api/v1/layers/sample/${sampleLayer}` : null,
    DEMO_LAYER_SAMPLES[selectedOp?.id ?? ""] ?? {
      layer: sampleLayer,
      before: [],
      after: [],
      notes: [],
    },
    0,
  );
  const sample =
    DEMO_LAYER_SAMPLES[selectedOp?.id ?? ""] ??
    sampleState.data ?? { layer: sampleLayer, before: [], after: [], notes: [] };

  if (catalogState.data === null) {
    return <Loading label="Loading layer operations…" />;
  }

  return (
    <div className="space-y-4">
      {demo ? <ApiBanner mode={catalogState.mode} error={catalogState.error} /> : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Medallion flow</CardTitle>
          <CardDescription className="text-xs">
            {catalog.operations.length} operations across{" "}
            {Object.keys(catalog.layer_summaries).length} layers. Bad rows are quarantined with
            structured reasons, never dropped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Medallion activeLayer={activeLayer} />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LAYER_ORDER.map((layer) => {
          const summary = catalog.layer_summaries[layer];
          if (!summary) return null;
          return (
            <button
              key={layer}
              type="button"
              onClick={() => setActiveLayer(layer)}
              className={
                "rounded-xl border px-3 py-2.5 text-left transition-colors " +
                (activeLayer === layer
                  ? "border-chart-2/50 bg-chart-2/8"
                  : "border-border bg-card hover:bg-muted/40")
              }
            >
              <Pill tone={LAYER_TONE[layer]}>
                <StatusDot tone={LAYER_TONE[layer]} />
                {LAYER_LABELS[layer]}
              </Pill>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">
                {formatNumber(summary.tables)}
              </div>
              <div className="text-[10px] text-muted-foreground">tables · {summary.ops} ops</div>
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {summary.purpose}
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-muted-foreground" strokeWidth={1.75} />
            Operations
          </CardTitle>
          <CardDescription>
            Every operation that moves a row through the medallion, with the code that runs it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={activeLayer}
            onValueChange={(value) => {
              setActiveLayer(value as MedallionLayer | "all");
              setSelectedOpId(null);
            }}
          >
            <TabsList variant="line" aria-label="Medallion layer">
              <TabsTrigger value="all">All</TabsTrigger>
              {LAYER_ORDER.filter((l) => l !== "raw").map((layer) => (
                <TabsTrigger key={layer} value={layer}>
                  {LAYER_LABELS[layer]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="space-y-2">
              {opsForLayer.length === 0 ? (
                <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  No operations run directly on raw data.
                </div>
              ) : (
                opsForLayer.map((op) => (
                  <OperationRow
                    key={op.id}
                    op={op}
                    active={selectedOp?.id === op.id}
                    onSelect={() => setSelectedOpId(op.id)}
                  />
                ))
              )}
            </div>

            <div className="min-w-0 space-y-4">
              {selectedOp ? (
                <>
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Database className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                      <span className="text-xs text-muted-foreground">
                        {selectedOp.inputs.join(", ")}
                      </span>
                      <ChevronRight className="size-3 text-muted-foreground" />
                      <span className="text-xs font-medium">{selectedOp.outputs.join(", ")}</span>
                    </div>
                    <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
                      <code>{selectedOp.code}</code>
                    </pre>
                  </div>

                  <ImpactMeters op={selectedOp} />

                  {selectedOp.impact.rows_quarantined > 0 ? (
                    <p className="flex items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" strokeWidth={1.75} />
                      {formatNumber(selectedOp.impact.rows_quarantined)} rows were rejected into
                      quarantine, not silently dropped.
                    </p>
                  ) : null}

                  {(selectedOp.impact.columns_added.length > 0 ||
                    selectedOp.impact.columns_dropped.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {selectedOp.impact.columns_added.map((c) => (
                        <Badge key={`add-${c}`} variant="secondary" className="gap-1">
                          <Braces className="size-2.5" /> +{c}
                        </Badge>
                      ))}
                      {selectedOp.impact.columns_dropped.map((c) => (
                        <Badge key={`drop-${c}`} variant="outline" className="gap-1">
                          <Braces className="size-2.5" /> -{c}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="size-3" strokeWidth={1.75} />
                    {selectedOp.impact.latency_ms}ms per run
                  </div>
                </>
              ) : (
                <div className="grid h-32 place-items-center text-sm text-muted-foreground">
                  Select an operation to inspect it.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedOp ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Before / after sample</CardTitle>
            <CardDescription>
              A representative row from {selectedOp.inputs[0] ?? "the source"} before and after{" "}
              <code className="text-xs">{selectedOp.name}</code> runs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BeforeAfter sample={sample} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
