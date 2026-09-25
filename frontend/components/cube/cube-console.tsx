"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Filter as FilterIcon,
  Grid3x3,
  History,
  Layers3,
  Pickaxe,
  RefreshCcw,
  Scissors,
  Shuffle,
  Sigma,
  Terminal,
} from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Loading } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiGetJson, apiPostJson, type ApiMode } from "@/lib/api";
import { applyCubeOperationLocally, CubeOperationError } from "@/lib/cube-transforms";
import {
  DEMO_CUBE_STATE,
  type CubeCell,
  type CubeOp,
  type CubeOperateRequest,
  type CubeState,
} from "@/lib/layer-cube-types";
import { formatNumber } from "@/lib/format";

const DataCubeScene = dynamic(() => import("@/components/cube/data-cube-scene"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      Loading 3D cube…
    </div>
  ),
});

type OpButton = { op: CubeOp; label: string; icon: typeof FilterIcon; needs: "dim-member" | "dim" | "none" | "sql" };

const OP_BUTTONS: OpButton[] = [
  { op: "filter", label: "Filter", icon: FilterIcon, needs: "dim-member" },
  { op: "slice", label: "Slice", icon: Scissors, needs: "dim-member" },
  { op: "dice", label: "Dice", icon: Grid3x3, needs: "dim-member" },
  { op: "rollup", label: "Rollup", icon: Sigma, needs: "dim" },
  { op: "drill", label: "Drill", icon: Pickaxe, needs: "dim-member" },
  { op: "pivot", label: "Pivot", icon: Shuffle, needs: "none" },
  { op: "sql", label: "SQL", icon: Terminal, needs: "sql" },
  { op: "reset", label: "Reset", icon: RefreshCcw, needs: "none" },
];

function formatMeasure(value: number, format: "int" | "currency" | "pct" | "float"): string {
  if (format === "pct") return `${(value * 100).toFixed(1)}%`;
  if (format === "currency") return `₹${formatNumber(Math.round(value))}`;
  if (format === "int") return formatNumber(Math.round(value));
  return value.toFixed(2);
}

export function CubeConsole() {
  const [state, setState] = useState<CubeState>(DEMO_CUBE_STATE);
  const [mode, setMode] = useState<ApiMode>("offline");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const [activeOp, setActiveOp] = useState<CubeOp>("filter");
  const [selectedDim, setSelectedDim] = useState<string>("store_city");
  const [selectedMember, setSelectedMember] = useState<string>("Bengaluru");
  const [diceMembers, setDiceMembers] = useState<string[]>([]);
  const [sqlText, setSqlText] = useState<string>("where store_city = 'Pune'");
  const [heightMeasure, setHeightMeasure] = useState("orders");
  const [colorMeasure, setColorMeasure] = useState("late_rate");
  const [hoverCell, setHoverCell] = useState<CubeCell | null>(null);

  // The full dimension universe never shrinks in the UI's op pickers, even
  // after a rollup/slice removes a dimension from the live cube — filter,
  // dice, and drill all need to be able to name a dimension that's not
  // currently present.
  const baseDimensions = useRef(DEMO_CUBE_STATE.dimensions).current;

  useEffect(() => {
    let cancelled = false;
    apiGetJson<CubeState>("/api/v1/cube/state")
      .then((data) => {
        if (cancelled) return;
        setState(data);
        setMode("live");
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState(DEMO_CUBE_STATE);
        setMode("demo");
        setError(err instanceof Error ? err.message : "API unreachable");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dimOptions = baseDimensions.map((d) => d.name);
  const memberOptions = baseDimensions.find((d) => d.name === selectedDim)?.members ?? [];

  const buildArgs = (op: CubeOp): Record<string, unknown> => {
    switch (op) {
      case "filter":
      case "slice":
      case "drill":
        return { dim: selectedDim, member: selectedMember };
      case "dice":
        return { filters: { [selectedDim]: diceMembers.length > 0 ? diceMembers : memberOptions } };
      case "rollup":
        return { dim: selectedDim };
      case "sql":
        return { sql: sqlText };
      default:
        return {};
    }
  };

  const runOp = async (op: CubeOp) => {
    setApplying(true);
    setActiveOp(op);
    const request: CubeOperateRequest = { op, args: buildArgs(op), state };
    try {
      const result = await apiPostJson<CubeState>("/api/v1/cube/operate", request);
      if (result.ok) {
        setState(result.data);
        setMode("live");
        setError(null);
      } else {
        throw new Error(result.detail);
      }
    } catch (err) {
      try {
        const next = applyCubeOperationLocally(request);
        setState(next);
        setMode("demo");
        setError(
          err instanceof Error
            ? `API unavailable (${err.message}); applied locally.`
            : "API unavailable; applied locally.",
        );
      } catch (localErr) {
        setError(localErr instanceof CubeOperationError ? localErr.message : "Operation failed.");
      }
    } finally {
      setApplying(false);
    }
  };

  const measureNames = state.measures.map((m) => m.name);
  const totals = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const measure of state.measures) {
      const values = state.cells.map((c) => c.values[measure.name] ?? 0);
      sums[measure.name] =
        measure.format === "pct"
          ? values.length
            ? values.reduce((a, b) => a + b, 0) / values.length
            : 0
          : values.reduce((a, b) => a + b, 0);
    }
    return sums;
  }, [state.cells, state.measures]);

  if (loading) return <Loading label="Loading cube…" />;

  const activeButton = OP_BUTTONS.find((b) => b.op === activeOp);

  return (
    <div className="space-y-4">
      {mode !== "live" ? <ApiBanner mode={mode} error={error} /> : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">{state.title}</CardTitle>
          <CardDescription className="text-xs">
            {state.cells.length} cells across {state.dimensions.map((d) => d.name).join(" × ")}.
            Filter / slice / dice / rollup / drill / pivot / SQL — every op animates the cube and
            works offline against the same demo fixture.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {state.measures.map((measure) => (
              <Badge key={measure.name} variant="secondary" className="font-mono">
                {measure.label}: {formatMeasure(totals[measure.name] ?? 0, measure.format)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-muted-foreground" strokeWidth={1.75} />
            OLAP toolbar
          </CardTitle>
          <CardDescription>Pick an operation, set its arguments, then apply.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {OP_BUTTONS.map(({ op, label, icon: Icon }) => (
              <Button
                key={op}
                variant={activeOp === op ? "default" : "outline"}
                size="sm"
                onClick={() => (op === "reset" ? void runOp(op) : setActiveOp(op))}
                disabled={applying}
              >
                <Icon data-icon="inline-start" />
                {label}
              </Button>
            ))}
          </div>

          {activeButton && activeButton.needs !== "none" ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
              {(activeButton.needs === "dim-member" || activeButton.needs === "dim") && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Dimension
                  <select
                    value={selectedDim}
                    onChange={(e) => {
                      setSelectedDim(e.target.value);
                      const opts = baseDimensions.find((d) => d.name === e.target.value)?.members ?? [];
                      setSelectedMember(opts[0] ?? "");
                      setDiceMembers([]);
                    }}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
                  >
                    {dimOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {activeButton.needs === "dim-member" && activeOp !== "dice" ? (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Member
                  <select
                    value={selectedMember}
                    onChange={(e) => setSelectedMember(e.target.value)}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
                  >
                    {memberOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {activeOp === "dice" ? (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Members
                  <div className="flex flex-wrap gap-2">
                    {memberOptions.map((name) => {
                      const checked = diceMembers.includes(name);
                      return (
                        <label
                          key={name}
                          className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDiceMembers((prev) =>
                                checked ? prev.filter((m) => m !== name) : [...prev, name],
                              )
                            }
                          />
                          {name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {activeOp === "sql" ? (
                <Textarea
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  className="min-h-9 flex-1 font-mono text-xs"
                  placeholder="where store_city = 'Pune'"
                />
              ) : null}

              <Button onClick={() => void runOp(activeOp)} disabled={applying} size="sm">
                {applying ? "Applying…" : `Apply ${activeButton.label}`}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">
              <Layers3 className="size-3.5" strokeWidth={1.75} />
              Bar height
              <select
                value={heightMeasure}
                onChange={(e) => setHeightMeasure(e.target.value)}
                className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs text-foreground"
              >
                {measureNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Bar color
              <select
                value={colorMeasure}
                onChange={(e) => setColorMeasure(e.target.value)}
                className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs text-foreground"
              >
                {measureNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-sm">3D cube</CardTitle>
            <CardDescription className="text-xs">
              Drag to orbit, scroll to zoom. {hoverCell ? `Hovering ${hoverCell.id}` : "Hover a bar for details."}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[26rem] px-0 pb-0">
            <DataCubeScene
              cells={state.cells}
              dimensions={state.dimensions}
              measures={state.measures}
              heightMeasure={heightMeasure}
              colorMeasure={colorMeasure}
              animation={state.animation}
              onCellHover={setHoverCell}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
              Operation history
            </CardTitle>
            <CardDescription className="text-xs">
              Every op applied to this cube session, most recent last.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[22rem] space-y-1.5 overflow-y-auto">
            {state.history.map((entry, i) => (
              <div
                key={i}
                className={
                  "rounded-md px-2 py-1.5 font-mono text-[11px] " +
                  (i === state.history.length - 1 ? "bg-chart-2/10 text-foreground" : "text-muted-foreground")
                }
              >
                {entry}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">Cells ({state.cells.length})</CardTitle>
          <CardDescription className="text-xs">The same data the 3D cube renders.</CardDescription>
        </CardHeader>
        <CardContent className="max-h-80 overflow-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                {state.dimensions.map((dim) => (
                  <TableHead key={dim.name} className="font-mono text-[10px] first:pl-4">
                    {dim.name}
                  </TableHead>
                ))}
                {state.measures.map((measure) => (
                  <TableHead key={measure.name} className="text-right font-mono text-[10px] last:pr-4">
                    {measure.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.cells.map((cell) => (
                <TableRow key={cell.id} data-hovered={hoverCell?.id === cell.id}>
                  {state.dimensions.map((dim) => (
                    <TableCell key={dim.name} className="whitespace-nowrap text-xs first:pl-4">
                      {cell.coords[dim.name]}
                    </TableCell>
                  ))}
                  {state.measures.map((measure) => (
                    <TableCell key={measure.name} className="whitespace-nowrap text-right font-mono text-xs last:pr-4">
                      {formatMeasure(cell.values[measure.name] ?? 0, measure.format)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
