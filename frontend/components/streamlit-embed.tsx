"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MonitorCog } from "lucide-react";

const STREAMLIT_URL =
  process.env.NEXT_PUBLIC_STREAMLIT_URL ?? "http://localhost:8501";

/**
 * Streamlit refuses cross-origin framing control? No — Streamlit sets
 * X-Frame-Options: DENY by default, which blocks embedding entirely.
 * We still ship this page as the dedicated home for the Streamlit dashboard:
 * it probes whether the server is answering and gives a one-click way over.
 */
export function StreamlitEmbed() {
  const [state, setState] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(STREAMLIT_URL, { mode: "no-cors", cache: "no-store" })
      .then(() => {
        if (!cancelled) setState("up");
      })
      .catch(() => {
        if (!cancelled) setState("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-paper-dim">
            Streamlit operations dashboard
          </h2>
          <p className="mt-1 max-w-[70ch] text-[11.5px] leading-relaxed text-muted">
            Streamlit sends <code>X-Frame-Options: DENY</code>, so it cannot be embedded in an
            iframe. This page stays as its home in the console — open it in a tab with the
            button below.
          </p>
        </div>
        <a
          href={STREAMLIT_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-xs border border-amber-dim/70 bg-amber/10 px-3 py-2 text-[12px] text-amber transition-colors hover:bg-amber/20"
        >
          open dashboard <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
        </a>
      </div>

      <div className="mt-4 border border-line-soft px-4 py-6 text-center">
        {state === "checking" ? (
          <div className="flex items-center justify-center gap-2 text-[12px] text-muted">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-teal" />
            checking {STREAMLIT_URL}…
          </div>
        ) : state === "up" ? (
          <div className="text-[12px] text-teal">
            Streamlit is answering — the dashboard is ready in a new tab.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-[12px] text-paper-dim">
            <MonitorCog className="h-6 w-6 text-faint" strokeWidth={1.5} />
            <div>
              Nothing is listening at{" "}
              <code className="text-amber/90">{STREAMLIT_URL}</code>. Start it with{" "}
              <code className="text-amber/90">make dashboard-up</code>, then come back.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
