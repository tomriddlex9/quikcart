import { cn } from "@/lib/utils";

const PRESETS = ["07:00", "08:00", "09:00"] as const;

function pretty(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${suffix}`;
}

export function BriefingTimePicker({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Common times" className="flex flex-wrap gap-2">
        {PRESETS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={value === t}
            onClick={() => onChange(t)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[13px] transition-colors",
              value === t ? "border-foreground bg-secondary" : "border-border bg-card hover:bg-secondary/60",
            )}
          >
            {pretty(t)}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="briefing-time" className="block text-sm text-muted-foreground">
          Or pick your own time
        </label>
        <input
          id="briefing-time"
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-9 rounded-lg border border-input bg-card px-3 text-sm"
        />
      </div>
    </div>
  );
}
