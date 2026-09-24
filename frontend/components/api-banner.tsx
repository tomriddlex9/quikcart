"use client";

import { TriangleAlert } from "lucide-react";
import { API_BASE, type ApiMode } from "@/lib/api";

/**
 * Honest-mode banner. Rendered by every data page whenever the API is not
 * answering: demo data is always labeled as such, never passed off as live.
 */
export function ApiBanner({ mode, error }: { mode: ApiMode; error?: string | null }) {
  if (mode === "live") return null;
  return (
    <div
      role="status"
      className="mb-5 flex items-start gap-2.5 border border-amber-dim/60 bg-amber/10 px-3.5 py-2.5 text-[12px] text-amber"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <div>
        <span className="font-semibold">API offline — demo data.</span> The QuickCart
        FastAPI service at <code className="text-amber/90">{API_BASE}</code> did not
        answer{error ? ` (${error})` : ""}. Everything on this page is a clearly
        synthetic preview until you start the API, e.g.{" "}
        <code className="text-amber/90">uv run python -m quickcart.api</code>.
      </div>
    </div>
  );
}
