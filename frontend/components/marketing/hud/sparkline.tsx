"use client";

import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

type HudSparklineProps = {
  values: readonly number[];
  className?: string;
  label: string;
  valueLabel: string;
};

export function HudSparkline({ values, className, label, valueLabel }: HudSparklineProps) {
  const id = useId();
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * 100;
        const y = 100 - ((v - min) / span) * 100;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [values]);

  const last = values[values.length - 1] ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lastY = 100 - ((last - min) / span) * 100;

  return (
    <div className={cn("flex h-full flex-col gap-2 p-3 md:p-4", className)}>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-muted-foreground">{label}</span>
        <span>{valueLabel}</span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="mt-auto h-14 w-full text-foreground md:h-16"
        aria-hidden
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          className="qc-hud-draw"
          pathLength={1}
        />
        <circle
          cx="100"
          cy={lastY}
          r="1.6"
          fill="currentColor"
          className="qc-hud-dot"
        >
          <title>{id}</title>
        </circle>
      </svg>
    </div>
  );
}
