"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Code2, Database, ListTree, Table2 } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import {
  LineageDiagram,
  useCatalogLineage,
} from "@/components/database/lineage-diagram";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useApiData } from "@/lib/use-api";
import type { LayerOperation } from "@/lib/layer-cube-types";
import type { CatalogLayer, CatalogPreviewResponse, CatalogTablesResponse } from "@/lib/types";

const LAYERS: CatalogLayer[] = ["raw", "bronze", "silver", "quarantine", "gold"];

const LAYER_LABEL: Record<CatalogLayer, string> = {
  raw: "Raw",
  bronze: "Bronze",
  silver: "Silver",
  quarantine: "Quarantine",
  gold: "Gold",
};

const LAYER_PURPOSE: Record<CatalogLayer, string> = {
  raw: "PostgreSQL operational source of truth",
  bronze: "Append-only landings from batch, CDC, and external feeds",
  silver: "DQ-cleaned, deduped entities",
  quarantine: "Rejected rows retained with structured error codes",
  gold: "Business marts and ML write-backs",
};

type TransformsResponse = {
  table: string;
  operations: LayerOperation[];
};

function PreviewTable({
  preview,
  loading,
}: {
  preview: CatalogPreviewResponse | null;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (!preview?.rows?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No preview rows yet — the table may be empty or Spark may still be warming.
      </p>
    );
  }
  const cols = preview.columns;
  return (
    <ScrollArea className="h-64 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className="font-mono text-[11px]">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.rows.slice(0, 40).map((row, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c} className="max-w-[12rem] truncate font-mono text-[11px]">
                  {row[c] == null ? "∅" : String(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function TransformPanel({
  table,
  layer,
}: {
  table: string | null;
  layer: CatalogLayer;
}) {
  const path =
    table && layer !== "raw" ? `/api/v1/layers/transforms/${encodeURIComponent(table)}` : null;
  const state = useApiData<TransformsResponse>(
    path,
    { table: table ?? "", operations: [] },
    0,
  );
  const ops = state.data?.operations ?? [];

  if (layer === "raw") {
    return (
      <p className="text-sm text-muted-foreground">
        Raw tables are the operational source — no upstream lakehouse transform.
      </p>
    );
  }
  if (!table) {
    return <p className="text-sm text-muted-foreground">Select a table to see its transforms.</p>;
  }
  if (state.data === null && path !== null) return <Skeleton className="h-40 w-full" />;
  if (ops.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No registered transform ops for <code>{table}</code> yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {ops.map((op) => (
        <div key={op.id} className="space-y-2 rounded-lg border border-border/80 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{op.layer}</Badge>
            <span className="text-sm font-medium">{op.name}</span>
            <Badge variant="outline">{op.engine}</Badge>
            <Link
              href={`/layers?op=${encodeURIComponent(op.id)}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto h-7 text-xs")}
            >
              Open in Layers
              <ArrowRight className="size-3" />
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">{op.summary}</p>
          <div className="flex flex-wrap gap-1 text-[11px]">
            {op.inputs.map((i) => (
              <Badge key={i} variant="outline" className="font-mono font-normal">
                {i}
              </Badge>
            ))}
            <ArrowRight className="size-3 self-center text-muted-foreground" />
            {op.outputs.map((o) => (
              <Badge key={o} variant="outline" className="font-mono font-normal">
                {o}
              </Badge>
            ))}
          </div>
          <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {op.code}
          </pre>
          {op.rules && op.rules.length > 0 ? (
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {op.rules.map((r) => (
                <li key={r.rule_id}>
                  <span className="font-mono text-foreground">{r.rule_id}</span> ·{" "}
                  <code>{r.sql_predicate}</code> — {r.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function DatabaseWorkbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLayer = searchParams.get("layer");
  const initialTable = searchParams.get("table");
  const lineageState = useCatalogLineage();

  const tablesState = useApiData<CatalogTablesResponse>(
    "/api/v1/catalog/tables",
    { tables: [] },
    60_000,
  );
  const [layer, setLayer] = useState<CatalogLayer | "lineage">(() => {
    if (initialLayer === "lineage") return "lineage";
    if (initialLayer && LAYERS.includes(initialLayer as CatalogLayer)) {
      return initialLayer as CatalogLayer;
    }
    return "bronze";
  });
  const [selected, setSelected] = useState<string | null>(initialTable);

  const tables = useMemo(() => {
    const all = tablesState.data?.tables ?? [];
    if (layer === "lineage") return all;
    return all.filter((t) => t.layer === layer);
  }, [tablesState.data, layer]);

  useEffect(() => {
    if (layer === "lineage") return;
    if (!tables.some((t) => t.name === selected)) {
      setSelected(tables[0]?.name ?? null);
    }
  }, [layer, tables, selected]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("layer", layer);
    if (selected && layer !== "lineage") params.set("table", selected);
    const next = `/database?${params.toString()}`;
    const current = `/database?${searchParams.toString()}`;
    if (next !== current) {
      router.replace(next, { scroll: false });
    }
  }, [layer, selected, router, searchParams]);

  const selectedTable = tables.find((t) => t.name === selected) ?? null;

  const previewPath =
    selectedTable && layer !== "lineage"
      ? `/api/v1/catalog/tables/${layer}/${encodeURIComponent(selectedTable.name)}/preview?limit=40`
      : null;
  const previewState = useApiData<CatalogPreviewResponse>(
    previewPath,
    {
      name: selectedTable?.name ?? "",
      layer: (layer === "lineage" ? "bronze" : layer) as CatalogLayer,
      columns: [],
      rows: [],
    },
    0,
  );

  return (
    <div className="space-y-4">
      {tablesState.mode !== "live" ? (
        <ApiBanner mode={tablesState.mode} error={tablesState.error} />
      ) : null}

      <StackedTabs
        value={layer}
        onValueChange={(v) => {
          if (v === "lineage" || LAYERS.includes(v as CatalogLayer)) {
            setLayer(v as CatalogLayer | "lineage");
          }
        }}
      >
        <StackedTabsList aria-label="Database section">
          {LAYERS.map((l) => (
            <StackedTabsTrigger key={l} value={l}>
              {LAYER_LABEL[l]}
            </StackedTabsTrigger>
          ))}
          <StackedTabsTrigger value="lineage">Lineage</StackedTabsTrigger>
        </StackedTabsList>
        <p className="px-1 text-xs text-muted-foreground">
          {layer === "lineage" ? "Edges across the medallion" : LAYER_PURPOSE[layer]}
        </p>

        <StackedTabsContent value="lineage">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListTree className="size-3.5" />
                Data lineage
              </CardTitle>
              <CardDescription className="text-xs">
                Click a node in the diagram, then switch to its layer tab to inspect schema and
                transforms.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineageDiagram
                lineage={lineageState.data}
                loading={lineageState.loading}
                onNodeSelect={(node) => {
                  if (LAYERS.includes(node.layer as CatalogLayer)) {
                    setLayer(node.layer as CatalogLayer);
                    setSelected(node.name);
                  }
                }}
              />
            </CardContent>
          </Card>
        </StackedTabsContent>

        {LAYERS.map((l) => (
          <StackedTabsContent key={l} value={l}>
            {layer === l ? (
              <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <Card size="sm" className="min-h-[28rem]">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Database className="size-3.5" />
                      Tables
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {tablesState.data === null ? "Loading…" : `${tables.length} in ${l}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {l === "quarantine" ? (
                      <p className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-muted-foreground">
                        Quarantine keeps rejected rows with <code>_error_codes</code> — nothing is
                        silently dropped.
                      </p>
                    ) : null}
                    <ScrollArea className="h-[24rem]">
                      <ul className="p-2">
                        {tablesState.data === null ? (
                          <li className="p-2">
                            <Skeleton className="h-8 w-full" />
                          </li>
                        ) : tables.length === 0 ? (
                          <li className="px-3 py-6 text-xs text-muted-foreground">
                            No tables reported in {l}. Run the lakehouse pipeline or wait for
                            live-worker.
                          </li>
                        ) : (
                          tables.map((t) => (
                            <li key={t.name}>
                              <button
                                type="button"
                                onClick={() => setSelected(t.name)}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                                  selected === t.name
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-muted/60"
                                }`}
                              >
                                <Table2 className="size-3 shrink-0 opacity-60" />
                                <span className="truncate font-mono">{t.name}</span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <div className="min-w-0 space-y-4">
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle className="text-sm font-mono">
                        {selectedTable?.name ?? "Select a table"}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {selectedTable
                          ? `${selectedTable.columns.length} columns · ${LAYER_PURPOSE[l]}`
                          : LAYER_PURPOSE[l]}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {selectedTable ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedTable.columns.map((c) => (
                            <Badge
                              key={c.name}
                              variant="outline"
                              className="font-mono text-[10px] font-normal"
                            >
                              {c.name}
                              <span className="ml-1 opacity-60">{c.type}</span>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Skeleton className="h-8 w-2/3" />
                      )}
                      <PreviewTable
                        preview={previewState.data}
                        loading={previewState.data === null && previewPath !== null}
                      />
                    </CardContent>
                  </Card>

                  <Card size="sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Code2 className="size-3.5" />
                        Transforms
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Cleaning and mart SQL that produce or consume this table (from lakehouse
                        CLEANERS / MARTS).
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <TransformPanel table={selected} layer={l} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}
          </StackedTabsContent>
        ))}
      </StackedTabs>
    </div>
  );
}
