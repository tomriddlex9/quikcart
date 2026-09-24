"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label !== undefined ? <div className="mb-1 text-muted-foreground">{label}</div> : null}
      {payload.map((item, i) => {
        const numeric = typeof item.value === "number" ? item.value : Number(item.value);
        const text = format ? format(item.dataKey, numeric) : String(item.value);
        return (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: item.color ?? "var(--muted-foreground)" }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="ml-auto pl-4 tabular-nums">{text}</span>
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
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {note ? <CardDescription className="text-xs">{note}</CardDescription> : null}
        {right ? <CardAction>{right}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
