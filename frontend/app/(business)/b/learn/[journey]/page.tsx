"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BusinessPage } from "@/components/business/business-page";
import { useMarkChecklist } from "@/components/business/getting-started-checklist";
import { JourneyPanel } from "@/components/business/journey-panel";
import { useBusiness } from "@/lib/business/business-context";
import { JOURNEYS, journeyStepFixture } from "@/lib/business/demo-business";
import { normalizeJourneyLink, readJourneyProgress, saveJourneyProgress } from "@/lib/business/journeys";
import type { JourneyStep, MetricsCatalogResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

function JourneyPlayer() {
  const router = useRouter();
  const params = useParams<{ journey: string }>();
  const search = useSearchParams();
  const id = (params?.journey ?? "").toUpperCase();
  const known = id in JOURNEYS;
  const { prefs, updatePrefs, ready } = useBusiness();
  const mark = useMarkChecklist();
  const total = known ? JOURNEYS[id].steps.length : 0;

  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!known) return;
    const fromUrl = Number(search.get("step"));
    const saved = readJourneyProgress()[id];
    const start = Number.isInteger(fromUrl) && fromUrl >= 1 ? fromUrl : (saved ?? 1);
    setN(Math.min(Math.max(start, 1), total));
  }, [id, known, search, total]);

  const query = useBusinessData<JourneyStep>(known && n !== null ? `/journeys/${id}/steps/${n}` : null);
  const metrics = useBusinessData<MetricsCatalogResponse>("/metrics");
  const glossary = useMemo(
    () => Object.fromEntries((metrics.data?.metrics ?? []).map((m) => [m.key, m.label])),
    [metrics.data],
  );

  // The API may return thin steps; fill any gaps from the bundled copy.
  const step = useMemo<JourneyStep | null>(() => {
    if (!query.data || n === null) return null;
    const fallback = journeyStepFixture(id, n);
    return {
      ...query.data,
      title: query.data.title || fallback?.title || `Step ${n}`,
      body: query.data.body || fallback?.body || "",
      link: normalizeJourneyLink(query.data.link ?? fallback?.link),
      total: query.data.total || total,
    };
  }, [query.data, n, id, total]);

  useEffect(() => {
    if (known && n !== null) saveJourneyProgress(id, n);
  }, [id, known, n]);

  if (!known) {
    return (
      <BusinessPage title="Tour not found">
        <p className="text-sm text-muted-foreground">
          We don't have a tour called “{params?.journey}”.{" "}
          <Link href="/b/learn" className="underline underline-offset-2">
            See all tours
          </Link>
        </p>
      </BusinessPage>
    );
  }

  const go = (next: number | null) => {
    if (next !== null) setN(next);
  };

  const finish = async () => {
    saveJourneyProgress(id, null);
    if (ready && !prefs.completed_journeys.includes(id)) {
      await updatePrefs({ completed_journeys: [...prefs.completed_journeys, id] });
    }
    if (id === "A") mark("take_tour");
    router.push("/b/learn");
  };

  return (
    <BusinessPage
      title={JOURNEYS[id].summary.title}
      description={JOURNEYS[id].summary.summary}
      query={{ ...query, loading: query.loading || n === null, data: step }}
      actions={
        <Link href="/b/learn" className="text-xs text-muted-foreground hover:text-foreground">
          All tours
        </Link>
      }
    >
      {(current) => (
        <JourneyPanel
          step={current}
          glossary={glossary}
          onBack={() => go(current.prev_n)}
          onNext={() => go(current.next_n)}
          onFinish={() => void finish()}
        />
      )}
    </BusinessPage>
  );
}

export default function JourneyPage() {
  return (
    <Suspense>
      <JourneyPlayer />
    </Suspense>
  );
}
