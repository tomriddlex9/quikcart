"use client";

import type { ThinkingStep } from "@/lib/agent-stream";
import { cn } from "@/lib/utils";
import { STAGE_LABEL } from "./bot-catalog";

export function ThinkingTrail({
  steps,
  pending,
  accent,
}: {
  steps: ThinkingStep[];
  pending?: boolean;
  accent?: string;
}) {
  if (steps.length === 0 && !pending) return null;
  return (
    <ol
      className="w-full space-y-1 rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-2 text-[11px]"
      aria-label="Thinking steps"
    >
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li
            key={step.id}
            className={cn(
              "flex gap-2",
              last && pending ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className="mt-1 size-1.5 shrink-0 rounded-full"
              style={{
                background: last && pending ? (accent ?? "currentColor") : "currentColor",
                opacity: last && pending ? 1 : 0.45,
              }}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="font-medium">
                {step.stage === "tool"
                  ? "Tool"
                  : (STAGE_LABEL[step.stage] ?? step.label)}
              </span>
              {step.detail ? (
                <span className="block truncate text-muted-foreground">{step.detail}</span>
              ) : null}
            </span>
          </li>
        );
      })}
      {pending ? (
        <li className="flex gap-2 text-foreground">
          <span
            className="mt-1 size-1.5 shrink-0 animate-pulse rounded-full"
            style={{ background: accent ?? "currentColor" }}
            aria-hidden
          />
          <span className="font-medium">Thinking…</span>
        </li>
      ) : null}
    </ol>
  );
}
