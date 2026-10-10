"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/components/marketing/hud/use-prefers-reduced-motion";

type Particle = {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  seed: number;
  size: number;
};

type ParticleTreeProps = {
  className?: string;
  /** CSS color for particles. Defaults to currentColor. */
  color?: string;
  interactive?: boolean;
};

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Build a point-cloud oak-like silhouette in unit space (0..1). */
export function buildTreeParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  const n = Math.max(400, count);

  // Ground plane
  for (let i = 0; i < n * 0.22; i++) {
    const t = i / (n * 0.22);
    const x = 0.08 + t * 0.84 + (hash(i + 1) - 0.5) * 0.04;
    const y = 0.78 + hash(i + 9) * 0.16 + Math.sin(t * Math.PI) * 0.02;
    particles.push({
      x,
      y,
      ox: x,
      oy: y,
      vx: 0,
      vy: 0,
      seed: hash(i + 3),
      size: 0.6 + hash(i + 4) * 1.2,
    });
  }

  // Trunk
  for (let i = 0; i < n * 0.12; i++) {
    const t = i / (n * 0.12);
    const sway = Math.sin(t * 4) * 0.008;
    const x = 0.5 + sway + (hash(i + 20) - 0.5) * (0.02 + t * 0.01);
    const y = 0.78 - t * 0.38;
    particles.push({
      x,
      y,
      ox: x,
      oy: y,
      vx: 0,
      vy: 0,
      seed: hash(i + 21),
      size: 0.8 + hash(i + 22) * 1.1,
    });
  }

  // Branches + canopy
  const branchTips = [
    { x: 0.32, y: 0.42, w: 0.18 },
    { x: 0.5, y: 0.28, w: 0.24 },
    { x: 0.68, y: 0.4, w: 0.18 },
    { x: 0.4, y: 0.34, w: 0.14 },
    { x: 0.6, y: 0.33, w: 0.14 },
  ];
  const canopyCount = n - particles.length;
  for (let i = 0; i < canopyCount; i++) {
    const tip = branchTips[i % branchTips.length]!;
    const a = hash(i + 40) * Math.PI * 2;
    const r = Math.pow(hash(i + 41), 0.55) * tip.w;
    const x = tip.x + Math.cos(a) * r * 1.15;
    const y = tip.y + Math.sin(a) * r * 0.85;
    particles.push({
      x,
      y,
      ox: x,
      oy: y,
      vx: 0,
      vy: 0,
      seed: hash(i + 42),
      size: 0.55 + hash(i + 43) * 1.4,
    });
  }

  return particles;
}

export function ParticleTree({
  className,
  color = "currentColor",
  interactive = true,
}: ParticleTreeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const pointer = useRef({ x: 0.5, y: 0.45, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let particles = buildTreeParticles(1400);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const density = Math.floor((width * height) / 280);
      particles = buildTreeParticles(Math.min(2200, Math.max(700, density)));
    };

    const draw = (t: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;

      const px = pointer.current.x;
      const py = pointer.current.y;
      const active = interactive && pointer.current.active && !reduced;

      for (const p of particles) {
        const swayX = reduced ? 0 : Math.sin(t * 0.0008 + p.seed * 12) * 0.004;
        const swayY = reduced ? 0 : Math.cos(t * 0.0007 + p.seed * 9) * 0.003;
        let x = p.ox + swayX;
        let y = p.oy + swayY;

        if (active) {
          const dx = x - px;
          const dy = y - py;
          const dist = Math.hypot(dx, dy) + 0.0001;
          if (dist < 0.18) {
            const force = (0.18 - dist) * 0.08;
            x += (dx / dist) * force;
            y += (dy / dist) * force;
          }
        }

        const sx = x * width;
        const sy = y * height;
        const alpha = 0.35 + p.seed * 0.55;
        ctx.globalAlpha = alpha;
        ctx.fillRect(sx, sy, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      if (!reduced) {
        // Scan line
        const scanY = ((t * 0.04) % (height + 40)) - 20;
        const grad = ctx.createLinearGradient(0, scanY - 12, 0, scanY + 12);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.5, color === "currentColor" ? "rgba(127,127,127,0.08)" : "rgba(255,255,255,0.06)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(0, scanY - 12, width, 24);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (reduced) {
      draw(0);
      return () => ro.disconnect();
    }

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color, interactive, reduced]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("h-full w-full touch-none", className)}
      aria-hidden
      onPointerMove={(e) => {
        if (!interactive) return;
        const rect = e.currentTarget.getBoundingClientRect();
        pointer.current = {
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
          active: true,
        };
      }}
      onPointerLeave={() => {
        pointer.current.active = false;
      }}
    />
  );
}
