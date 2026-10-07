import { Sunrise } from "lucide-react";
import { greeting } from "@/lib/business/format";
import type { Meta } from "@/lib/business/types";

export function MorningBriefing({
  name,
  summary,
  meta,
  now,
}: {
  name: string;
  summary: string;
  meta?: Meta;
  now?: Date;
}) {
  return (
    <section
      aria-label="Morning briefing"
      className="rounded-xl bg-card p-5 ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Sunrise className="size-4" aria-hidden />
        Your briefing
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        {greeting(now)}, {name}.
      </h2>
      <p className="mt-1.5 max-w-[70ch] text-[15px] leading-relaxed text-foreground/90">{summary}</p>
      {meta?.note ? <p className="mt-2 text-xs text-muted-foreground">{meta.note}</p> : null}
    </section>
  );
}
