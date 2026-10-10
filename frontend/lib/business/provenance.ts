/** Provenance mode state + KPI lineage fetch helpers. */

export const PROVENANCE_MODE_KEY = "qc_provenance_mode";

export type MetricLineageOp = {
  id: string;
  name: string;
  layer: string;
  engine: string;
  summary: string;
  code: string;
  inputs: string[];
  outputs: string[];
  source_path: string | null;
  rules: Array<{
    rule_id: string;
    severity: string;
    sql_predicate: string;
    message: string;
  }>;
};

export type MetricLineageStep = {
  layer: string;
  table: string;
  fqn: string;
  role: string;
  columns: string[];
  row_count: number | null;
  ops: MetricLineageOp[];
  column?: string | null;
  aggregation?: string | null;
};

export type MetricLineageResponse = {
  metric_key: string;
  label: string;
  plain_description: string;
  formula_text: string;
  gold_source: string;
  unit: string;
  steps: MetricLineageStep[];
  edges: Array<{ from: string; to: string; kind: string }>;
};

export function readProvenanceMode(): boolean {
  try {
    return window.localStorage.getItem(PROVENANCE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeProvenanceMode(on: boolean) {
  try {
    window.localStorage.setItem(PROVENANCE_MODE_KEY, on ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

export function layerAccent(layer: string): string {
  switch (layer) {
    case "raw":
      return "border-l-zinc-400";
    case "bronze":
      return "border-l-amber-700";
    case "silver":
      return "border-l-slate-400";
    case "gold":
      return "border-l-yellow-500";
    default:
      return "border-l-border";
  }
}
