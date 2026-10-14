"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Inbox, Minus } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/charts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MetricValue, Status } from "@/lib/business/types";
import { cn } from "@/lib/utils";

// ── Layout ─────────────────────────────────────────────────────────────────

export function Panel({
  title,
  note,
  right,
  children,
  className,
}: {
  title: string;
  note?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {note ? <CardDescription className="text-xs">{note}</CardDescription> : null}
        {right ? <CardAction>{right}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A widget the dummy data cannot fill: title and frame stay, content says so. */
export function EmptyPanel({ title, note, what }: { title: string; note?: string; what: string }) {
  return (
    <Panel title={title} note={note}>
      <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed border-border/80 bg-muted/20 p-4 text-center">
        <div className="space-y-1.5">
          <Inbox className="mx-auto size-5 text-muted-foreground" strokeWidth={1.5} />
          <div className="text-sm font-medium">No data yet</div>
          <p className="max-w-xs text-xs text-muted-foreground">{what}</p>
        </div>
      </div>
    </Panel>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        cols === 3 && "md:grid-cols-3",
        cols === 4 && "md:grid-cols-4",
        cols === 5 && "md:grid-cols-3 xl:grid-cols-5",
      )}
    >
      {children}
    </div>
  );
}

// ── KPI tiles ──────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<Status, string> = {
  good: "text-chart-2",
  watch: "text-chart-3",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
};

/** KPI from the business metric registry, with its comparison to the baseline. */
export function MetricKpi({ metric }: { metric: MetricValue | undefined }) {
  if (!metric) return <Kpi label="—" value="—" />;
  const delta = metric.delta_pct;
  const Icon = delta == null || Math.abs(delta) < 0.5 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card size="sm" className="gap-1">
      <CardHeader>
        <CardTitle className="text-xs font-normal text-muted-foreground">{metric.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{metric.display}</div>
        <div className={cn("mt-1.5 flex items-center gap-1 text-xs", STATUS_TEXT[metric.status])}>
          <Icon className="size-3.5" />
          {delta == null ? (
            <span className="text-muted-foreground">no comparison</span>
          ) : (
            <span>
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}% <span className="text-muted-foreground">vs {metric.compare_label}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Status;
}) {
  return (
    <Card size="sm" className="gap-1">
      <CardHeader>
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold leading-none tracking-tight tabular-nums", tone && STATUS_TEXT[tone])}>
          {value}
        </div>
        {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

// ── Charts ─────────────────────────────────────────────────────────────────

export interface Series {
  key: string;
  name: string;
  kind: "area" | "line";
  axis: "left" | "right";
  color: string;
}

/** Two-axis trend chart (e.g. orders as area, sales as line). */
export function TrendChart({
  data,
  xKey,
  xFormat,
  series,
  leftFormat,
  rightFormat,
  valueFormat,
  height = 240,
  leftDomain,
  rightDomain,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  xFormat?: (v: string) => string;
  series: Series[];
  leftFormat?: (v: number) => string;
  rightFormat?: (v: number) => string;
  valueFormat?: (key: string | undefined, v: number) => string;
  height?: number;
  leftDomain?: [number, number];
  rightDomain?: [number, number];
}) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis yAxisId="left" tickLine={false} axisLine={false} width={72} tickFormatter={leftFormat} domain={leftDomain} />
          {hasRight ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={rightFormat}
              domain={rightDomain}
            />
          ) : null}
          <Tooltip
            labelFormatter={(v) => (xFormat ? xFormat(String(v)) : String(v))}
            content={<ChartTooltip format={valueFormat} />}
          />
          {series.map((s) =>
            s.kind === "area" ? (
              <Area
                key={s.key}
                yAxisId={s.axis}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.14}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={s.key}
                yAxisId={s.axis}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={1.5}
                isAnimationActive={false}
                dot={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Actual history (solid area) followed by a forecast (dashed line) with a shaded range. */
export function ForecastChart({
  history,
  forecast,
  xFormat,
  valueFormat,
  height = 260,
}: {
  history: { at: string; value: number }[];
  forecast: { at: string; value: number; low: number; high: number }[];
  xFormat: (v: string) => string;
  valueFormat: (v: number) => string;
  height?: number;
}) {
  const rows: Record<string, unknown>[] = [
    ...history.map((h, i) => ({
      at: h.at,
      actual: h.value,
      // join the forecast line to the last actual point
      ...(i === history.length - 1 ? { forecast: h.value, low: h.value, band: 0 } : {}),
    })),
    ...forecast.map((f) => ({ at: f.at, forecast: f.value, low: f.low, band: f.high - f.low })),
  ];
  const max = Math.max(...forecast.map((f) => f.high), ...history.map((h) => h.value));
  // Round the axis top up to a tidy number (e.g. 4,862 -> 5,000).
  const step = 10 ** Math.floor(Math.log10(max * 1.1)) / 2;
  const top = Math.ceil((max * 1.1) / step) * step;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="at" tickFormatter={xFormat} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={valueFormat} domain={[0, top]} />
          <Tooltip
            content={({ active, payload, label }) => {
              const row = payload?.[0]?.payload as Record<string, number> | undefined;
              if (!active || !row) return null;
              const isForecast = row.actual === undefined;
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 text-muted-foreground">{xFormat(String(label))}</div>
                  {isForecast ? (
                    <>
                      <div className="tabular-nums">Forecast {valueFormat(row.forecast)}</div>
                      <div className="tabular-nums text-muted-foreground">
                        Range {valueFormat(row.low)} – {valueFormat(row.low + row.band)}
                      </div>
                    </>
                  ) : (
                    <div className="tabular-nums">Actual {valueFormat(row.actual)}</div>
                  )}
                </div>
              );
            }}
          />
          <Area dataKey="low" stackId="range" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" name="Range low" />
          <Area dataKey="band" stackId="range" stroke="none" fill="var(--chart-3)" fillOpacity={0.18} isAnimationActive={false} name="Likely range" />
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.14}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            name="Forecast"
            stroke="var(--chart-3)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={{ r: 2.5 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bar chart: one bar per series for each category. */
export function Bars({
  data,
  xKey,
  bars,
  format,
  height = 220,
  xInterval = 0,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: { key: string; name: string; color: string }[];
  format?: (v: number) => string;
  height?: number;
  /** Labels to skip between shown x-axis labels (0 = show every label). */
  xInterval?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} interval={xInterval} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={format} />
          <Tooltip content={<ChartTooltip format={(_, v) => (format ? format(v) : String(v))} />} />
          {bars.map((b) => (
            <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal share bars (label · bar · value). */
export function BarList({
  rows,
  format,
}: {
  rows: { label: string; value: number; tone?: Status }[];
  format: (v: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(3rem,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate">{r.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                r.tone === "bad" ? "bg-destructive" : r.tone === "watch" ? "bg-chart-3" : "bg-chart-1",
              )}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="text-right tabular-nums text-muted-foreground">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  good: { label: "Good", className: "bg-chart-2/15 text-chart-2" },
  watch: { label: "Watch", className: "bg-chart-3/15 text-chart-3" },
  bad: { label: "Needs help", className: "bg-destructive/12 text-destructive" },
  unknown: { label: "—", className: "bg-secondary text-secondary-foreground" },
  HIGH: { label: "High", className: "bg-destructive/12 text-destructive" },
  MEDIUM: { label: "Medium", className: "bg-chart-3/15 text-chart-3" },
  LOW: { label: "Low", className: "bg-secondary text-secondary-foreground" },
  PENDING: { label: "Waiting", className: "bg-chart-3/15 text-chart-3" },
  APPROVED: { label: "Approved", className: "bg-chart-1/15 text-chart-1" },
  EXECUTED: { label: "Done", className: "bg-chart-2/15 text-chart-2" },
  REJECTED: { label: "Rejected", className: "bg-secondary text-secondary-foreground" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.unknown;
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium", s.className)}>
      {label ?? s.label}
    </span>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────

export function DataTable({
  head,
  rows,
  minWidth = 560,
  onRowClick,
  selectedIndex,
}: {
  head: { label: string; align?: "left" | "right" }[];
  rows: ReactNode[][];
  minWidth?: number;
  onRowClick?: (index: number) => void;
  selectedIndex?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-border/60 text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h.label} className={cn("py-2 pr-3 font-normal last:pr-0", h.align === "right" ? "text-right" : "text-left")}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((cells, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && onRowClick(i) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-selected={onRowClick ? selectedIndex === i : undefined}
              className={cn(
                "border-b border-border/40 last:border-0",
                onRowClick && "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selectedIndex === i && "bg-muted",
              )}
            >
              {cells.map((c, j) => (
                <td key={j} className={cn("py-2 pr-3 last:pr-0", head[j]?.align === "right" && "text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
