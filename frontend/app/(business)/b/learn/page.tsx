"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BusinessPage } from "@/components/business/business-page";
import { JourneyCard } from "@/components/business/journey-card";
import { useBusiness } from "@/lib/business/business-context";
import { readJourneyProgress } from "@/lib/business/journeys";
import type { JourneySummary } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

export default function LearnPage() {
  const { prefs } = useBusiness();
  const journeys = useBusinessData<JourneySummary[]>("/journeys");
  const [progress, setProgress] = useState<Record<string, number>>({});
  useEffect(() => setProgress(readJourneyProgress()), []);


  return (
    <BusinessPage
      title="Learn"
      description="Short guided tours, and a plain-English guide to every number."
      query={journeys}
    >
      {(list) => (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Guided tours</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {list.map((j) => (
                <JourneyCard
                  key={j.id}
                  journey={j}
                  completed={prefs.completed_journeys.includes(j.id)}
                  resumeStep={progress[j.id] ?? null}
                />
              ))}
            </div>
          </section>

          <section className="space-y-2" aria-label="Glossary">
            <h2 className="text-sm font-medium">What the numbers mean</h2>
            <p className="text-[13px] text-muted-foreground">
              Every number in the console, explained in plain English.
            </p>
            <Link href="/b/learn/glossary" className="text-sm font-medium hover:underline">
              Open the glossary
            </Link>
          </section>
        </div>
      )}
    </BusinessPage>
  );
}
