"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBusinessINR } from "@/lib/business/format";

export interface UsualPoint {
  label: string;
  today: number | null;
  usual?: number | null;
}

export function TodayVsUsualChart({
  points,
  title,
  height = 220,
}: {
  points: UsualPoint[];
  title: string;
  height?: number;
}) {
  const hasUsual = points.some((p) => p.usual !== undefined && p.usual !== null);
  return (
    <figure className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <figcaption className="mb-3 flex items-center justify-between gap-2 text-[13px]">
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 bg-chart-1" aria-hidden /> Sales
          </span>
          {hasUsual ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-0.5 w-3 border-t border-dashed border-muted-foreground" aria-hidden /> Your usual
            </span>
          ) : null}
        </span>
      </figcaption>
      <div style={{ height }} role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <YAxis
              width={52}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatBusinessINR(v)}
            />
            <Tooltip
              formatter={(v) => formatBusinessINR(typeof v === "number" ? v : Number(v))}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            {hasUsual ? (
              <Line
                type="monotone"
                dataKey="usual"
                name="Your usual"
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="today"
              name="Sales"
              stroke="var(--chart-1)"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Daily sales → points where "usual" is the average of the days before the last one. */
export function dailyPointsWithUsual(
  trend: { at: string; sales: number | null }[],
): UsualPoint[] {
  const prior = trend.slice(0, -1).map((p) => p.sales ?? 0);
  const usual = prior.length > 0 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
  return trend.map((p) => ({
    label: new Date(p.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
    today: p.sales,
    usual,
  }));
}
