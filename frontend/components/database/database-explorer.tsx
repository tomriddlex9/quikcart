"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, RefreshCw, Rows3, Table2 } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { ErDiagram } from "@/components/database/er-diagram";
import { LayerCounts } from "@/components/database/layer-counts";
import {
  LineageDiagram,
  useCatalogLineage,
} from "@/components/database/lineage-diagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE, type ApiMode } from "@/lib/api";
import type {
  CatalogTable,
  CatalogTablesResponse,
  ErDiagramResponse,
} from "@/lib/types";
import type { LineageLayer, LineageNode } from "@/lib/live-types";

const CATALOG_TIMEOUT_MS = 30_000;
const LAYERS: LineageLayer[] = ["raw", "bronze", "silver", "quarantine", "gold"];
const LAYER_LABELS: Record<LineageLayer, string> = {
  raw: "Raw",
  bronze: "Bronze",
  silver: "Silver",
  quarantine: "Quarantine",
  gold: "Gold",
};
const EMPTY_LINEAGE_NODES: LineageNode[] = [];
type ExplorerTab = LineageLayer | "lineage";
type ExplorerTable = Omit<CatalogTable, "layer"> & { layer: LineageLayer };
interface ExplorerPreview {
  table: string;
  layer: LineageLayer;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

const DEMO_TABLES: ExplorerTable[] = [
  {
    name: "orders",
    layer: "raw",
    row_count: 184_205,
    columns: [
      { name: "order_id", type: "bigint", nullable: false },
      { name: "customer_id", type: "bigint", nullable: false },
      { name: "store_id", type: "integer", nullable: false },
      { name: "status", type: "varchar", nullable: false },
      { name: "total_amount", type: "numeric(12,2)", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "customers",
    layer: "raw",
    row_count: 24_810,
    columns: [
      { name: "customer_id", type: "bigint", nullable: false },
      { name: "full_name", type: "varchar", nullable: false },
      { name: "email", type: "varchar", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "products",
    layer: "raw",
    row_count: 1_260,
    columns: [
      { name: "product_id", type: "bigint", nullable: false },
      { name: "sku", type: "varchar", nullable: false },
      { name: "name", type: "varchar", nullable: false },
      { name: "category", type: "varchar", nullable: false },
    ],
  },
  {
    name: "orders",
    layer: "bronze",
    row_count: 184_205,
    path: "data/bronze/orders",
    columns: [
      { name: "payload", type: "string", nullable: false },
      { name: "source_table", type: "string", nullable: false },
      { name: "ingested_at", type: "timestamp", nullable: false },
      { name: "source_file", type: "string" },
    ],
  },
  {
    name: "inventory",
    layer: "bronze",
    row_count: 42_600,
    path: "data/bronze/inventory",
    columns: [
      { name: "payload", type: "string", nullable: false },
      { name: "source_table", type: "string", nullable: false },
      { name: "ingested_at", type: "timestamp", nullable: false },
    ],
  },
  {
    name: "orders",
    layer: "silver",
    row_count: 183_996,
    path: "data/silver/orders",
    columns: [
      { name: "order_id", type: "long", nullable: false },
      { name: "customer_id", type: "long", nullable: false },
      { name: "store_id", type: "integer", nullable: false },
      { name: "order_status", type: "string", nullable: false },
      { name: "order_total", type: "decimal(12,2)", nullable: false },
      { name: "created_at", type: "timestamp", nullable: false },
    ],
  },
  {
    name: "deliveries",
    layer: "silver",
    row_count: 176_482,
    path: "data/silver/deliveries",
    columns: [
      { name: "delivery_id", type: "long", nullable: false },
      { name: "order_id", type: "long", nullable: false },
      { name: "rider_id", type: "long" },
      { name: "delivered_at", type: "timestamp" },
      { name: "is_late", type: "boolean", nullable: false },
    ],
  },
  {
    name: "store_hourly_metrics",
    layer: "gold",
    row_count: 28_940,
    path: "data/gold/store_hourly_metrics",
    columns: [
      { name: "store_id", type: "integer", nullable: false },
      { name: "hour", type: "timestamp", nullable: false },
      { name: "orders", type: "long", nullable: false },
      { name: "gmv", type: "decimal(18,2)", nullable: false },
      { name: "late_rate", type: "double", nullable: false },
    ],
  },
  {
    name: "inventory_health",
    layer: "gold",
    row_count: 6_930,
    path: "data/gold/inventory_health",
    columns: [
      { name: "store_id", type: "integer", nullable: false },
      { name: "sku", type: "string", nullable: false },
      { name: "on_hand_qty", type: "integer", nullable: false },
      { name: "stock_cover_hours", type: "double", nullable: false },
      { name: "is_below_reorder_point", type: "boolean", nullable: false },
    ],
  },
];

const DEMO_ER: ErDiagramResponse = {
  tables: [
    { name: "customers", columns: ["customer_id", "full_name", "email"] },
    { name: "orders", columns: ["order_id", "customer_id", "store_id", "status"] },
    { name: "stores", columns: ["store_id", "name", "city"] },
    { name: "order_items", columns: ["order_item_id", "order_id", "product_id", "quantity"] },
    { name: "products", columns: ["product_id", "sku", "name"] },
  ],
  edges: [
    {
      from_table: "orders",
      from_column: "customer_id",
      to_table: "customers",
      to_column: "customer_id",
    },
    {
      from_table: "orders",
      from_column: "store_id",
      to_table: "stores",
      to_column: "store_id",
    },
    {
      from_table: "order_items",
      from_column: "order_id",
      to_table: "orders",
      to_column: "order_id",
    },
    {
      from_table: "order_items",
      from_column: "product_id",
      to_table: "products",
      to_column: "product_id",
    },
  ],
};

function isExplorerTab(value: string): value is ExplorerTab {
  return value === "lineage" || LAYERS.includes(value as LineageLayer);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function demoValue(column: ExplorerTable["columns"][number], rowIndex: number): unknown {
  const name = column.name.toLowerCase();
  const type = column.type.toLowerCase();
  if (name.includes("timestamp") || name.endsWith("_at") || name === "hour") {
    return `2026-09-24T${String(10 + rowIndex).padStart(2, "0")}:00:00Z`;
  }
  if (type.includes("bool") || name.startsWith("is_")) return rowIndex % 2 === 0;
  if (type.includes("int") || type.includes("long") || name.endsWith("_id")) return 1001 + rowIndex;
  if (type.includes("decimal") || type.includes("double") || name.includes("rate")) {
    return Number((24.5 + rowIndex * 3.25).toFixed(2));
  }
  if (name === "status" || name.endsWith("_status")) return rowIndex === 0 ? "DELIVERED" : "PLACED";
  if (name === "sku") return `QC-${100 + rowIndex}`;
  if (name === "email") return `demo${rowIndex + 1}@example.test`;
  if (name === "payload") return JSON.stringify({ demo: true, sequence: rowIndex + 1 });
  return `${column.name}_${rowIndex + 1}`;
}

function makeDemoPreview(table: ExplorerTable): ExplorerPreview {
  return {
    table: table.name,
    layer: table.layer,
    columns: table.columns.map((column) => column.name),
    rows: Array.from({ length: 3 }, (_, rowIndex) =>
      Object.fromEntries(table.columns.map((column) => [column.name, demoValue(column, rowIndex)])),
    ),
  };
}

function lineageNodeToTable(node: LineageNode): ExplorerTable {
  return {
    name: node.name,
    layer: node.layer,
    row_count: node.row_count,
    path: `${node.layer}/${node.name}`,
    columns: node.columns.map((name) => ({ name, type: "reported" })),
  };
}

async function getCatalogJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface RequestState<T> {
  data: T | null;
  loading: boolean;
  mode: ApiMode;
  error: string | null;
}

function TableList({
  tables,
  selectedName,
  onSelect,
  loading,
}: {
  tables: ExplorerTable[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  loading: boolean;
}) {
  return (
    <Card className="min-h-[25rem]">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          Tables
        </CardTitle>
        <CardAction>
          <Badge variant="secondary">{loading ? "…" : tables.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        {loading ? (
          <div className="space-y-2 px-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <div className="grid h-56 place-items-center px-4 text-center text-sm text-muted-foreground">
            No tables reported in this layer.
          </div>
        ) : (
          <ScrollArea className="h-[22rem]">
            <div className="space-y-1 pr-2">
              {tables.map((table) => (
                <button
                  key={table.name}
                  type="button"
                  onClick={() => onSelect(table.name)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-muted data-[selected=true]:font-medium"
                  data-selected={selectedName === table.name}
                >
                  <span className="min-w-0 truncate font-mono text-xs">{table.name}</span>
                  {table.row_count !== undefined && table.row_count !== null ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {table.row_count.toLocaleString()}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function SchemaCard({ table }: { table: ExplorerTable }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 font-mono">
          <Table2 className="size-4 text-muted-foreground" />
          {table.name}
        </CardTitle>
        <CardDescription className="truncate">
          {table.path ?? `${table.layer} catalog`}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Badge variant="outline">{table.layer}</Badge>
          {table.row_count !== undefined && table.row_count !== null ? (
            <Badge variant="secondary">
              <Rows3 data-icon="inline-start" />
              {table.row_count.toLocaleString()} rows
            </Badge>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Column</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="pr-4 text-right">Nullable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.columns.map((column) => (
              <TableRow key={column.name}>
                <TableCell className="pl-4 font-mono text-xs">{column.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{column.type}</TableCell>
                <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                  {column.nullable === undefined ? "—" : column.nullable ? "yes" : "no"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PreviewCard({
  preview,
  loading,
  mode,
  error,
  onRetry,
}: {
  preview: ExplorerPreview | null;
  loading: boolean;
  mode: ApiMode;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Row preview</CardTitle>
        <CardDescription>Sample records from the selected table</CardDescription>
        <CardAction className="flex items-center gap-2">
          {mode === "demo" ? <Badge variant="outline">Demo rows</Badge> : null}
          <Button variant="ghost" size="icon-sm" onClick={onRetry} disabled={loading} aria-label="Refresh row preview">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {loading ? (
          <div className="space-y-2 px-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : preview ? (
          <>
            {error ? (
              <p className="border-b px-4 pb-3 text-xs text-muted-foreground">
                Live preview failed ({error}); showing synthetic rows.
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.columns.map((column) => (
                    <TableHead key={column} className="font-mono text-xs first:pl-4 last:pr-4">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={Math.max(preview.columns.length, 1)} className="h-28 text-center text-muted-foreground">
                      This table has no preview rows.
                    </TableCell>
                  </TableRow>
                ) : (
                  preview.rows.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {preview.columns.map((column) => (
                        <TableCell
                          key={column}
                          className="max-w-72 truncate font-mono text-xs first:pl-4 last:pr-4"
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
          </>
        ) : (
          <div className="grid h-36 place-items-center text-sm text-muted-foreground">
            Preview unavailable{error ? `: ${error}` : "."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DatabaseExplorer() {
  const [activeTab, setActiveTab] = useState<ExplorerTab>("raw");
  const [selectedNames, setSelectedNames] = useState<Partial<Record<LineageLayer, string>>>({});
  const [selectedLineageNodeId, setSelectedLineageNodeId] = useState<string | null>(null);
  const [tablesState, setTablesState] = useState<RequestState<ExplorerTable[]>>({
    data: null,
    loading: true,
    mode: "live",
    error: null,
  });
  const [previewState, setPreviewState] = useState<RequestState<ExplorerPreview>>({
    data: null,
    loading: false,
    mode: "live",
    error: null,
  });
  const [erState, setErState] = useState<RequestState<ErDiagramResponse>>({
    data: null,
    loading: true,
    mode: "live",
    error: null,
  });
  const [previewVersion, setPreviewVersion] = useState(0);
  const lineageState = useCatalogLineage();

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);

    getCatalogJson<CatalogTablesResponse>("/api/v1/catalog/tables", controller.signal)
      .then((response) => {
        setTablesState({ data: response.tables, loading: false, mode: "live", error: null });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted && requestError instanceof DOMException && requestError.name === "AbortError") {
          setTablesState({
            data: DEMO_TABLES,
            loading: false,
            mode: "demo",
            error: "catalog request timed out",
          });
          return;
        }
        setTablesState({
          data: DEMO_TABLES,
          loading: false,
          mode: "demo",
          error: requestError instanceof Error ? requestError.message : "catalog request failed",
        });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);

    getCatalogJson<ErDiagramResponse>("/api/v1/catalog/er", controller.signal)
      .then((response) => {
        setErState({ data: response, loading: false, mode: "live", error: null });
      })
      .catch((requestError: unknown) => {
        setErState({
          data: DEMO_ER,
          loading: false,
          mode: "demo",
          error:
            controller.signal.aborted
              ? "relationship request timed out"
              : requestError instanceof Error
                ? requestError.message
                : "relationship request failed",
        });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const activeLayer = activeTab === "lineage" ? null : activeTab;
  const lineageNodes = lineageState.data?.nodes ?? EMPTY_LINEAGE_NODES;
  const layerTables = useMemo(() => {
    if (!activeLayer) return [];
    if (activeLayer === "raw") {
      return (tablesState.data ?? []).filter((table) => table.layer === activeLayer);
    }
    return lineageNodes
      .filter((node) => node.layer === activeLayer)
      .map(lineageNodeToTable);
  }, [activeLayer, lineageNodes, tablesState.data]);
  const selectedName = activeLayer
    ? selectedNames[activeLayer] ?? layerTables[0]?.name ?? null
    : null;
  const selectedTable = layerTables.find((table) => table.name === selectedName) ?? layerTables[0] ?? null;
  const selectedLineageNode =
    lineageNodes.find((node) => node.id === selectedLineageNodeId) ?? null;
  const lineageSelectedTable = useMemo(
    () => (selectedLineageNode ? lineageNodeToTable(selectedLineageNode) : null),
    [selectedLineageNode],
  );
  const inspectedTable = activeTab === "lineage" ? lineageSelectedTable : selectedTable;
  const visiblePreview =
    inspectedTable &&
    previewState.data?.table === inspectedTable.name &&
    previewState.data.layer === inspectedTable.layer
      ? previewState.data
      : null;

  useEffect(() => {
    if (!inspectedTable) {
      setPreviewState({ data: null, loading: false, mode: tablesState.mode, error: null });
      return;
    }

    const metadataMode = inspectedTable.layer === "raw" ? tablesState.mode : lineageState.mode;
    if (metadataMode === "demo") {
      setPreviewState({
        data: makeDemoPreview(inspectedTable),
        loading: false,
        mode: "demo",
        error: null,
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    setPreviewState({ data: null, loading: true, mode: "live", error: null });

    getCatalogJson<ExplorerPreview>(
      `/api/v1/catalog/tables/${encodeURIComponent(inspectedTable.layer)}/${encodeURIComponent(inspectedTable.name)}/preview`,
      controller.signal,
    )
      .then((response) => {
        setPreviewState({ data: response, loading: false, mode: "live", error: null });
      })
      .catch((requestError: unknown) => {
        setPreviewState({
          data: makeDemoPreview(inspectedTable),
          loading: false,
          mode: "demo",
          error:
            controller.signal.aborted
              ? "request timed out"
              : requestError instanceof Error
                ? requestError.message
                : "request failed",
        });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [inspectedTable, lineageState.mode, previewVersion, tablesState.mode]);

  const selectTable = useCallback(
    (name: string) => {
      if (activeLayer) {
        setSelectedNames((current) => ({ ...current, [activeLayer]: name }));
      }
    },
    [activeLayer],
  );

  return (
    <div>
      {tablesState.mode !== "live" ? <ApiBanner mode={tablesState.mode} error={tablesState.error} /> : null}

      <Tabs value={activeTab} onValueChange={(value) => isExplorerTab(value) && setActiveTab(value)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="line" aria-label="Catalog layer">
            {LAYERS.map((layer) => (
              <TabsTrigger key={layer} value={layer}>
                {LAYER_LABELS[layer]}
              </TabsTrigger>
            ))}
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
          </TabsList>
          <LayerCounts />
        </div>

        {LAYERS.map((layer) => (
          <TabsContent key={layer} value={layer} className="pt-3">
            {activeTab === layer ? (
              <div className="space-y-4">
                {layer === "quarantine" ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
                    Quarantine contains filtered / rejected rows that failed validation. Records
                    remain inspectable instead of being silently discarded.
                  </div>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
                  <TableList
                    tables={layerTables}
                    selectedName={selectedTable?.name ?? null}
                    onSelect={selectTable}
                    loading={layer === "raw" ? tablesState.loading : lineageState.loading}
                  />
                  <div className="min-w-0 space-y-4">
                    {(layer === "raw" ? tablesState.loading : lineageState.loading) ? (
                      <>
                        <Skeleton className="h-72 w-full" />
                        <Skeleton className="h-64 w-full" />
                      </>
                    ) : selectedTable ? (
                      <>
                        <SchemaCard table={selectedTable} />
                        <PreviewCard
                          preview={visiblePreview}
                          loading={previewState.loading || visiblePreview === null}
                          mode={previewState.mode}
                          error={previewState.error}
                          onRetry={() => setPreviewVersion((version) => version + 1)}
                        />
                      </>
                    ) : (
                      <Card className="grid min-h-[25rem] place-items-center">
                        <p className="text-sm text-muted-foreground">Select a table to inspect it.</p>
                      </Card>
                    )}
                  </div>
                </div>

                <Card>
                  <CardHeader className="border-b">
                    <CardTitle>{layer === "raw" ? "Entity relationships" : `${LAYER_LABELS[layer]} tables`}</CardTitle>
                    <CardDescription>
                      {layer === "raw"
                        ? "Foreign-key relationships in the operational source"
                        : layer === "quarantine"
                          ? "Filtered / rejected tables and their reported schemas"
                          : `Tables reported by the ${LAYER_LABELS[layer]} lineage catalog`}
                    </CardDescription>
                    <CardAction>
                      {layer === "raw" ? (
                        <Badge variant={erState.mode === "live" ? "secondary" : "outline"}>
                          {erState.mode === "live" ? "Live catalog" : "Demo diagram"}
                        </Badge>
                      ) : (
                        <Badge variant={lineageState.mode === "live" ? "secondary" : "outline"}>
                          {lineageState.mode === "live" ? "Live lineage" : "Demo schema"}
                        </Badge>
                      )}
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    {layer === "raw" && erState.error ? (
                        <p className="mb-3 text-xs text-muted-foreground">
                          Live relationship metadata failed ({erState.error}); showing the demo model.
                        </p>
                    ) : null}
                    <ErDiagram
                      diagram={layer === "raw" ? erState.data : null}
                      nodes={lineageNodes.filter((node) => node.layer === layer)}
                      layer={layer}
                      loading={layer === "raw" ? erState.loading : lineageState.loading}
                    />
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </TabsContent>
        ))}

        <TabsContent value="lineage" className="pt-3">
          {activeTab === "lineage" ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Cross-layer lineage</CardTitle>
                  <CardDescription>
                    Follow batch, CDC, stream, and ML paths from PostgreSQL to Gold
                  </CardDescription>
                  <CardAction>
                    <Badge variant={lineageState.mode === "live" ? "secondary" : "outline"}>
                      {lineageState.mode === "live" ? "Live catalog" : "Demo topology"}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {lineageState.error ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Live lineage failed ({lineageState.error}); showing the demo topology.
                    </p>
                  ) : null}
                  <LineageDiagram
                    lineage={lineageState.data}
                    loading={lineageState.loading}
                    selectedNodeId={selectedLineageNodeId}
                    onNodeSelect={(node) => {
                      setSelectedLineageNodeId(node.id);
                      setPreviewVersion((version) => version + 1);
                    }}
                  />
                </CardContent>
              </Card>

              {lineageSelectedTable ? (
                <div className="space-y-4">
                  <SchemaCard table={lineageSelectedTable} />
                  <PreviewCard
                    preview={visiblePreview}
                    loading={previewState.loading || visiblePreview === null}
                    mode={previewState.mode}
                    error={previewState.error}
                    onRetry={() => setPreviewVersion((version) => version + 1)}
                  />
                </div>
              ) : (
                <Card className="grid min-h-28 place-items-center">
                  <p className="text-sm text-muted-foreground">
                    Select a lineage node to inspect its schema and preview rows.
                  </p>
                </Card>
              )}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
