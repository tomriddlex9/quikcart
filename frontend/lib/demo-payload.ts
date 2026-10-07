import {
  DEMO_ANOMALIES,
  DEMO_DELIVERY_PREDICTION,
  DEMO_DEMAND_FORECASTS,
  DEMO_INVENTORY_RISKS,
  DEMO_KPIS,
  DEMO_PROPOSALS,
  DEMO_STORES,
  DEMO_SYSTEM_STATUS,
  DEMO_TREND,
} from "@/lib/demo";
import { DEMO_GEO_STORES } from "@/lib/geo-demo";
import {
  DEMO_CUBE_STATE,
  DEMO_LAYER_SAMPLES,
  DEMO_LAYERS_CATALOG,
  type MedallionLayer,
} from "@/lib/layer-cube-types";
import { DEMO_LIVE_PIPELINE } from "@/lib/live-types";
import type { CatalogLineage, LineageEdge, LineageLayer, LineageNode } from "@/lib/live-types";
import { DEMO_SIM_STATUS } from "@/lib/sim-types";
import type { CatalogLayer, CatalogPreviewResponse, CatalogTablesResponse, DemandForecastRow } from "@/lib/types";

const LAYERS: CatalogLayer[] = ["raw", "bronze", "silver", "quarantine", "gold"];

function tableKey(ref: string): string {
  const dot = ref.lastIndexOf(".");
  return (dot >= 0 ? ref.slice(dot + 1) : ref).toLowerCase();
}

function layerOf(ref: string): CatalogLayer {
  const head = ref.split(".")[0]?.toLowerCase() ?? "";
  if (LAYERS.includes(head as CatalogLayer)) return head as CatalogLayer;
  for (const layer of LAYERS) {
    if (ref.toLowerCase().startsWith(`${layer}_`) || ref.toLowerCase().startsWith(`${layer}.`)) {
      return layer;
    }
  }
  return "bronze";
}

function demoCatalogTables(): CatalogTablesResponse {
  const seen = new Map<string, { name: string; layer: CatalogLayer }>();
  for (const op of DEMO_LAYERS_CATALOG.operations) {
    for (const ref of [...op.inputs, ...op.outputs]) {
      const name = tableKey(ref);
      const key = `${layerOf(ref)}:${name}`;
      if (!seen.has(key)) seen.set(key, { name, layer: layerOf(ref) });
    }
  }
  return {
    tables: [...seen.values()].map((table) => ({
      name: table.name,
      layer: table.layer,
      columns: [],
    })),
  };
}

function demoPreview(layer: string, rawName: string): CatalogPreviewResponse {
  const name = decodeURIComponent(rawName);
  const key = name.toLowerCase();
  const op = DEMO_LAYERS_CATALOG.operations.find((item) =>
    item.outputs.some((output) => tableKey(output) === key || output.toLowerCase() === key),
  );
  const sample = op ? DEMO_LAYER_SAMPLES[op.id] : undefined;
  const rows = sample?.after ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
  const catalogLayer = LAYERS.includes(layer as CatalogLayer) ? (layer as CatalogLayer) : "bronze";
  return {
    name,
    table: name,
    layer: catalogLayer,
    columns,
    rows: rows.slice(0, 40),
    row_count: rows.length,
    truncated: rows.length > 40,
  };
}

function demoTransforms(rawTable: string) {
  const table = decodeURIComponent(rawTable);
  const key = table.toLowerCase();
  const operations = DEMO_LAYERS_CATALOG.operations.filter(
    (op) =>
      op.outputs.some((output) => tableKey(output) === key || output.toLowerCase() === key) ||
      op.name.toLowerCase() === key,
  );
  return { table, operations };
}

export function demoCatalogLineage(): CatalogLineage {
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  const kindFor = (engine: string): LineageEdge["kind"] => {
    if (engine === "cdc") return "cdc";
    if (engine === "stream") return "stream";
    if (engine === "ml") return "ml";
    return "batch";
  };
  for (const op of DEMO_LAYERS_CATALOG.operations) {
    for (const ref of [...op.inputs, ...op.outputs]) {
      if (!nodes.has(ref)) {
        nodes.set(ref, {
          id: ref,
          layer: layerOf(ref) as LineageLayer,
          name: tableKey(ref),
          columns: [],
        });
      }
    }
    for (const input of op.inputs) {
      for (const output of op.outputs) {
        edges.push({ source: input, target: output, kind: kindFor(op.engine) });
      }
    }
  }
  return {
    generated_at: DEMO_LAYERS_CATALOG.generated_at,
    nodes: [...nodes.values()],
    edges,
  };
}

export function demoDemandForecasts(storeId: string, category: string): DemandForecastRow[] {
  return DEMO_DEMAND_FORECASTS.filter((row) => {
    if (storeId && String(row.store_id) !== storeId) return false;
    if (category && (row.category ?? "").toLowerCase() !== category.toLowerCase()) return false;
    return true;
  });
}

export const DEMO_DELIVERY = DEMO_DELIVERY_PREDICTION;

/** Bundled fixture for a GET path. Undefined when this path has no demo payload. */
export function demoPayload(path: string): unknown {
  const [pathname, query = ""] = path.split("?");
  if (pathname === "/api/v1/overview/kpis") return DEMO_KPIS;
  if (pathname === "/api/v1/trends/orders") return DEMO_TREND;
  if (pathname === "/api/v1/stores") return DEMO_STORES;
  if (pathname === "/api/v1/inventory/risks") return DEMO_INVENTORY_RISKS;
  if (pathname === "/api/v1/anomalies") return DEMO_ANOMALIES;
  if (pathname === "/api/v1/proposals") {
    const status = new URLSearchParams(query).get("status");
    if (!status) return DEMO_PROPOSALS;
    return DEMO_PROPOSALS.filter((proposal) => proposal.status === status);
  }
  if (pathname === "/api/v1/system/status") return DEMO_SYSTEM_STATUS;
  if (pathname === "/api/v1/geo/stores") return DEMO_GEO_STORES;
  if (pathname === "/api/v1/sim/status") return DEMO_SIM_STATUS;
  if (pathname === "/api/v1/layers/operations") return DEMO_LAYERS_CATALOG;
  if (pathname === "/api/v1/catalog/tables") return demoCatalogTables();
  if (pathname === "/api/v1/catalog/lineage") return demoCatalogLineage();
  if (pathname === "/api/v1/live/pipeline") return DEMO_LIVE_PIPELINE;
  if (pathname === "/api/v1/cube/state") return DEMO_CUBE_STATE;

  const sample = pathname.match(/^\/api\/v1\/layers\/operations\/([^/]+)\/sample$/);
  if (sample) {
    const id = decodeURIComponent(sample[1] ?? "");
    const bundled = DEMO_LAYER_SAMPLES[id];
    if (bundled) return bundled;
    const op = DEMO_LAYERS_CATALOG.operations.find((item) => item.id === id);
    return {
      layer: (op?.layer ?? "bronze") as MedallionLayer,
      op_id: id,
      before: [],
      after: [],
      notes: ["No bundled sample for this operation."],
    };
  }

  const preview = pathname.match(/^\/api\/v1\/catalog\/tables\/([^/]+)\/([^/]+)\/preview$/);
  if (preview) return demoPreview(preview[1] ?? "bronze", preview[2] ?? "");

  const transform = pathname.match(/^\/api\/v1\/layers\/transforms\/([^/]+)$/);
  if (transform) return demoTransforms(transform[1] ?? "");

  return undefined;
}
