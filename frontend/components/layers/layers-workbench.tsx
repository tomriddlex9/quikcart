"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Boxes,
  Braces,
  ChevronRight,
  Clock,
  GitBranch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill, StatusDot } from "@/components/pill";
import { Loading } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  StackedTabs,
  StackedTabsContent,
  StackedTabsList,
  StackedTabsTrigger,
} from "@/components/ui/stacked-tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
const FILTER_LAYERS = ["all", "bronze", "silver", "quarantine", "gold"] as const;
type LayerFilter = (typeof FILTER_LAYERS)[number];

const LAYER_LABELS: Record<MedallionLayer | "all", string> = {
  all: "All",
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

function emptyOpsMessage(layer: LayerFilter): string {
  switch (layer) {
    case "all":
      return "No transform operations are registered in the catalog.";
    case "bronze":
      return "No bronze ingest operations in this catalog snapshot.";
    case "silver":
      return "No silver cleaning or conformation ops are defined yet.";
    case "quarantine":
      return "No quarantine retention ops — rejects would have nowhere auditable to land.";
    case "gold":
      return "No gold mart or feature-build operations are published yet.";
    default:
      return "No operations for this layer.";
  }
}

function emptySampleMessage(layer: MedallionLayer): string {
  switch (layer) {
    case "raw":
      return "Raw is the operational source; there is no upstream transform to sample.";
    case "bronze":
      return "No curated before/after rows for this bronze operation yet.";
    case "silver":
      return "No silver sample rows — open Transform SQL for the cleaner query.";
    case "quarantine":
      return "Quarantine samples show rejected rows once a silver cleaner runs.";
    case "gold":
      return "No gold sample rows — mart output appears after the build job runs.";
    default:
      return "No sample rows for this layer.";
  }
}

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

function IoChips({ inputs, outputs }: { inputs: string[]; outputs: string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {inputs.map((input) => (
        <Badge key={`in-${input}`} variant="outline" className="max-w-[9rem] truncate font-mono text-[10px]">
          {input}
        </Badge>
      ))}
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      {outputs.map((output) => (
        <Badge key={`out-${output}`} variant="secondary" className="max-w-[9rem] truncate font-mono text-[10px]">
          {output}
        </Badge>
      ))}
    </span>
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
  const ruleCount = op.rules?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex w-full flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors " +
        (active
          ? "border-chart-2/50 bg-chart-2/8"
          : "border-border bg-card hover:bg-muted/50")
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="truncate text-xs font-medium">{op.name}</code>
          <Badge variant="outline" className="text-[10px]">
            {ENGINE_LABEL[op.engine]}
          </Badge>
          {ruleCount > 0 ? (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <ShieldAlert className="size-2.5" strokeWidth={1.75} />
              {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
            </Badge>
          ) : null}
        </span>
        <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatNumber(op.impact.rows_out)}
          <span className="ml-1 text-[10px]">rows</span>
        </span>
      </span>
      <span className="truncate text-xs text-muted-foreground">{op.summary}</span>
      <IoChips inputs={op.inputs} outputs={op.outputs} />
    </button>
  );
}

function SampleTable({
  rows,
  layer,
}: {
  rows: Record<string, unknown>[];
  layer: MedallionLayer;
}) {
  if (rows.length === 0) {
    return (
      <div className="grid h-16 place-items-center px-3 text-center text-xs text-muted-foreground">
        {emptySampleMessage(layer)}
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
            <SampleTable rows={sample.before} layer={sample.layer} />
          </Card>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-chart-2">
            <Sparkles className="size-3" strokeWidth={1.75} />
            AFTER
          </div>
          <Card size="sm" className="overflow-hidden border-chart-2/30">
            <SampleTable rows={sample.after} layer={sample.layer} />
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

function RulesTable({ op }: { op: LayerOperation }) {
  const rules = op.rules ?? [];
  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No DQ predicates are attached to this operation — it may be ingest-only or a mart build.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px]">Rule</TableHead>
            <TableHead className="font-mono text-[10px]">Severity</TableHead>
            <TableHead className="font-mono text-[10px]">SQL predicate</TableHead>
            <TableHead className="font-mono text-[10px]">Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => (
            <TableRow key={rule.rule_id}>
              <TableCell className="whitespace-nowrap font-mono text-[11px]">{rule.rule_id}</TableCell>
              <TableCell className="text-[11px] capitalize">{rule.severity}</TableCell>
              <TableCell className="max-w-md font-mono text-[11px]">{rule.sql_predicate}</TableCell>
              <TableCell className="text-[11px] text-muted-foreground">{rule.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OperationDetail({ op, sample, isLive }: { op: LayerOperation; sample: LayerSample; isLive: boolean }) {
  return (
    <StackedTabs defaultValue="pipeline" className="min-w-0">
      <StackedTabsList aria-label="Operation detail">
        <StackedTabsTrigger value="pipeline">Pipeline</StackedTabsTrigger>
        <StackedTabsTrigger value="sql">Transform SQL</StackedTabsTrigger>
        <StackedTabsTrigger value="rules">
          Rules / DQ{op.rules?.length ? ` (${op.rules.length})` : ""}
        </StackedTabsTrigger>
        <StackedTabsTrigger value="sample">Before → After</StackedTabsTrigger>
      </StackedTabsList>

      <StackedTabsContent value="pipeline">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{op.summary}</p>
            <IoChips inputs={op.inputs} outputs={op.outputs} />
          </div>
          <ImpactMeters op={op} />
          {op.impact.rows_quarantined > 0 ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" strokeWidth={1.75} />
              {formatNumber(op.impact.rows_quarantined)} rows were rejected into quarantine, not silently
              dropped.
            </p>
          ) : null}
          {(op.impact.columns_added.length > 0 || op.impact.columns_dropped.length > 0) && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {op.impact.columns_added.map((c) => (
                <Badge key={`add-${c}`} variant="secondary" className="gap-1">
                  <Braces className="size-2.5" /> +{c}
                </Badge>
              ))}
              {op.impact.columns_dropped.map((c) => (
                <Badge key={`drop-${c}`} variant="outline" className="gap-1">
                  <Braces className="size-2.5" /> -{c}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="size-3" strokeWidth={1.75} />
            {op.impact.latency_ms}ms per run
            {isLive ? (
              <Badge variant="outline" className="ml-2 text-[10px]">
                live catalog
              </Badge>
            ) : null}
          </div>
        </div>
      </StackedTabsContent>

      <StackedTabsContent value="sql">
        <pre className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
          <code>{op.code}</code>
        </pre>
      </StackedTabsContent>

      <StackedTabsContent value="rules">
        <RulesTable op={op} />
      </StackedTabsContent>

      <StackedTabsContent value="sample">
        <BeforeAfter sample={sample} />
      </StackedTabsContent>
    </StackedTabs>
  );
}

function LayerSummaryTile({
  layer,
  summary,
  active,
  onSelect,
}: {
  layer: MedallionLayer;
  summary: { tables: number; ops: number; purpose: string };
  active: boolean;
  onSelect: () => void;
}) {
  const body = (
    <>
      <Pill tone={LAYER_TONE[layer]}>
        <StatusDot tone={LAYER_TONE[layer]} />
        {LAYER_LABELS[layer]}
      </Pill>
      <div className="mt-2 font-mono text-lg font-semibold tabular-nums">
        {formatNumber(summary.tables)}
      </div>
      <div className="text-[10px] text-muted-foreground">tables · {summary.ops} ops</div>
      <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{summary.purpose}</div>
    </>
  );

  if (layer === "raw") {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-left">
        {body}
        <Link
          href="/database?layer=raw"
          className={cn(buttonVariants({ variant: "link", size: "sm" }), "mt-2 h-auto px-0")}
        >
          Open raw tables
        </Link>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "rounded-xl border px-3 py-2.5 text-left transition-colors " +
        (active ? "border-chart-2/50 bg-chart-2/8" : "border-border bg-card hover:bg-muted/40")
      }
    >
      {body}
    </button>
  );
}

export function LayersWorkbench() {
  const searchParams = useSearchParams();
  const deepLinkOp = searchParams.get("op");

  const catalogState = useApiData<LayersCatalog>(
    "/api/v1/layers/operations",
    DEMO_LAYERS_CATALOG,
    60_000,
  );
  const catalog = catalogState.data ?? DEMO_LAYERS_CATALOG;
  const isLive = catalogState.mode === "live";
  const showBanner = catalogState.mode !== "live";

  const [activeLayer, setActiveLayer] = useState<LayerFilter>("bronze");
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);

  useEffect(() => {
    if (!deepLinkOp) return;
    const match = catalog.operations.find((op) => op.id === deepLinkOp);
    if (!match) return;
    if (match.layer !== "raw") {
      setActiveLayer(match.layer);
    }
    setSelectedOpId(match.id);
  }, [deepLinkOp, catalog.operations]);

  const opsForLayer = useMemo(
    () =>
      activeLayer === "all"
        ? catalog.operations
        : catalog.operations.filter((op) => op.layer === activeLayer),
    [catalog.operations, activeLayer],
  );

  const selectedOp =
    catalog.operations.find((op) => op.id === selectedOpId) ?? opsForLayer[0] ?? null;

  const demoSampleFallback: LayerSample = selectedOp
    ? (DEMO_LAYER_SAMPLES[selectedOp.id] ?? {
        layer: selectedOp.layer,
        op_id: selectedOp.id,
        before: [],
        after: [],
        notes: [],
      })
    : { layer: "bronze", before: [], after: [], notes: [] };

  const sampleState = useApiData<LayerSample>(
    selectedOp ? `/api/v1/layers/operations/${selectedOp.id}/sample` : null,
    demoSampleFallback,
    0,
  );

  const sample: LayerSample = useMemo(() => {
    if (!selectedOp) {
      return { layer: "bronze", before: [], after: [], notes: [] };
    }
    if (isLive) {
      return (
        sampleState.data ?? {
          layer: selectedOp.layer,
          op_id: selectedOp.id,
          before: [],
          after: [],
          notes: [],
        }
      );
    }
    return (
      DEMO_LAYER_SAMPLES[selectedOp.id] ??
      sampleState.data ?? {
        layer: selectedOp.layer,
        op_id: selectedOp.id,
        before: [],
        after: [],
        notes: [],
      }
    );
  }, [isLive, sampleState.data, selectedOp]);

  if (catalogState.data === null) {
    return <Loading label="Loading layer operations…" />;
  }

  return (
    <div className="space-y-4">
      {showBanner ? <ApiBanner mode={catalogState.mode} error={catalogState.error} /> : null}

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
          <Medallion activeLayer={activeLayer === "all" ? "bronze" : activeLayer} />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LAYER_ORDER.map((layer) => {
          const summary = catalog.layer_summaries[layer];
          if (!summary) return null;
          return (
            <LayerSummaryTile
              key={layer}
              layer={layer}
              summary={summary}
              active={activeLayer === layer}
              onSelect={() => {
                if (layer === "raw") return;
                setActiveLayer(layer);
                setSelectedOpId(null);
              }}
            />
          );
        })}
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-muted-foreground" strokeWidth={1.75} />
            Transform catalog
          </CardTitle>
          <CardDescription>
            Operations from the lakehouse transform catalog — SQL mirrors, DQ rules, and row impact.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <StackedTabs
            value={activeLayer}
            onValueChange={(value) => {
              if (!FILTER_LAYERS.includes(value as LayerFilter)) return;
              setActiveLayer(value as LayerFilter);
              setSelectedOpId(null);
            }}
            className="min-w-0"
          >
            <StackedTabsList aria-label="Medallion layer">
              {FILTER_LAYERS.map((layer) => (
                <StackedTabsTrigger key={layer} value={layer}>
                  {LAYER_LABELS[layer]}
                  {layer !== "all" ? (
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                      {catalog.layer_summaries[layer]?.ops ?? 0}
                    </span>
                  ) : (
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                      {catalog.operations.length}
                    </span>
                  )}
                </StackedTabsTrigger>
              ))}
            </StackedTabsList>

            <StackedTabsContent value={activeLayer}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="space-y-2">
                  {opsForLayer.length === 0 ? (
                    <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
                      {emptyOpsMessage(activeLayer)}
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

                <div className="min-w-0">
                  {selectedOp ? (
                    <OperationDetail op={selectedOp} sample={sample} isLive={isLive} />
                  ) : (
                    <div className="grid h-32 place-items-center text-sm text-muted-foreground">
                      Select an operation to inspect pipeline, SQL, rules, and samples.
                    </div>
                  )}
                </div>
              </div>
            </StackedTabsContent>
          </StackedTabs>
        </CardContent>
      </Card>
    </div>
  );
}
