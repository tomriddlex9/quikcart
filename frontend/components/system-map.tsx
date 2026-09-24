"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Pill } from "@/components/pill";
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
  return state === "flowing" ? "bg-green" : state === "demo" ? "bg-amber" : "bg-faint";
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <div className="xl:col-span-3">
        <div className="panel overflow-x-auto">
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
                className="absolute -translate-x-1/2 text-[10px] tracking-[0.18em] text-faint"
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
                  laneState === "flowing" &&
                  JOURNEY_BADGE_EDGE[lane ?? "batch"] === e.id;
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
                      <span className="inline-flex items-center gap-1.5 border border-line bg-ink-2/95 px-2 py-0.5 text-[9.5px] text-muted">
                        <span className={`h-1.5 w-1.5 rounded-full ${laneDotClass(state)}`} />
                        <span style={{ color: JOURNEY_LANE_META[lane].color }}>
                          {JOURNEY_LANE_META[lane].label}
                        </span>
                        <span className="text-faint">{laneWord(state)}</span>
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
                className={`absolute -translate-x-1/2 -translate-y-1/2 border px-2.5 text-left transition-opacity ${
                  selectedId === n.id
                    ? "border-amber bg-panel-2"
                    : "border-line bg-panel hover:border-line hover:bg-panel-2"
                } ${nodeDim(n) ? "opacity-25" : "opacity-100"}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              >
                <div className="flex h-full flex-col justify-center gap-0.5">
                  <div className="truncate text-[11.5px] font-medium leading-tight text-paper">
                    {n.label}
                  </div>
                  <div className="truncate text-[9.5px] leading-tight text-faint">{n.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-muted">
          <span className="text-faint">edge type</span>
          {(Object.keys(EDGE_KIND_META) as EdgeKind[]).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-5"
                style={{ backgroundColor: EDGE_KIND_META[kind].color }}
              />
              {EDGE_KIND_META[kind].label}
            </span>
          ))}
          <span className="ml-auto text-faint">hover to trace · click to pin details</span>
        </div>
      </div>

      {/* Detail panel */}
      <div className="xl:col-span-1">
        {selected ? (
          <div className="panel px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-[17px] font-semibold leading-tight text-paper">
                  {selected.label}
                </h2>
                <div className="mt-0.5 text-[11px] text-faint">{selected.sub}</div>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close details"
                className="rounded-xs border border-line p-1 text-muted hover:text-paper"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Pill tone="amber">{selected.phaseLabel}</Pill>
              <Pill>{selected.layer}</Pill>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-paper-dim">{selected.role}</p>

            <div className="mt-4 border-t border-line-soft pt-3">
              <div className="mb-1.5 text-[10.5px] tracking-wide text-faint">key facts</div>
              <ul className="space-y-1.5">
                {selected.facts.map((f, i) => (
                  <li key={i} className="text-[11.5px] leading-relaxed text-muted">
                    · {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 border-t border-line-soft pt-3">
              <div className="mb-1.5 text-[10.5px] tracking-wide text-faint">connections</div>
              <ul className="space-y-1.5 text-[11.5px]">
                {MAP_EDGES.filter((e) => e.from === selected.id || e.to === selected.id).map((e) => {
                  const otherId = e.from === selected.id ? e.to : e.from;
                  const other = nodeById.get(otherId);
                  const dir = e.from === selected.id ? "→" : "←";
                  return (
                    <li key={e.id} className="flex items-center gap-2 text-muted">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: EDGE_KIND_META[e.kind].color }}
                      />
                      <span className="text-paper-dim">{dir}</span>
                      <span>{other?.label ?? otherId}</span>
                      <span className="text-faint">· {e.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <div className="panel px-4 py-6 text-[12px] leading-relaxed text-muted">
            <span className="font-display text-[15px] text-paper-dim">How to read this map</span>
            <p className="mt-2">
              Data enters from simulated operations on the left, is captured and streamed through
              the middle, lands in the Delta medallion, and is served to ML, RAG, the agent and
              finally the UIs on the right.
            </p>
            <p className="mt-2 text-faint">
              Hover any node to trace its connections; click to pin its role, phase and key facts
              here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
