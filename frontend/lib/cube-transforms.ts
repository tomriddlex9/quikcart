// Local (offline-capable) mirror of `quickcart.api.cube_api`'s operation
// semantics. The /cube page calls the API first; when it is unreachable these
// pure functions apply the same filter/slice/dice/rollup/drill/pivot/sql/reset
// transforms directly to `DEMO_CUBE_STATE` so the console keeps working.

import {
  DEMO_CUBE_STATE,
  type CubeCell,
  type CubeDim,
  type CubeMeasure,
  type CubeOperateRequest,
  type CubeState,
} from "@/lib/layer-cube-types";

export class CubeOperationError extends Error {}

const MAX_ANIMATED_CELLS = 12;
const ANIMATION_DURATION_MS = 650;

function dimNames(state: CubeState): string[] {
  return state.dimensions.map((d) => d.name);
}

function requireDim(state: CubeState, dim: string): CubeDim {
  const found = state.dimensions.find((d) => d.name === dim);
  if (!found) {
    throw new CubeOperationError(`unknown dimension "${dim}"; expected one of ${dimNames(state).join(", ")}`);
  }
  return found;
}

function cellIds(cells: CubeCell[]): string[] {
  return cells.slice(0, MAX_ANIMATED_CELLS).map((c) => c.id);
}

function opFilter(state: CubeState, args: Record<string, unknown>): CubeState {
  const dim = String(args.dim ?? "");
  const member = String(args.member ?? "");
  requireDim(state, dim);
  const cells = state.cells.filter((cell) => cell.coords[dim] === member);
  return {
    ...state,
    cells,
    active_op: "filter",
    history: [...state.history, `filter -> ${dim} = ${member} (${cells.length} cells)`],
    animation: { kind: "pulse", cell_ids: cellIds(cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

function opDice(state: CubeState, args: Record<string, unknown>): CubeState {
  const filters = args.filters as Record<string, string[]> | undefined;
  if (!filters || Object.keys(filters).length === 0) {
    throw new CubeOperationError("dice requires args.filters: { dim: [members, ...] }");
  }
  for (const dim of Object.keys(filters)) requireDim(state, dim);
  const cells = state.cells.filter((cell) =>
    Object.entries(filters).every(([dim, members]) => members.includes(cell.coords[dim])),
  );
  return {
    ...state,
    cells,
    active_op: "dice",
    history: [...state.history, `dice -> ${JSON.stringify(filters)} (${cells.length} cells)`],
    animation: { kind: "split", cell_ids: cellIds(cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

function opSlice(state: CubeState, args: Record<string, unknown>): CubeState {
  const dim = String(args.dim ?? "");
  const member = String(args.member ?? "");
  requireDim(state, dim);
  const cells = state.cells
    .filter((cell) => cell.coords[dim] === member)
    .map((cell) => {
      const coords = { ...cell.coords };
      delete coords[dim];
      return { ...cell, coords };
    });
  const dimensions = state.dimensions.filter((d) => d.name !== dim);
  return {
    ...state,
    dimensions,
    cells,
    active_op: "slice",
    history: [...state.history, `slice -> ${dim} = ${member} (dimension removed)`],
    animation: { kind: "merge", cell_ids: cellIds(cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

function aggregate(cells: CubeCell[], groupDims: string[], measures: CubeMeasure[]): CubeCell[] {
  const buckets = new Map<string, CubeCell[]>();
  for (const cell of cells) {
    const key = groupDims.map((dim) => cell.coords[dim] ?? "").join("|");
    const bucket = buckets.get(key) ?? [];
    bucket.push(cell);
    buckets.set(key, bucket);
  }
  const rateMeasures = new Set(measures.filter((m) => m.format === "pct").map((m) => m.name));
  const out: CubeCell[] = [];
  for (const [key, group] of buckets) {
    const coords: Record<string, string> = {};
    groupDims.forEach((dim, i) => {
      coords[dim] = key.split("|")[i] ?? "";
    });
    const values: Record<string, number> = {};
    for (const measure of measures) {
      const raw = group.map((g) => g.values[measure.name] ?? 0);
      if (rateMeasures.has(measure.name)) {
        values[measure.name] = raw.length ? Number((raw.reduce((a, b) => a + b, 0) / raw.length).toFixed(3)) : 0;
      } else {
        values[measure.name] = Number(raw.reduce((a, b) => a + b, 0).toFixed(2));
      }
    }
    out.push({ id: key || "ALL", coords, values });
  }
  return out;
}

function opRollup(state: CubeState, args: Record<string, unknown>): CubeState {
  const dim = String(args.dim ?? "");
  requireDim(state, dim);
  const remainingDims = state.dimensions.filter((d) => d.name !== dim).map((d) => d.name);
  const cells = aggregate(state.cells, remainingDims, state.measures);
  const dimensions = state.dimensions.filter((d) => d.name !== dim);
  return {
    ...state,
    dimensions,
    cells,
    active_op: "rollup",
    history: [...state.history, `rollup -> aggregate away ${dim} (${cells.length} cells)`],
    animation: { kind: "shrink", cell_ids: cellIds(cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

function opDrill(state: CubeState, args: Record<string, unknown>): CubeState {
  const dim = String(args.dim ?? "");
  const member = String(args.member ?? "");
  if (!dim || !member) throw new CubeOperationError("drill requires args.dim and args.member");
  const base = DEMO_CUBE_STATE;
  const baseDimNames = new Set(base.dimensions.map((d) => d.name));
  if (!baseDimNames.has(dim)) {
    throw new CubeOperationError(`unknown dimension "${dim}"; expected one of ${[...baseDimNames].join(", ")}`);
  }
  const currentDims = dimNames(state);
  const keptDimNames = currentDims.includes(dim) ? currentDims : [...currentDims, dim];
  let cells = base.cells.filter((cell) => cell.coords[dim] === member);
  if (keptDimNames.length < base.dimensions.length) {
    cells = aggregate(cells, keptDimNames, base.measures);
  }
  const dimensions = base.dimensions.filter((d) => keptDimNames.includes(d.name));
  return {
    ...state,
    dimensions,
    cells,
    active_op: "drill",
    history: [...state.history, `drill -> ${dim} = ${member} (detail restored)`],
    animation: { kind: "expand", cell_ids: cellIds(cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

function opPivot(state: CubeState, args: Record<string, unknown>): CubeState {
  let order = args.order as string[] | undefined;
  if (!order || order.length === 0) order = [...dimNames(state)].reverse();
  const current = new Map(state.dimensions.map((d) => [d.name, d]));
  const missing = order.filter((name) => !current.has(name));
  if (missing.length > 0) throw new CubeOperationError(`pivot references unknown dimensions: ${missing.join(", ")}`);
  const reordered = order.map((name) => current.get(name)!);
  const rest = state.dimensions.filter((d) => !order!.includes(d.name));
  const dimensions = [...reordered, ...rest];
  return {
    ...state,
    dimensions,
    active_op: "pivot",
    history: [...state.history, `pivot -> ${dimensions.map((d) => d.name).join(", ")}`],
    animation: { kind: "recolor", cell_ids: cellIds(state.cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

const SQL_WHERE_RE = /where\s+(\w+)\s*=\s*'([^']+)'/i;

function opSql(state: CubeState, args: Record<string, unknown>): CubeState {
  const statement = String(args.sql ?? "").trim();
  if (!statement) throw new CubeOperationError("sql requires args.sql");
  const match = SQL_WHERE_RE.exec(statement);
  if (match) {
    const [, dim, member] = match;
    if (dimNames(state).includes(dim)) {
      const filtered = opFilter(state, { dim, member });
      return {
        ...filtered,
        active_op: "sql",
        history: [...state.history, `sql -> "${statement}" (parsed as filter ${dim}=${member})`],
      };
    }
  }
  return {
    ...state,
    active_op: "sql",
    history: [...state.history, `sql -> "${statement}" (no recognizable WHERE clause; cube unchanged)`],
    animation: { kind: "pulse", cell_ids: cellIds(state.cells), duration_ms: ANIMATION_DURATION_MS },
  };
}

const HANDLERS: Record<string, (state: CubeState, args: Record<string, unknown>) => CubeState> = {
  filter: opFilter,
  dice: opDice,
  slice: opSlice,
  rollup: opRollup,
  drill: opDrill,
  pivot: opPivot,
  sql: opSql,
};

/** Apply one cube op locally. Mirrors POST /api/v1/cube/operate exactly. */
export function applyCubeOperationLocally(request: CubeOperateRequest): CubeState {
  const base = request.state ?? DEMO_CUBE_STATE;
  if (request.op === "reset") return DEMO_CUBE_STATE;
  const handler = HANDLERS[request.op];
  if (!handler) {
    throw new CubeOperationError(`unknown cube op "${request.op}"`);
  }
  return handler(base, request.args ?? {});
}
