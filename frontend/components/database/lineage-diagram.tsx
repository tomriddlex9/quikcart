"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGetJson, type ApiMode } from "@/lib/api";
import type {
  CatalogLineage,
  LineageEdge,
  LineageLayer,
  LineageNode,
} from "@/lib/live-types";

const LAYER_ORDER: LineageLayer[] = ["raw", "bronze", "silver", "quarantine", "gold"];
const LAYER_LABELS: Record<LineageLayer, string> = {
  raw: "Raw",
  bronze: "Bronze",
  silver: "Silver",
  quarantine: "Filtered / rejected",
  gold: "Gold",
};
const EDGE_COLORS: Record<LineageEdge["kind"], string> = {
  batch: "var(--chart-1)",
  cdc: "var(--chart-3)",
  stream: "var(--chart-2)",
  ml: "var(--chart-5)",
};
const CANVAS_WIDTH = 1_460;
const NODE_WIDTH = 230;
const NODE_HEIGHT = 58;
const ROW_GAP = 76;
const TOP_GUTTER = 76;

export const DEMO_CATALOG_LINEAGE: CatalogLineage = {
  generated_at: new Date(0).toISOString(),
  nodes: [
    { id: "raw.orders", layer: "raw", name: "orders", columns: ["order_id", "store_id", "customer_id", "status", "total_amount"], row_count: 184_205 },
    { id: "raw.customers", layer: "raw", name: "customers", columns: ["customer_id", "customer_code", "is_active"], row_count: 24_810 },
    { id: "raw.inventory", layer: "raw", name: "inventory", columns: ["store_id", "product_id", "on_hand_qty"], row_count: 42_600 },
    { id: "bronze.bronze_orders", layer: "bronze", name: "bronze_orders", columns: ["order_id", "status", "total_amount", "_ingestion_date"], row_count: 184_205 },
    { id: "bronze.bronze_orders_cdc", layer: "bronze", name: "bronze_orders_cdc", columns: ["order_id", "op", "lsn", "_ingested_at"], row_count: 1_284 },
    { id: "bronze.bronze_inventory", layer: "bronze", name: "bronze_inventory", columns: ["store_id", "product_id", "on_hand_qty", "_ingestion_date"], row_count: 42_600 },
    { id: "silver.silver_orders", layer: "silver", name: "silver_orders", columns: ["order_id", "store_id", "status", "total_amount", "placed_at"], row_count: 183_996 },
    { id: "silver.silver_inventory", layer: "silver", name: "silver_inventory", columns: ["store_id", "product_id", "on_hand_qty"], row_count: 42_571 },
    { id: "quarantine.quarantine_orders", layer: "quarantine", name: "quarantine_orders", columns: ["order_id", "_reject_reason", "_ingestion_date"], row_count: 209 },
    { id: "gold.gold_store_hourly_metrics", layer: "gold", name: "gold_store_hourly_metrics", columns: ["store_id", "metric_hour", "orders", "gmv"], row_count: 28_940 },
    { id: "gold.gold_inventory_health", layer: "gold", name: "gold_inventory_health", columns: ["store_id", "product_id", "stock_cover_hours"], row_count: 6_930 },
    { id: "gold.gold_delivery_predictions", layer: "gold", name: "gold_delivery_predictions", columns: ["order_id", "late_probability", "predicted_class"], row_count: 176_482 },
  ],
  edges: [
    { source: "raw.orders", target: "bronze.bronze_orders", kind: "batch" },
    { source: "raw.orders", target: "bronze.bronze_orders_cdc", kind: "cdc" },
    { source: "raw.inventory", target: "bronze.bronze_inventory", kind: "batch" },
    { source: "bronze.bronze_orders", target: "silver.silver_orders", kind: "batch" },
    { source: "bronze.bronze_orders", target: "quarantine.quarantine_orders", kind: "batch" },
    { source: "bronze.bronze_orders_cdc", target: "silver.silver_orders", kind: "cdc" },
    { source: "bronze.bronze_inventory", target: "silver.silver_inventory", kind: "batch" },
    { source: "silver.silver_orders", target: "gold.gold_store_hourly_metrics", kind: "batch" },
    { source: "silver.silver_orders", target: "gold.gold_delivery_predictions", kind: "ml" },
    { source: "silver.silver_inventory", target: "gold.gold_inventory_health", kind: "batch" },
  ],
};

export interface LineageState {
  data: CatalogLineage | null;
  loading: boolean;
  mode: ApiMode;
  error: string | null;
}

export function useCatalogLineage(): LineageState {
  const [state, setState] = useState<LineageState>({
    data: null,
    loading: true,
    mode: "live",
    error: null,
  });

  useEffect(() => {
    let active = true;
    apiGetJson<CatalogLineage>("/api/v1/catalog/lineage")
      .then((data) => {
        if (active) setState({ data, loading: false, mode: "live", error: null });
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setState({
          data: DEMO_CATALOG_LINEAGE,
          loading: false,
          mode: "demo",
          error: requestError instanceof Error ? requestError.message : "lineage request failed",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

interface PositionedNode {
  node: LineageNode;
  x: number;
  y: number;
}

function edgePath(source: PositionedNode, target: PositionedNode): string {
  const startX = source.x + NODE_WIDTH / 2;
  const endX = target.x - NODE_WIDTH / 2;
  const curve = Math.max(38, Math.abs(endX - startX) * 0.35);
  return `M ${startX} ${source.y} C ${startX + curve} ${source.y}, ${endX - curve} ${target.y}, ${endX} ${target.y}`;
}

export function LineageDiagram({
  lineage,
  loading = false,
  selectedNodeId = null,
  onNodeSelect,
}: {
  lineage: CatalogLineage | null;
  loading?: boolean;
  selectedNodeId?: string | null;
  onNodeSelect?: (node: LineageNode) => void;
}) {
  const layout = useMemo(() => {
    if (!lineage) return { height: 0, nodes: [] as PositionedNode[] };
    const grouped = new Map(
      LAYER_ORDER.map((layer) => [layer, lineage.nodes.filter((node) => node.layer === layer)]),
    );
    const maxRows = Math.max(...LAYER_ORDER.map((layer) => grouped.get(layer)?.length ?? 0), 1);
    const height = Math.max(520, TOP_GUTTER + maxRows * ROW_GAP + 42);
    const nodes = LAYER_ORDER.flatMap((layer, layerIndex) => {
      const layerNodes = grouped.get(layer) ?? [];
      const contentHeight = layerNodes.length * ROW_GAP;
      const yOffset = TOP_GUTTER + (maxRows * ROW_GAP - contentHeight) / 2;
      return layerNodes.map((node, rowIndex) => ({
        node,
        x: 150 + layerIndex * 290,
        y: yOffset + rowIndex * ROW_GAP + NODE_HEIGHT / 2,
      }));
    });
    return { height, nodes };
  }, [lineage]);
  const positionedById = useMemo(
    () => new Map(layout.nodes.map((positioned) => [positioned.node.id, positioned])),
    [layout.nodes],
  );

  if (loading) {
    return <Skeleton className="h-[32rem] w-full" />;
  }
  if (!lineage) {
    return (
      <div className="grid h-48 place-items-center text-sm text-muted-foreground">
        No lineage metadata is available.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <div className="relative" style={{ width: CANVAS_WIDTH, height: layout.height }}>
          {LAYER_ORDER.map((layer, index) => (
            <div
              key={layer}
              className="absolute top-4 -translate-x-1/2 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase"
              style={{ left: 150 + index * 290 }}
            >
              {LAYER_LABELS[layer]}
            </div>
          ))}

          <svg
            className="absolute inset-0"
            width={CANVAS_WIDTH}
            height={layout.height}
            viewBox={`0 0 ${CANVAS_WIDTH} ${layout.height}`}
            aria-hidden
          >
            <defs>
              {(Object.keys(EDGE_COLORS) as LineageEdge["kind"][]).map((kind) => (
                <marker
                  key={kind}
                  id={`lineage-arrow-${kind}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" fill={EDGE_COLORS[kind]} />
                </marker>
              ))}
            </defs>
            {lineage.edges.map((edge, index) => {
              const source = positionedById.get(edge.source);
              const target = positionedById.get(edge.target);
              if (!source || !target || source.node.id === target.node.id) return null;
              return (
                <path
                  key={`${edge.source}-${edge.target}-${edge.kind}-${index}`}
                  d={edgePath(source, target)}
                  fill="none"
                  stroke={EDGE_COLORS[edge.kind]}
                  strokeWidth="1.5"
                  strokeDasharray={edge.kind === "cdc" || edge.kind === "stream" ? "5 3" : undefined}
                  opacity="0.7"
                  markerEnd={`url(#lineage-arrow-${edge.kind})`}
                />
              );
            })}
          </svg>

          {layout.nodes.map(({ node, x, y }) => (
            <button
              key={node.id}
              type="button"
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:border-foreground/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:border-primary data-[selected=true]:bg-secondary"
              style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              data-selected={selectedNodeId === node.id}
              aria-pressed={selectedNodeId === node.id}
              title={node.columns.join(", ")}
              onClick={() => onNodeSelect?.(node)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-xs font-medium">{node.name}</span>
                {node.row_count !== undefined && node.row_count !== null ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {node.row_count.toLocaleString()}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                {node.columns.length} columns · click to preview
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {(Object.keys(EDGE_COLORS) as LineageEdge["kind"][]).map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ backgroundColor: EDGE_COLORS[kind] }} />
            {kind}
          </span>
        ))}
        <span className="ml-auto">click a table to load its row preview</span>
      </div>
    </div>
  );
}
