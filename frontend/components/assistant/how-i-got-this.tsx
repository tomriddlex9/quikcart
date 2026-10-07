import type { Provenance } from "@/lib/assistant/types";

/** Plain-language names for the checks the assistant ran. Unknown names fall back to words. */
function toolLabel(name: string): string {
  return name.replace(/_/g, " ").trim();
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Collapsed-by-default disclosure explaining where an answer came from. */
export function HowIGotThis({
  provenance,
  tools = [],
}: {
  provenance: Provenance | null;
  tools?: string[];
}) {
  if (!provenance && tools.length === 0) return null;
  const sources = provenance?.refs.length ?? 0;
  const uniqueTools = Array.from(new Set(tools));
  const caveats: string[] = [];
  if (provenance?.cards_only) {
    caveats.push("I could not confirm the figures in my written answer, so I am only showing the verified cards.");
  } else if (provenance?.repaired) {
    caveats.push("I left out a sentence I could not back up with your data.");
  }
  if (provenance && provenance.dropped_cards > 0) {
    caveats.push(`${plural(provenance.dropped_cards, "card was", "cards were")} left out because the data was not available.`);
  }

  return (
    <details className="group rounded-lg border border-border bg-card/60 text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground hover:text-foreground">
        How I got this
      </summary>
      <div className="space-y-1.5 border-t border-border px-3 py-2 text-muted-foreground">
        <p>
          Every number comes straight from your store data. I do not estimate or make up figures.
          {sources > 0 ? ` This answer uses ${plural(sources, "source", "sources")}.` : ""}
        </p>
        {uniqueTools.length > 0 ? (
          <p>
            What I looked at: <span className="text-foreground">{uniqueTools.map(toolLabel).join(", ")}</span>.
          </p>
        ) : null}
        {caveats.map((c) => (
          <p key={c}>{c}</p>
        ))}
      </div>
    </details>
  );
}
