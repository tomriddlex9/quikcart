"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useBusiness } from "@/lib/business/business-context";
import { JOURNEYS } from "@/lib/business/demo-business";
import { readJourneyProgress } from "@/lib/business/journeys";

/** "Pick up where you left off" for a guided tour that was started but not finished. */
export function ResumeJourneyBanner() {
  const { prefs } = useBusiness();
  const [pending, setPending] = useState<{ id: string; step: number } | null>(null);

  useEffect(() => {
    const progress = readJourneyProgress();
    const entry = Object.entries(progress).find(
      ([id, step]) => id in JOURNEYS && step > 1 && !prefs.completed_journeys.includes(id),
    );
    setPending(entry ? { id: entry[0], step: entry[1] } : null);
  }, [prefs.completed_journeys]);

  if (!pending) return null;
  const journey = JOURNEYS[pending.id].summary;
  return (
    <aside
      aria-label="Resume your tour"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm"
    >
      <span>
        You were part-way through <strong>{journey.title}</strong> (step {pending.step} of {journey.step_count}).
      </span>
      <Link
        href={`/b/learn/${pending.id}?step=${pending.step}`}
        className="inline-flex items-center gap-1 font-medium hover:underline"
      >
        Resume <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </aside>
  );
}
