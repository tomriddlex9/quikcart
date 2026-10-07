"use client";

// Matrix Orb — a canvas dot-matrix sphere with four voice states. Written for this repo
// and inspired by the Rare UI Matrix Orb (https://www.rareui.com); the prop surface follows
// that component (state, level, levelSource, size, color, dots, labels, className).
//
// - `levelSource` is polled inside requestAnimationFrame (use it with refs, not React state);
//   `level` is the static fallback.
// - With prefers-reduced-motion (or the console's reduced-motion toggle) a static grid is
//   drawn once and no animation loop runs.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type MatrixOrbState = "idle" | "listening" | "thinking" | "speaking";

export const DEFAULT_ORB_LABELS: Record<MatrixOrbState, string> = {
  idle: "Assistant is idle",
  listening: "Assistant is listening",
  thinking: "Assistant is thinking",
  speaking: "Assistant is speaking",
};

export interface MatrixOrbProps {
  state?: MatrixOrbState;
  /** Static 0..1 level (ignored when `levelSource` is given). */
  level?: number;
  /** Polled every animation frame; return 0..1. Prefer this for live audio levels. */
  levelSource?: () => number;
  /** Rendered square size in CSS pixels. */
  size?: number;
  /** Any CSS color. Defaults to the surrounding text color (`currentColor`). */
  color?: string;
  /** Grid resolution (dots across the diameter). */
  dots?: number;
  /** Accessible label per state. */
  labels?: Partial<Record<MatrixOrbState, string>>;
  className?: string;
}

const TAU = Math.PI * 2;

interface Cell {
  /** Normalised position in the unit disc. */
  x: number;
  y: number;
  r: number;
  angle: number;
  /** Sphere depth 0..1 (1 = facing the viewer). */
  z: number;
  /** Static per-dot phase for organic shimmer. */
  seed: number;
}

export function buildCells(dots: number): Cell[] {
  const n = Math.max(7, Math.round(dots));
  const cells: Cell[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const x = ((col + 0.5) / n) * 2 - 1;
      const y = ((row + 0.5) / n) * 2 - 1;
      const r = Math.hypot(x, y);
      if (r > 1) continue;
      cells.push({
        x,
        y,
        r,
        angle: Math.atan2(y, x),
        z: Math.sqrt(1 - r * r),
        seed: ((col * 73856093) ^ (row * 19349663)) % 1000 / 1000,
      });
    }
  }
  return cells;
}

/** Per-dot energy 0..1 for a state at time `t` (seconds) with smoothed `level`. */
export function dotEnergy(cell: Cell, state: MatrixOrbState, t: number, level: number): number {
  const shimmer = 0.5 + 0.5 * Math.sin(t * 1.3 + cell.seed * TAU);
  switch (state) {
    case "idle":
      return 0.18 + 0.12 * Math.sin(t * 0.9 - cell.r * 3.2) + 0.04 * shimmer;
    case "listening": {
      // Rings contract toward the centre; amplitude follows the mic.
      const ring = 0.5 + 0.5 * Math.sin(cell.r * 9 + t * 4.2);
      return 0.2 + (0.25 + 0.75 * level) * ring * (1 - cell.r * 0.35) + 0.05 * shimmer;
    }
    case "thinking": {
      // A bright sweep orbits the sphere.
      let delta = Math.abs(((cell.angle - t * 2.4) % TAU) + TAU) % TAU;
      if (delta > Math.PI) delta = TAU - delta;
      const sweep = Math.max(0, 1 - delta / 1.1);
      return 0.15 + 0.65 * sweep * (0.45 + 0.55 * cell.r) + 0.05 * shimmer;
    }
    case "speaking": {
      // Rings expand outward; amplitude follows the assistant's audio.
      const ring = 0.5 + 0.5 * Math.sin(cell.r * 7 - t * 6.5);
      return 0.22 + (0.2 + 0.8 * level) * ring * (1.05 - cell.r * 0.3) + 0.06 * shimmer;
    }
  }
}

function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reducedMotion === "true"
  );
}

export function MatrixOrb({
  state = "idle",
  level = 0,
  levelSource,
  size = 160,
  color,
  dots = 21,
  labels,
  className,
}: MatrixOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest props for the animation loop without restarting it on every change.
  const live = useRef({ state, level, levelSource });
  useEffect(() => {
    live.current = { state, level, levelSource };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const cells = buildCells(dots);
    const n = Math.max(7, Math.round(dots));
    const pitch = size / n;
    const radius = size / 2;
    let fill = color ?? "currentColor";
    let smooth = 0;
    let raf = 0;
    let frame = 0;
    let motionOff = reducedMotion();

    const resolveColor = () => {
      fill = color ?? (getComputedStyle(canvas).color || "currentColor");
    };

    const draw = (t: number, still: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = fill;
      const current = live.current;
      const raw = still ? 0 : (current.levelSource ? current.levelSource() : current.level) || 0;
      smooth += (Math.max(0, Math.min(1, raw)) - smooth) * 0.35;
      const stateNow = still ? "idle" : current.state;
      for (const cell of cells) {
        const energy = still ? 0.3 : Math.max(0, Math.min(1, dotEnergy(cell, stateNow, t, smooth)));
        // Light from the upper left gives the grid a spherical read.
        const light = 0.55 + 0.45 * (-cell.x * 0.45 - cell.y * 0.55 + cell.z);
        const depth = 0.3 + 0.7 * cell.z;
        const dotRadius = pitch * 0.5 * (0.18 + 0.82 * energy) * (0.55 + 0.45 * depth);
        ctx.globalAlpha = Math.max(0.08, Math.min(1, (0.2 + 0.8 * energy) * Math.min(1, light + 0.2)));
        ctx.beginPath();
        ctx.arc(radius + cell.x * (radius - pitch / 2), radius + cell.y * (radius - pitch / 2), dotRadius, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    resolveColor();
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const loop = (now: number) => {
      if (frame++ % 45 === 0) resolveColor(); // follow theme changes cheaply
      draw(now / 1000, false);
      raf = requestAnimationFrame(loop);
    };
    const apply = () => {
      cancelAnimationFrame(raf);
      motionOff = reducedMotion();
      resolveColor();
      if (motionOff) draw(0, true);
      else raf = requestAnimationFrame(loop);
    };
    apply();
    motionQuery.addEventListener("change", apply);
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion", "class"] });

    return () => {
      cancelAnimationFrame(raf);
      motionQuery.removeEventListener("change", apply);
      observer.disconnect();
    };
  }, [size, dots, color]);

  const text = { ...DEFAULT_ORB_LABELS, ...labels }[state];
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={text}
      data-state={state}
      className={cn("block shrink-0 text-foreground", className)}
      style={{ width: size, height: size }}
    />
  );
}
