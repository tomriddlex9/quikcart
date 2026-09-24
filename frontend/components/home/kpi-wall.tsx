"use client";

import type { ReactNode } from "react";
import { KpiCard } from "@/components/kpi-card";
import { Skeleton } from "@/components/states";
import { visibleFor, type TeamLens } from "./team-lens";

export type KpiTone = "default" | "warn" | "critical";

export interface HomeKpiItem {
  id: string;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: KpiTone;
  teams: TeamLens[];
}

const TONE_CLASS: Record<KpiTone, string> = {
  default: "",
  warn: "border-l-2 border-l-chart-3",
  critical: "border-l-2 border-l-destructive",
};

export function KpiWall({
  items,
  team,
  loading,
}: {
  items: HomeKpiItem[];
  team: TeamLens;
  loading: boolean;
}) {
  const visible = items.filter((item) => visibleFor(team, item.teams));

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: Math.max(6, visible.length || 12) }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {visible.map((item) => (
        <div key={item.id} className={item.tone && item.tone !== "default" ? TONE_CLASS[item.tone] : undefined}>
          <KpiCard label={item.label} value={item.value} hint={item.hint} />
        </div>
      ))}
    </div>
  );
}
