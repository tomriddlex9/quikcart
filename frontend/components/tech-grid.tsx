"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Pill } from "@/components/pill";
import { EmptyState } from "@/components/states";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, role, version or phase"
            aria-label="Filter technologies"
            className="pl-8"
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {entries.length}/{TECH_STACK.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No technologies match that filter"
          hint="Try a version like “4.2”, a layer like “storage”, or “phase 12”."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((t) => (
            <Card key={`${t.name}-${t.phase}`} size="sm" className="gap-2">
              <CardHeader>
                <CardTitle className="text-sm">{t.name}</CardTitle>
                <CardAction>
                  <span className="font-mono text-xs text-muted-foreground">{t.version}</span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{t.role}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <Pill>phase {t.phase}</Pill>
                  <Pill>{t.layer}</Pill>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Versions are the pins in <code>pyproject.toml</code>, <code>docker-compose.yml</code> and{" "}
        <code>frontend/package.json</code>.{" "}
        <a className="underline underline-offset-3 hover:text-foreground" href="/tooling">
          Tooling
        </a>{" "}
        lists the ports and start commands.
      </p>
    </div>
  );
}
