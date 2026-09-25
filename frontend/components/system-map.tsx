"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EDGE_KIND_META,
  JOURNEY_BADGE_EDGE,
  JOURNEY_LANE_EDGES,
  JOURNEY_LANE_META,
  MAP_EDGES,
  MAP_H,
  MAP_NODES,
  MAP_W,
  type EdgeKind,
  type JourneyLane,
  type JourneyState,
  type LaneState,
  type MapEdge,
  type MapNode,
} from "@/lib/system-map";

interface Point {
  x: number;
  y: number;
}

/** Point where the ray from node centre toward (tx, ty) exits the node box. */
function anchor(n: MapNode, tx: number, ty: number): Point {
  const dx = tx - n.x;
  const dy = ty - n.y;
  const sx = dx !== 0 ? n.w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const sy = dy !== 0 ? n.h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const s = Math.min(sx, sy);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

function edgePath(from: MapNode, to: MapNode): string {
  const a = anchor(from, to.x, to.y);
  const b = anchor(to, from.x, from.y);
  const dx = b.x - a.x;
  const k = Math.max(28, Math.min(90, Math.abs(dx) * 0.45));
  const c1 = { x: a.x + Math.sign(dx || 1) * k, y: a.y };
  const c2 = { x: b.x - Math.sign(dx || 1) * k, y: b.y };
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function midLabel(from: MapNode, to: MapNode): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

const LAYER_COLUMNS: Array<{ label: string; x: number }> = [
  { label: "source", x: 100 },
  { label: "ingest", x: 310 },
  { label: "lakehouse", x: 520 },
  { label: "storage", x: 730 },
  { label: "intelligence", x: 950 },
  { label: "serving", x: 1160 },
];

/** Lane owning a given edge id, if any (used by the data-journey overlay). */
const LANE_BY_EDGE: Map<string, JourneyLane> = new Map(
  (Object.keys(JOURNEY_LANE_EDGES) as JourneyLane[]).flatMap((lane) =>
    JOURNEY_LANE_EDGES[lane].map((edgeId) => [edgeId, lane] as const),
  ),
);

function laneDotClass(state: LaneState): string {
  return state === "flowing" ? "bg-chart-2" : state === "demo" ? "bg-chart-3" : "bg-muted-foreground";
}

function laneWord(state: LaneState): string {
  return state === "flowing" ? "flowing" : state === "demo" ? "manual demo" : "idle";
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function SystemMap({ journey = null }: { journey?: JourneyState | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const nodeById = useMemo(() => new Map(MAP_NODES.map((n) => [n.id, n])), []);
  const focusId = hoverId ?? selectedId;

  const connected = useMemo(() => {
    const set = new Set<string>();
    if (!focusId) return set;
    for (const e of MAP_EDGES) {
      if (e.from === focusId || e.to === focusId) {
        set.add(e.id);
        set.add(e.from);
        set.add(e.to);
      }
    }
    return set;
  }, [focusId]);

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  function edgeOpacity(e: MapEdge): number {
    if (!focusId) return journey && !LANE_BY_EDGE.has(e.id) ? 0.3 : 0.75;
    return connected.has(e.id) ? 1 : 0.12;
  }

  function nodeDim(n: MapNode): boolean {
    return focusId !== null && !connected.has(n.id) && n.id !== focusId;
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
      <div className="xl:col-span-3">
        <Card size="sm" className="overflow-x-auto py-0">
          <div
            className="relative"
            style={{ width: MAP_W, height: MAP_H }}
            role="group"
            aria-label="System map of the QuickCart platform"
          >
            {/* Layer labels */}
            {LAYER_COLUMNS.map((c) => (
              <div
                key={c.label}
                className="absolute -translate-x-1/2 text-[10px] tracking-[0.18em] text-muted-foreground"
                style={{ left: c.x, top: 8 }}
              >
                {c.label}
              </div>
            ))}

            {/* Edge layer */}
            <svg
              className="absolute inset-0"
              width={MAP_W}
              height={MAP_H}
              viewBox={`0 0 ${MAP_W} ${MAP_H}`}
              aria-hidden
            >
              <defs>
                {(Object.keys(EDGE_KIND_META) as EdgeKind[]).map((kind) => (
                  <marker
                    key={kind}
                    id={`arrow-${kind}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 9 5 L 0 9 z" fill={EDGE_KIND_META[kind].color} />
                  </marker>
                ))}
              </defs>
              {MAP_EDGES.map((e) => {
                const from = nodeById.get(e.from);
                const to = nodeById.get(e.to);
                if (!from || !to) return null;
                const color = EDGE_KIND_META[e.kind].color;
                const labelPos = midLabel(from, to);
                const path = edgePath(from, to);
                const lane = journey ? LANE_BY_EDGE.get(e.id) : undefined;
                const laneState = journey && lane ? journey[lane] : undefined;
                const showDot =
                  laneState === "flowing" && JOURNEY_BADGE_EDGE[lane ?? "batch"] === e.id;
                return (
                  <g key={e.id} opacity={edgeOpacity(e)} style={{ transition: "opacity 150ms ease" }}>
                    <path
                      d={path}
                      fill="none"
                      stroke={color}
                      strokeWidth={focusId && connected.has(e.id) ? 1.8 : 1.2}
                      strokeDasharray={e.kind === "cdc" ? "5 3" : undefined}
                      markerEnd={`url(#arrow-${e.kind})`}
                    />
                    {showDot ? (
                      <circle r={2.6} fill={JOURNEY_LANE_META[lane ?? "batch"].color} opacity={0.95}>
                        {reducedMotion ? null : (
                          <animateMotion dur="3.4s" repeatCount="indefinite" path={path} />
                        )}
                      </circle>
                    ) : null}
                    <text
                      x={labelPos.x}
                      y={labelPos.y - 5}
                      textAnchor="middle"
                      fontSize={9}
                      fill={color}
                      className="select-none"
                    >
                      {e.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Journey badges — one per lane, on its badge edge */}
            {journey
              ? (Object.keys(JOURNEY_BADGE_EDGE) as JourneyLane[]).map((lane) => {
                  const edge = MAP_EDGES.find((e) => e.id === JOURNEY_BADGE_EDGE[lane]);
                  if (!edge) return null;
                  const from = nodeById.get(edge.from);
                  const to = nodeById.get(edge.to);
                  if (!from || !to) return null;
                  const pos = midLabel(from, to);
                  const state = journey[lane];
                  return (
                    <div
                      key={lane}
                      className="pointer-events-none absolute z-10 -translate-x-1/2"
                      style={{ left: pos.x, top: pos.y + 10 }}
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-popover/95 px-2 py-0.5 text-[10px]">
                        <span className={`size-1.5 rounded-full ${laneDotClass(state)}`} />
                        <span style={{ color: JOURNEY_LANE_META[lane].color }}>
                          {JOURNEY_LANE_META[lane].label}
                        </span>
                        <span className="text-muted-foreground">{laneWord(state)}</span>
                      </span>
                    </div>
                  );
                })
              : null}

            {/* Node layer */}
            {MAP_NODES.map((n) => (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id === selectedId ? null : n.id)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                aria-pressed={selectedId === n.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2.5 text-left transition-opacity ${
                  selectedId === n.id
                    ? "border-foreground/40 bg-secondary"
                    : "border-border bg-card hover:bg-secondary/60"
                } ${nodeDim(n) ? "opacity-25" : "opacity-100"}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              >
                <div className="flex h-full flex-col justify-center gap-0.5">
                  <div className="truncate text-xs font-medium leading-tight">{n.label}</div>
                  <div className="truncate text-[10px] leading-tight text-muted-foreground">
                    {n.sub}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span>edge type</span>
          {(Object.keys(EDGE_KIND_META) as EdgeKind[]).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-5"
                style={{ backgroundColor: EDGE_KIND_META[kind].color }}
              />
              {EDGE_KIND_META[kind].label}
            </span>
          ))}
          <span className="ml-auto">hover to trace · click to pin</span>
        </div>
      </div>

      <div className="xl:col-span-1">
        {selected ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">{selected.label}</CardTitle>
              <CardDescription className="text-xs">{selected.sub}</CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close details"
                >
                  <X strokeWidth={1.75} />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone="amber">{selected.phaseLabel}</Pill>
                <Pill>{selected.layer}</Pill>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">{selected.role}</p>

              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-1.5 text-xs text-muted-foreground">key facts</div>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {selected.facts.map((f, i) => (
                    <li key={i}>· {f}</li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-1.5 text-xs text-muted-foreground">connections</div>
                <ul className="space-y-1.5 text-xs">
                  {MAP_EDGES.filter((e) => e.from === selected.id || e.to === selected.id).map(
                    (e) => {
                      const otherId = e.from === selected.id ? e.to : e.from;
                      const other = nodeById.get(otherId);
                      const dir = e.from === selected.id ? "→" : "←";
                      return (
                        <li key={e.id} className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="inline-block size-1.5 rounded-full"
                            style={{ backgroundColor: EDGE_KIND_META[e.kind].color }}
                          />
                          <span className="text-foreground">{dir}</span>
                          <span>{other?.label ?? otherId}</span>
                          <span>· {e.label}</span>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">How to read this map</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Data enters from simulated operations on the left, is captured and streamed through
                the middle, lands in the Delta medallion, and is served to ML, RAG, the agent and
                the UIs on the right.
              </p>
              <p>Hover a node to trace its connections; click to pin its details here.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
