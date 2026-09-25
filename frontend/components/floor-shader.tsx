"use client";

import { useEffect, useRef } from "react";

const GLYPHS = " .:-=+*#%@";
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function field(nx: number, ny: number, t: number) {
  const ax = nx - 0.38 + Math.sin(t * 0.35) * 0.04;
  const ay = ny - 0.4 + Math.cos(t * 0.28) * 0.03;
  const bx = nx - 0.62 + Math.cos(t * 0.31) * 0.035;
  const by = ny - 0.62 + Math.sin(t * 0.4) * 0.04;
  const blob =
    Math.exp(-(ax * ax * 7.2 + ay * ay * 5.4)) +
    Math.exp(-(bx * bx * 6.4 + by * by * 8.1)) * 0.92;
  const weave =
    Math.sin(nx * 9 + t) * Math.cos(ny * 7 - t * 0.8) * 0.08 +
    Math.sin((nx + ny) * 14 + t * 1.4) * 0.04;
  return blob + weave;
}

export function FloorShader({
  mode = "dither",
  className,
}: {
  mode?: "dither" | "ascii";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    const draw = (time: number) => {
      const t = reduce ? 0.8 : time / 1000;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cell = mode === "ascii" ? 11 : 7;
      const cols = Math.max(8, Math.floor(rect.width / cell));
      const rows = Math.max(8, Math.floor(rect.height / cell));
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const cw = rect.width / cols;
      const ch = rect.height / rows;

      if (mode === "ascii") {
        ctx.font = `${Math.floor(ch)}px ui-monospace, monospace`;
        ctx.textBaseline = "top";
      }

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const v = field(x / cols, y / rows, t);
          if (mode === "ascii") {
            const shifted = field((x / cols + t * 0.02) % 1, y / rows, t * 0.6);
            const idx = Math.max(0, Math.min(GLYPHS.length - 1, Math.floor(shifted * (GLYPHS.length - 1))));
            if (idx < 2) continue;
            ctx.fillStyle = `rgba(198,245,58,${0.15 + idx / GLYPHS.length * 0.55})`;
            ctx.fillText(GLYPHS[idx], x * cw, y * ch);
          } else {
            const threshold = (BAYER[y % 4][x % 4] + 0.5) / 16;
            if (v > threshold * 0.95 + 0.08) {
              const alpha = v > 0.55 ? 0.95 : 0.72;
              ctx.fillStyle = `rgba(198,245,58,${alpha})`;
              ctx.fillRect(x * cw + 0.6, y * ch + 0.6, Math.max(1, cw - 1.4), Math.max(1, ch - 1.4));
            }
          }
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
