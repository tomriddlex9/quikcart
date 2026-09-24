"use client";

import type { ReactNode } from "react";

export interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  format?: (dataKey: string | undefined, value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="border border-line bg-ink-2 px-3 py-2 text-[11px] shadow-none">
      {label !== undefined ? <div className="mb-1 text-faint">{label}</div> : null}
      {payload.map((item, i) => {
        const numeric = typeof item.value === "number" ? item.value : Number(item.value);
        const text = format ? format(item.dataKey, numeric) : String(item.value);
        return (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color ?? "#8b94a3" }}
            />
            <span className="text-muted">{item.name}</span>
            <span className="ml-auto pl-4 text-paper">{text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ChartShell({
  title,
  note,
  children,
  right,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="panel px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-medium text-paper-dim">{title}</h2>
          {note ? <div className="mt-0.5 text-[10.5px] text-faint">{note}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
