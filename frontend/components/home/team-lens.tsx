"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrefs, type TeamLens } from "@/lib/prefs";

export type { TeamLens };

const HINTS: Record<TeamLens, string> = {
  ops: "Floor operations — orders, delivery, stock",
  data: "Revenue, store mix, catalog health",
  ml: "Forecasts, anomalies, model drift",
  support: "Tickets, cancellations, late deliveries",
  exec: "Cross-cutting summary",
};

export const TEAM_LENSES: Array<{ value: TeamLens; label: string; hint: string }> = (
  Object.keys(HINTS) as TeamLens[]
).map((value) => ({ value, label: value, hint: HINTS[value] }));

/**
 * Team lens for the home command center. Backed by the shared `@/lib/prefs`
 * preferences store (`usePrefs().prefs.team`) so switching the lens here stays
 * in sync with the preferences sheet in the header, and persists the same way
 * (localStorage `qc_prefs_v1`).
 */
export function useTeamLens(): [TeamLens, (team: TeamLens) => void] {
  const { prefs, setPrefs } = usePrefs();
  return [prefs.team, (team) => setPrefs({ team })];
}

export function TeamLensTabs({
  team,
  onChange,
}: {
  team: TeamLens;
  onChange: (team: TeamLens) => void;
}) {
  const active = TEAM_LENSES.find((t) => t.value === team);
  return (
    <div className="flex flex-col gap-1.5">
      <Tabs value={team} onValueChange={(value) => onChange(value as TeamLens)}>
        <TabsList variant="line">
          {TEAM_LENSES.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {active ? <p className="text-[11px] text-muted-foreground">{active.hint}</p> : null}
    </div>
  );
}

/** True when an item tagged with `teams` should render for the active team lens. */
export function visibleFor(team: TeamLens, teams: TeamLens[]): boolean {
  return team === "exec" || teams.includes(team);
}
