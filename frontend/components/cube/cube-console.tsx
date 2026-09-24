"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Dices,
  Filter,
  RotateCcw,
  Scissors,
  Shuffle,
  Terminal,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { apiPostJson } from "@/lib/api";
import {
  DEMO_CUBE_STATE,
  type CubeMeasure,
  type CubeOperateRequest,
  type CubeState,
} from "@/lib/layer-cube-types";

const DataCubeScene = dynamic(
  () => import("@/components/cube/data-cube-scene").then((mod) => mod.DataCubeScene),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
  },
);

const BASE = DEMO_CUBE_STATE;

interface CubeModel {
  activeDims: string[];
  constraints: Record<string, string[]>;
  measure: string;
}

function initialModel(): CubeModel {
  return {
    activeDims: BASE.dimensions.map((d) => d.name),
    constraints: {},
    measure: BASE.measures[0]?.name ?? "",
  };
}

function cellKey(dims: string[], coords: Record<string, string>): string {
  return dims.map((dim) => coords[dim]).join("␟");
}

function deriveState(
  model: CubeModel,
  meta: { activeOp: string | null; history: string[]; animation: CubeState["animation"] },
): CubeState {
  const filtered = BASE.cells.filter((cell) =>
    Object.entries(model.constraints).every(
      ([dim, members]) => members.length === 0 || members.includes(cell.coords[dim]),
    ),
  );
  const droppedDims = BASE.dimensions
    .map((d) => d.name)
    .filter((name) => !model.activeDims.includes(name));

  let cells: CubeState["cells"];
  if (droppedDims.length === 0) {
    cells = filtered.map((cell) => ({ ...cell, coords: { ...cell.coords }, values: { ...cell.values } }));
  } else {
    const weightName = BASE.measures.find((m) => m.format === "int")?.name ?? BASE.measures[0]?.name;
    const groups = new Map<string, typeof filtered>();
    for (const cell of filtered) {
      const key = cellKey(model.activeDims, cell.coords);
      const bucket = groups.get(key);
      if (bucket) bucket.push(cell);
      else groups.set(key, [cell]);
    }
    cells = Array.from(groups.entries()).map(([key, group]) => {
      const parts = key.split("␟");
      const coords: Record<string, string> = {};
      model.activeDims.forEach((dim, index) => {
        coords[dim] = parts[index];
      });
      const weightTotal = weightName
        ? group.reduce((sum, cell) => sum + (cell.values[weightName] ?? 0), 0)
        : group.length;
      const values: Record<string, number> = {};
      for (const measure of BASE.measures) {
        if (measure.format === "pct" || measure.format === "float") {
          const numerator = group.reduce(
            (sum, cell) =>
              sum + (cell.values[measure.name] ?? 0) * (weightName ? cell.values[weightName] ?? 0 : 1),
            0,
          );
          values[measure.name] = weightTotal > 0 ? Number((numerator / weightTotal).toFixed(4)) : 0;
        } else {
          values[measure.name] = Math.round(
            group.reduce((sum, cell) => sum + (cell.values[measure.name] ?? 0), 0),
          );
        }
      }
      return { id: key.replace(/␟/g, "|"), coords, values };
    });
  }

  const dimensions = model.activeDims.map((name) => {
    const dim = BASE.dimensions.find((d) => d.name === name);
    const allowed = model.constraints[name];
    return { name, members: allowed && allowed.length > 0 ? allowed : dim?.members ?? [] };
  });

  return {
    ...BASE,
    dimensions,
    cells,
    active_op: meta.activeOp,
    history: meta.history,
    animation: meta.animation,
  };
}

function cellIdsFor(model: CubeModel): string[] {
  return deriveState(model, { activeOp: null, history: [], animation: null }).cells.map((c) => c.id);
}

interface OpOutcome {
  model: CubeModel;
  description: string;
  animation: CubeState["animation"];
}

function parseSqlExpression(model: CubeModel, expression: string): OpOutcome {
  const body = expression.replace(/^\s*where\s*/i, "");
  const clauses = body
    .split(/\s+and\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const constraints: Record<string, string[]> = { ...model.constraints };
  let measure = model.measure;
  const applied: string[] = [];

  for (const clause of clauses) {
    const match = clause.match(/^([a-zA-Z_]+)\s*=\s*'?([^']+?)'?$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key.toLowerCase() === "measure") {
      const found = BASE.measures.find((m) => m.name.toLowerCase() === value.toLowerCase());
      if (found) {
        measure = found.name;
        applied.push(`measure=${found.name}`);
      }
      continue;
    }
    const dim = BASE.dimensions.find((d) => d.name.toLowerCase() === key.toLowerCase());
    const member = dim?.members.find((m) => m.toLowerCase() === value.toLowerCase());
    if (dim && member) {
      constraints[dim.name] = [member];
      applied.push(`${dim.name}=${member}`);
    }
  }

  const nextModel: CubeModel = { ...model, constraints, measure };
  return {
    model: nextModel,
    description: applied.length > 0 ? `sql → WHERE ${applied.join(" AND ")}` : "sql → no matching clauses",
    animation: { kind: "shrink", cell_ids: cellIdsFor(nextModel), duration_ms: 550 },
  };
}

function applyLocalOp(model: CubeModel, request: CubeOperateRequest): OpOutcome {
  const args = request.args ?? {};
  switch (request.op) {
    case "reset": {
      const nextModel = initialModel();
      return {
        model: nextModel,
        description: "reset → base cube",
        animation: { kind: "expand", cell_ids: cellIdsFor(nextModel), duration_ms: 550 },
      };
    }
    case "filter": {
      const dim = String(args.dim ?? model.activeDims[0]);
      const member = String(args.member ?? "");
      const nextModel: CubeModel = {
        ...model,
        constraints: { ...model.constraints, [dim]: member ? [member] : [] },
      };
      return {
        model: nextModel,
        description: `filter → ${dim} = ${member}`,
        animation: { kind: "shrink", cell_ids: cellIdsFor(nextModel), duration_ms: 550 },
      };
    }
    case "dice": {
      const dim = String(args.dim ?? model.activeDims[0]);
      const member = String(args.member ?? "");
      const existing = model.constraints[dim] ?? [];
      const merged = member ? Array.from(new Set([...existing, member])) : existing;
      const nextModel: CubeModel = { ...model, constraints: { ...model.constraints, [dim]: merged } };
      return {
        model: nextModel,
        description: `dice → add ${dim} = ${member}`,
        animation: { kind: "shrink", cell_ids: cellIdsFor(nextModel), duration_ms: 550 },
      };
    }
    case "slice": {
      const dim = String(args.dim ?? model.activeDims[0]);
      const member = String(args.member ?? "");
      const constraints = {
        ...model.constraints,
        [dim]: member ? [member] : model.constraints[dim] ?? [],
      };
      const activeDims = model.activeDims.filter((d) => d !== dim);
      const nextModel: CubeModel = { ...model, constraints, activeDims };
      return {
        model: nextModel,
        description: `slice → fix ${dim} = ${member}`,
        animation: { kind: "merge", cell_ids: cellIdsFor(nextModel), duration_ms: 600 },
      };
    }
    case "rollup": {
      const dim = String(args.dim ?? model.activeDims[model.activeDims.length - 1]);
      const constraints = { ...model.constraints };
      delete constraints[dim];
      const activeDims = model.activeDims.filter((d) => d !== dim);
      const nextModel: CubeModel = { ...model, constraints, activeDims };
      return {
        model: nextModel,
        description: `rollup → aggregate away ${dim}`,
        animation: { kind: "merge", cell_ids: cellIdsFor(nextModel), duration_ms: 650 },
      };
    }
    case "drill": {
      const remaining = BASE.dimensions.map((d) => d.name).filter((name) => !model.activeDims.includes(name));
      const dim = String(args.dim ?? remaining[0] ?? model.activeDims[0]);
      const activeDims = model.activeDims.includes(dim) ? model.activeDims : [...model.activeDims, dim];
      const nextModel: CubeModel = { ...model, activeDims };
      return {
        model: nextModel,
        description: `drill → expand into ${dim}`,
        animation: { kind: "expand", cell_ids: cellIdsFor(nextModel), duration_ms: 600 },
      };
    }
    case "pivot": {
      const dim = String(args.dim ?? model.activeDims[1] ?? model.activeDims[0]);
      const activeDims = [dim, ...model.activeDims.filter((d) => d !== dim)];
      const nextModel: CubeModel = { ...model, activeDims };
      return {
        model: nextModel,
        description: `pivot → lead with ${dim}`,
        animation: { kind: "recolor", cell_ids: cellIdsFor(nextModel), duration_ms: 600 },
      };
    }
    case "sql":
      return parseSqlExpression(model, String(args.expression ?? ""));
    default:
      return { model, description: "no-op", animation: null };
  }
}

const OP_BUTTONS: Array<{
  op: CubeOperateRequest["op"];
  label: string;
  icon: typeof Filter;
  needsMember: boolean;
}> = [
  { op: "filter", label: "Filter", icon: Filter, needsMember: true },
  { op: "slice", label: "Slice", icon: Scissors, needsMember: true },
  { op: "dice", label: "Dice", icon: Dices, needsMember: true },
  { op: "rollup", label: "Rollup", icon: ArrowUpToLine, needsMember: false },
  { op: "drill", label: "Drill", icon: ArrowDownToLine, needsMember: false },
  { op: "pivot", label: "Pivot", icon: Shuffle, needsMember: false },
];

function formatMeasureValue(measure: CubeMeasure | undefined, value: number): string {
  if (!measure) return String(value);
  if (measure.format === "currency") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  if (measure.format === "pct") return `${(value * 100).toFixed(1)}%`;
  if (measure.format === "int") return Math.round(value).toLocaleString("en-IN");
  return value.toFixed(2);
}

export function CubeConsole() {
  const [model, setModel] = useState<CubeModel>(initialModel);
  const [history, setHistory] = useState<string[]>(BASE.history);
  const [animation, setAnimation] = useState<CubeState["animation"]>(null);
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [apiMode, setApiMode] = useState<"live" | "demo">("demo");
  const [pending, setPending] = useState(false);
  const [dimSel, setDimSel] = useState<string>(BASE.dimensions[0]?.name ?? "");
  const [sqlInput, setSqlInput] = useState("WHERE store_city='Bengaluru' AND measure=gmv");

  const displayState = useMemo(
    () => deriveState(model, { activeOp, history, animation }),
    [model, activeOp, history, animation],
  );

  const memberOptions = useMemo(
    () => BASE.dimensions.find((d) => d.name === dimSel)?.members ?? [],
    [dimSel],
  );
  const [memberSel, setMemberSel] = useState<string>(memberOptions[0] ?? "");
  useEffect(() => {
    if (!memberOptions.includes(memberSel)) setMemberSel(memberOptions[0] ?? "");
  }, [memberOptions, memberSel]);

  const drillableDims = useMemo(
    () => BASE.dimensions.map((d) => d.name).filter((name) => !model.activeDims.includes(name)),
    [model.activeDims],
  );

  const runOp = useCallback(
    async (op: CubeOperateRequest["op"], args?: Record<string, unknown>) => {
      setPending(true);
      const request: CubeOperateRequest = { op, args, state: displayState };
      const result = await apiPostJson<CubeState>("/api/v1/cube/operate", request);
      if (result.ok && Array.isArray(result.data.cells) && Array.isArray(result.data.dimensions)) {
        setApiMode("live");
        setActiveOp(op);
        setHistory((h) => [...h, `${op} → live response`]);
        setAnimation(result.data.animation ?? null);
        setModel((m) => ({ ...m, activeDims: result.data.dimensions.map((d) => d.name) }));
      } else {
        setApiMode("demo");
        const outcome = applyLocalOp(model, { op, args });
        setModel(outcome.model);
        setActiveOp(op);
        setHistory((h) => [...h, outcome.description]);
        setAnimation(outcome.animation);
      }
      setPending(false);
    },
    [displayState, model],
  );

  const activeMeasure = BASE.measures.find((m) => m.name === model.measure);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm">Cube operations</CardTitle>
          <CardDescription className="text-xs">
            Each op posts to <code className="text-[11px]">/api/v1/cube/operate</code>; without a live
            backend it falls back to a local transform on the demo cube.
          </CardDescription>
          <CardAction>
            <Badge variant={apiMode === "live" ? "secondary" : "outline"}>
              {apiMode === "live" ? "Live backend" : "Local demo transform"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Dimension
              <select
                value={dimSel}
                onChange={(e) => setDimSel(e.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {BASE.dimensions.map((dim) => (
                  <option key={dim.name} value={dim.name}>
                    {dim.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Member
              <select
                value={memberSel}
                onChange={(e) => setMemberSel(e.target.value)}
                disabled={memberOptions.length === 0}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {memberOptions.map((member) => (
                  <option key={member} value={member}>
                    {member}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Measure
              <select
                value={model.measure}
                onChange={(e) => setModel((m) => ({ ...m, measure: e.target.value }))}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {BASE.measures.map((measure) => (
                  <option key={measure.name} value={measure.name}>
                    {measure.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {OP_BUTTONS.map(({ op, label, icon: Icon, needsMember }) => (
              <Button
                key={op}
                variant="outline"
                size="sm"
                disabled={pending || (op === "drill" && drillableDims.length === 0)}
                onClick={() =>
                  void runOp(
                    op,
                    needsMember || op === "rollup" || op === "pivot"
                      ? { dim: dimSel, member: memberSel }
                      : op === "drill"
                        ? { dim: drillableDims[0] }
                        : undefined,
                  )
                }
                className="gap-1.5"
              >
                <Icon className="size-3.5" />
                {label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => void runOp("reset")}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={sqlInput}
              onChange={(e) => setSqlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runOp("sql", { expression: sqlInput });
              }}
              placeholder="WHERE city='Bengaluru' AND measure=gmv"
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => void runOp("sql", { expression: sqlInput })}
            >
              Run
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="-mx-4 md:-mx-8 lg:-mx-10">
        <div className="flex flex-col lg:h-[34rem] lg:flex-row">
          <div className="relative h-[24rem] w-full shrink-0 overflow-hidden bg-[#050708] lg:h-full lg:flex-1">
            <DataCubeScene state={displayState} measure={model.measure} />
            <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="bg-black/50 text-foreground backdrop-blur-sm">
                {displayState.title}
              </Badge>
              <Badge variant="outline" className="border-white/20 bg-black/40 text-foreground backdrop-blur-sm">
                measure: {activeMeasure?.label ?? model.measure}
              </Badge>
            </div>
          </div>

          <aside className="w-full shrink-0 border-t border-border bg-card px-4 py-4 lg:h-full lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">Dimensions</p>
            <div className="space-y-2">
              {displayState.dimensions.map((dim) => (
                <div key={dim.name} className="rounded-lg border border-border px-2.5 py-1.5">
                  <p className="font-mono text-xs text-foreground">{dim.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {dim.members.join(", ")}
                  </p>
                </div>
              ))}
            </div>

            <p className="mb-1.5 mt-4 text-[11px] font-medium tracking-wide text-muted-foreground">
              Active animation
            </p>
            <div className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
              {displayState.animation
                ? `${displayState.animation.kind} · ${displayState.animation.cell_ids.length} cells · ${displayState.animation.duration_ms}ms`
                : "idle"}
            </div>

            <p className="mb-1.5 mt-4 text-[11px] font-medium tracking-wide text-muted-foreground">History</p>
            <ol className="space-y-1.5">
              {history
                .slice(-10)
                .reverse()
                .map((entry, index) => (
                  <li key={`${entry}-${index}`} className="text-xs text-muted-foreground">
                    <span className="mr-1.5 font-mono text-[10px] text-faint">
                      {String(history.length - index).padStart(2, "0")}
                    </span>
                    {entry}
                  </li>
                ))}
            </ol>
          </aside>
        </div>
      </div>
    </div>
  );
}
