"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BusinessPage } from "@/components/business/business-page";
import type { MetricsCatalogResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

export default function GlossaryPage() {
  const query = useBusinessData<MetricsCatalogResponse>("/metrics");
  const [filter, setFilter] = useState("");

  const terms = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = query.data?.metrics ?? [];
    if (!q) return all;
    return all.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.plain_description.toLowerCase().includes(q) ||
        m.synonyms.some((s) => s.toLowerCase().includes(q)),
    );
  }, [query.data, filter]);

  return (
    <BusinessPage
      title="What the numbers mean"
      description="A plain-English guide to every number in the console."
      query={query}
      actions={
        <Link href="/b/learn" className="text-xs text-muted-foreground hover:text-foreground">
          Back to Learn
        </Link>
      }
    >
      {() => (
        <div className="space-y-3">
          <label className="sr-only" htmlFor="glossary-filter">
            Search the glossary
          </label>
          <input
            id="glossary-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search, e.g. basket"
            className="h-8 w-60 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {terms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No numbers match “{filter}”.</p>
          ) : (
            <dl className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              {terms.map((m) => (
                <div key={m.key} className="px-4 py-3">
                  <dt className="text-sm font-medium">{m.label}</dt>
                  <dd className="mt-0.5 text-[13px] text-foreground/90">{m.plain_description}</dd>
                  <dd className="mt-0.5 text-xs text-muted-foreground">How it's worked out: {m.formula_text}</dd>
                  {m.is_partial && m.partial_note ? (
                    <dd className="mt-0.5 text-xs text-status-watch">{m.partial_note}</dd>
                  ) : null}
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </BusinessPage>
  );
}
