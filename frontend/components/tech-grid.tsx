"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Pill } from "@/components/pill";
import { EmptyState } from "@/components/states";
import { TECH_STACK } from "@/lib/tech-stack";

export function TechGrid() {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TECH_STACK;
    return TECH_STACK.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.role.toLowerCase().includes(q) ||
        t.version.toLowerCase().includes(q) ||
        `phase ${t.phase}`.includes(q) ||
        t.layer.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div>
      <div className="mb-4 flex max-w-sm items-center gap-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, role, version or phase"
          aria-label="Filter technologies"
          className="w-full rounded-xs border border-line bg-panel px-3 py-2 text-[12px] text-paper placeholder:text-faint focus:border-amber focus:outline-none"
        />
        <span className="shrink-0 text-[10.5px] text-faint">
          {entries.length}/{TECH_STACK.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No technologies match that filter"
          hint="Try a version number like “4.2”, a layer like “storage”, or a phase like “phase 12”."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((t) => (
            <div key={`${t.name}-${t.phase}`} className="panel panel-hover px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-[15.5px] font-semibold leading-tight tracking-tight text-paper">
                  {t.name}
                </h3>
                <span className="shrink-0 text-[11px] text-amber">{t.version}</span>
              </div>
              <p className="mt-1.5 min-h-[2.4em] text-[11.5px] leading-relaxed text-muted">
                {t.role}
              </p>
              <div className="mt-2.5 flex items-center gap-1.5">
                <Pill>phase {t.phase}</Pill>
                <Pill>{t.layer}</Pill>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[10.5px] text-faint">
        Pinned versions and activation phases are sourced from{" "}
        <code>kit/01_ARCHITECTURE_AND_TECH_STACK.md</code> §4; exact versions are an
        implementation baseline, not an upgrade prompt.
      </p>
    </div>
  );
}
