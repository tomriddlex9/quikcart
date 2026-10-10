"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/components/marketing/hud/use-prefers-reduced-motion";

const GLYPHS = "·.:+=*#@%";

type AsciiFieldProps = {
  className?: string;
  density?: number;
};

/** Low-res ASCII / pixel field that brightens near the pointer. */
export function AsciiField({ className, density = 18 }: AsciiFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const pointer = useRef({ x: -1, y: -1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      const cols = Math.max(8, Math.floor(width / density));
      const rows = Math.max(6, Math.floor(height / density));
      const cellW = width / cols;
      const cellH = height / rows;
      ctx.font = `${Math.max(8, density * 0.7)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const px = pointer.current.x;
      const py = pointer.current.y;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = (col + 0.5) * cellW;
          const cy = (row + 0.5) * cellH;
          let intensity = 0.08 + 0.04 * Math.sin(t * 0.001 + col * 0.3 + row * 0.2);
          if (px >= 0) {
            const d = Math.hypot(cx - px, cy - py);
            intensity += Math.max(0, 1 - d / 120) * 0.75;
          }
          if (intensity < 0.12) continue;
          const gi = Math.min(GLYPHS.length - 1, Math.floor(intensity * (GLYPHS.length - 1)));
          ctx.globalAlpha = 0.15 + intensity * 0.55;
          ctx.fillStyle = "currentColor";
          ctx.fillText(GLYPHS[gi]!, cx, cy);
        }
      }
      ctx.globalAlpha = 1;
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
  }, [density, reduced]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-auto h-full w-full", className)}
      aria-hidden
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }}
      onPointerLeave={() => {
        pointer.current = { x: -1, y: -1 };
      }}
    />
  );
}
