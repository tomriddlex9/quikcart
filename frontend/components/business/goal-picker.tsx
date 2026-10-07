import { cn } from "@/lib/utils";

export interface Goal {
  id: string;
  label: string;
  blurb: string;
  /** Metric keys this goal puts on the Today page. */
  metrics: string[];
}

export const GOALS: Goal[] = [
  { id: "sales", label: "Grow sales", blurb: "Sales, orders and the average basket", metrics: ["sales_gmv", "orders", "average_basket"] },
  { id: "delivery", label: "Deliver on time", blurb: "On-time rate and delivery time", metrics: ["on_time_rate", "avg_delivery_minutes"] },
  { id: "stock", label: "Keep shelves stocked", blurb: "Products about to run out", metrics: ["stockout_risk_count"] },
  { id: "customers", label: "Know my customers", blurb: "Who orders and who comes back", metrics: ["active_customers", "repeat_rate"] },
];

export const MAX_GOAL_METRICS = 4;

/** The Today numbers a set of goals asks for: each goal's lead number first, capped at four. */
export function metricsForGoals(goalIds: string[], goals: Goal[] = GOALS): string[] {
  const picked = goals.filter((g) => goalIds.includes(g.id));
  const out: string[] = [];
  const longest = Math.max(0, ...picked.map((g) => g.metrics.length));
  for (let i = 0; i < longest; i++) {
    for (const g of picked) {
      const key = g.metrics[i];
      if (key && !out.includes(key)) out.push(key);
    }
  }
  return out.slice(0, MAX_GOAL_METRICS);
}

export function GoalPicker({
  value,
  onChange,
  goals = GOALS,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  goals?: Goal[];
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset>
      <legend className="sr-only">What matters most</legend>
      <ul className="grid gap-2 sm:grid-cols-2">
        {goals.map((g) => (
          <li key={g.id}>
            <label
              className={cn(
                "flex h-full cursor-pointer items-start gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm",
                value.includes(g.id) ? "border-foreground" : "border-border",
              )}
            >
              <input type="checkbox" className="mt-1" checked={value.includes(g.id)} onChange={() => toggle(g.id)} />
              <span>
                <span className="block font-medium">{g.label}</span>
                <span className="block text-xs text-muted-foreground">{g.blurb}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
