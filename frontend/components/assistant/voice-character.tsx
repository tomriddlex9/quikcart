"use client";

// The assistant's face: SVG eyes + mouth over the Matrix Orb. The mouth opens via the
// --mouth CSS variable (0..1), written straight to the DOM from the output level each
// animation frame — no React re-renders while the assistant talks.

import { useEffect, useRef } from "react";
import { MatrixOrb, type MatrixOrbState } from "@/components/ui/matrix-orb";
import { cn } from "@/lib/utils";

export interface VoiceCharacterProps {
  state: MatrixOrbState;
  /** Orb level source (mic while listening, assistant audio otherwise). */
  levelSource?: () => number;
  /** Assistant output level; drives the mouth. Falls back to `levelSource`. */
  mouthSource?: () => number;
  size?: number;
  className?: string;
}

const EYE_STYLE = {
  transformBox: "fill-box",
  transformOrigin: "center",
  animation: "qc-blink 5.5s infinite",
} as const;

export function VoiceCharacter({ state, levelSource, mouthSource, size = 132, className }: VoiceCharacterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sources = useRef({ state, mouthSource: mouthSource ?? levelSource });
  useEffect(() => {
    sources.current = { state, mouthSource: mouthSource ?? levelSource };
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const still =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.reducedMotion === "true";
    let raf = 0;
    let mouth = 0;
    const tick = () => {
      const { state: current, mouthSource: source } = sources.current;
      const target = current === "speaking" && source ? Math.max(0, Math.min(1, source() * 1.4)) : 0;
      mouth += (target - mouth) * (target > mouth ? 0.5 : 0.2);
      root.style.setProperty("--mouth", mouth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    if (still) root.style.setProperty("--mouth", "0");
    else raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const lookUp = state === "thinking";
  const wide = state === "listening";
  return (
    <div
      ref={rootRef}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <MatrixOrb state={state} levelSource={levelSource} size={size} className="absolute inset-0" />
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden
        className="pointer-events-none absolute inset-0 text-foreground"
      >
        <g
          fill="currentColor"
          stroke="var(--background)"
          strokeWidth={3}
          strokeLinejoin="round"
          style={{ paintOrder: "stroke" }}
        >
          <g style={{ transform: lookUp ? "translate(3px,-4px)" : "none", transition: "transform 200ms ease-out" }}>
            <rect x={wide ? 29 : 30} y={wide ? 36 : 38} width={wide ? 12 : 10} height={wide ? 17 : 14} rx={5} className="qc-blink" style={EYE_STYLE} />
            <rect x={wide ? 59 : 60} y={wide ? 36 : 38} width={wide ? 12 : 10} height={wide ? 17 : 14} rx={5} className="qc-blink" style={EYE_STYLE} />
          </g>
          <ellipse
            cx={50}
            cy={68}
            rx={11}
            ry={9}
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              transform: "scaleY(calc(0.14 + var(--mouth, 0) * 0.86))",
            }}
          />
        </g>
      </svg>
    </div>
  );
}
