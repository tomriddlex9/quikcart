"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CANVAS_H,
  CANVAS_W,
  COLUMN_LABELS,
  EDGE_KIND_META,
  FLOW_EDGES,
  FLOW_NODES,
  type EdgeKind,
  type FlowEdge,
  type FlowNode,
} from "./data";

interface Point {
  x: number;
  y: number;
}

/** Point where the ray from a node's centre toward (tx, ty) exits its box. */
function anchor(n: FlowNode, tx: number, ty: number): Point {
  const dx = tx - n.x;
  const dy = ty - n.y;
  const sx = dx !== 0 ? n.w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const sy = dy !== 0 ? n.h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const s = Math.min(sx, sy);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

function edgePath(from: FlowNode, to: FlowNode): string {
  const a = anchor(from, to.x, to.y);
  const b = anchor(to, from.x, from.y);
  const dx = b.x - a.x;
  const k = Math.max(24, Math.min(80, Math.abs(dx) * 0.4));
  const c1 = { x: a.x + Math.sign(dx || 1) * k, y: a.y };
  const c2 = { x: b.x - Math.sign(dx || 1) * k, y: b.y };
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** The trust-boundary edge gets a high arc above the whole canvas, not the standard bezier. */
function trustArcPath(from: FlowNode, to: FlowNode): string {
  const startX = from.x;
  const startY = from.y - from.h / 2;
  const endX = to.x;
  const endY = to.y - to.h / 2;
  const apex = 55;
  return `M ${startX} ${startY} C ${startX} ${apex}, ${endX} ${apex}, ${endX} ${endY}`;
}

function midLabel(from: FlowNode, to: FlowNode): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

export function FlowDiagram() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(FLOW_NODES.map((n) => [n.id, n])), []);
  const focusId = hoverId ?? selectedId;

  const connected = useMemo(() => {
    const set = new Set<string>();
    if (!focusId) return set;
    for (const e of FLOW_EDGES) {
      if (e.from === focusId || e.to === focusId) {
        set.add(e.id);
        set.add(e.from);
        set.add(e.to);
      }
    }
    return set;
  }, [focusId]);

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  function edgeOpacity(e: FlowEdge): number {
    if (!focusId) return e.kind === "trust" ? 0.85 : 0.55;
    return connected.has(e.id) ? 1 : 0.08;
  }

  function nodeDim(n: FlowNode): boolean {
    return focusId !== null && !connected.has(n.id) && n.id !== focusId;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
          {COLUMN_LABELS.map((c) => (
            <div
              key={c.label}
              className="absolute top-2 -translate-x-1/2 text-[10px] tracking-[0.18em] text-muted-foreground uppercase"
              style={{ left: c.x }}
            >
              {c.label}
            </div>
          ))}

          <svg
            className="absolute inset-0"
            width={CANVAS_W}
            height={CANVAS_H}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            aria-hidden
          >
            <defs>
              {(Object.keys(EDGE_KIND_META) as EdgeKind[]).map((kind) => (
                <marker
                  key={kind}
                  id={`arch-arrow-${kind}`}
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

            {FLOW_EDGES.filter((e) => e.kind !== "trust").map((e) => {
              const from = nodeById.get(e.from);
              const to = nodeById.get(e.to);
              if (!from || !to) return null;
              const color = EDGE_KIND_META[e.kind].color;
              const labelPos = midLabel(from, to);
              const path = edgePath(from, to);
              return (
                <g key={e.id} opacity={edgeOpacity(e)} style={{ transition: "opacity 150ms ease" }}>
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={focusId && connected.has(e.id) ? 2 : 1.4}
                    strokeDasharray={e.kind === "cdc" || e.kind === "quarantine" ? "5 3" : undefined}
                    markerEnd={`url(#arch-arrow-${e.kind})`}
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y - 6}
                    textAnchor="middle"
                    fontSize={9.5}
                    fill={color}
                    className="select-none"
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}

            {/* Trust boundary: rendered last so it always reads on top */}
            {FLOW_EDGES.filter((e) => e.kind === "trust").map((e) => {
              const from = nodeById.get(e.from);
              const to = nodeById.get(e.to);
              if (!from || !to) return null;
              const color = EDGE_KIND_META.trust.color;
              const path = trustArcPath(from, to);
              return (
                <g key={e.id} opacity={edgeOpacity(e)} style={{ transition: "opacity 150ms ease" }}>
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="7 4"
                    markerEnd={`url(#arch-arrow-${e.kind})`}
                  />
                  <text
                    x={(from.x + to.x) / 2}
                    y={38}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={500}
                    fill={color}
                    className="select-none"
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {FLOW_NODES.map((n) => {
            const Icon = n.icon;
            const isSelected = selectedId === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id === selectedId ? null : n.id)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                aria-pressed={isSelected}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border px-3 text-left transition-[opacity,border-color,background-color] ${
                  isSelected
                    ? "border-primary bg-secondary"
                    : "border-border bg-card hover:border-foreground/40 hover:bg-secondary/60"
                } ${nodeDim(n) ? "opacity-20" : "opacity-100"}`}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              >
                <div className="flex h-full items-center gap-2">
                  <Icon className="size-4 shrink-0 text-foreground" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium leading-tight text-foreground">
                      {n.label}
                    </div>
                    <div className="truncate text-[10px] leading-tight text-muted-foreground">
                      {n.sub}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
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
        <span className="ml-auto">hover to trace · click a node for details</span>
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <selected.icon className="size-5 text-foreground" strokeWidth={1.75} />
                  <SheetTitle>{selected.label}</SheetTitle>
                </div>
                <SheetDescription>{selected.sub}</SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-4 px-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{selected.phase}</Badge>
                  <Badge variant="secondary">{selected.layer}</Badge>
                </div>

                <p className="text-sm leading-relaxed text-foreground">{selected.role}</p>

                <div className="text-xs text-muted-foreground">{selected.tech}</div>

                <div className="border-t border-border pt-3">
                  <div className="mb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
                    Key facts
                  </div>
                  <ul className="space-y-1.5">
                    {selected.facts.map((f) => (
                      <li key={f} className="text-[12.5px] leading-relaxed text-foreground/90">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-border pt-3">
                  <div className="mb-1.5 text-[11px] tracking-wide text-muted-foreground uppercase">
                    Connections
                  </div>
                  <ul className="space-y-1.5 text-[12.5px]">
                    {FLOW_EDGES.filter((e) => e.from === selected.id || e.to === selected.id).map(
                      (e) => {
                        const otherId = e.from === selected.id ? e.to : e.from;
                        const other = nodeById.get(otherId);
                        const dir = e.from === selected.id ? "→" : "←";
                        return (
                          <li key={e.id} className="flex items-center gap-2 text-foreground/90">
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: EDGE_KIND_META[e.kind].color }}
                            />
                            <span className="text-muted-foreground">{dir}</span>
                            <span>{other?.label ?? otherId}</span>
                            <span className="text-muted-foreground">· {e.label}</span>
                          </li>
                        );
                      },
                    )}
                  </ul>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
