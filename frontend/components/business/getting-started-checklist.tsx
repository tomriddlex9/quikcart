"use client";

import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useBusiness } from "@/lib/business/business-context";

export const CHECKLIST: { id: string; label: string; href: string }[] = [
  { id: "open_store", label: "Open a store to see its day hour by hour", href: "/b/stores" },
  { id: "ask_question", label: "Ask the assistant a question", href: "/b/ask" },
  { id: "take_tour", label: "Take the “Start my day” tour", href: "/b/learn/A" },
  { id: "set_briefing", label: "Choose when your briefing arrives", href: "/b/settings" },
];

/** Returns a function that ticks a checklist item once (no-ops when already done). */
export function useMarkChecklist(): (id: string) => void {
  const { prefs, updatePrefs, ready } = useBusiness();
  return useCallback(
    (id: string) => {
      if (!ready || prefs.checklist_done.includes(id)) return;
      void updatePrefs({ checklist_done: [...prefs.checklist_done, id] });
    },
    [ready, prefs.checklist_done, updatePrefs],
  );
}

export function GettingStartedChecklist() {
  const { prefs, updatePrefs, ready } = useBusiness();
  if (!ready || prefs.checklist_dismissed) return null;
  const done = CHECKLIST.filter((item) => prefs.checklist_done.includes(item.id)).length;
  return (
    <section aria-label="Getting started" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          Getting started <span className="text-muted-foreground">· {done} of {CHECKLIST.length}</span>
        </h2>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void updatePrefs({ checklist_dismissed: true })}
        >
          Hide
        </Button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {CHECKLIST.map((item) => {
          const isDone = prefs.checklist_done.includes(item.id);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-secondary/60"
              >
                {isDone ? (
                  <Check className="size-4 text-status-good" aria-hidden />
                ) : (
                  <Circle className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className={isDone ? "text-muted-foreground line-through" : undefined}>
                  {item.label}
                </span>
                <span className="sr-only">{isDone ? "(done)" : "(to do)"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
