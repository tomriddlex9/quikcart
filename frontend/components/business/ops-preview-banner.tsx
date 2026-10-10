"use client";

import Link from "next/link";
import { useBusiness } from "@/lib/business/business-context";
import { DEMO_PERSONAS } from "@/lib/business/demo-business";
import { personaEntry } from "@/lib/personas";

/** Shown when a signed-in ops persona is browsing /b on sample business scope. */
export function OpsPreviewBanner() {
  const { isOpsPreview, persona, sessionPersona } = useBusiness();
  if (!isOpsPreview) return null;
  const sampleLabel =
    DEMO_PERSONAS.find((p) => p.persona === persona)?.label ?? "Business executive";
  const opsLabel = personaEntry(sessionPersona)?.label ?? sessionPersona ?? "Operations";

  return (
    <div
      role="status"
      className="border-b border-border bg-secondary/60 px-4 py-2 text-sm text-foreground"
    >
      Previewing the business view as {sampleLabel} (sample scope). You are signed in as {opsLabel}.{" "}
      <Link href="/" className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Back to Operations
      </Link>
    </div>
  );
}
