import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Simulator",
};

export default function SimPage() {
  return (
    <>
      <PageHeader
        title="Simulator"
        description="Start/stop the demo order simulator and tune its intensity from the floating control dock in the corner of every page — this page is just a reminder of what it controls."
      />
      <div className="rounded-xl border border-border bg-secondary/25 p-6 text-sm text-muted-foreground">
        <p>
          The simulator dock (bottom-right of the screen) lets the ops team start or stop the
          live order generator and adjust orders/min, cancel rate, payment failure rate,
          inventory churn, and burst factor without touching SQL or the shell.
        </p>
        <p className="mt-3">
          It reads and writes a small bounded state document via{" "}
          <code className="text-xs">GET/POST /api/v1/sim/status</code>,{" "}
          <code className="text-xs">/api/v1/sim/start</code>,{" "}
          <code className="text-xs">/api/v1/sim/stop</code>, and{" "}
          <code className="text-xs">/api/v1/sim/config</code>.
        </p>
      </div>
    </>
  );
}
