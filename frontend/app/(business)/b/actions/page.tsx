"use client";

import Link from "next/link";
import { BusinessPage } from "@/components/business/business-page";
import { StatusBadge } from "@/components/business/status-badge";
import { DEMO_PROPOSALS } from "@/lib/demo";
import type { Proposal, ProposalStatus } from "@/lib/types";
import type { Status } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

const TYPE_LABEL: Record<string, string> = {
  RESTOCK: "Restock an item",
  INCIDENT: "Look into a problem",
  OPS_NOTIFICATION: "Tell a team",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  PENDING: "Waiting for a decision",
  APPROVED: "Approved",
  REJECTED: "Declined",
  EXECUTED: "Done",
  FAILED: "Did not go through",
};

const STATUS_TONE: Record<ProposalStatus, Status> = {
  PENDING: "watch",
  APPROVED: "good",
  REJECTED: "unknown",
  EXECUTED: "good",
  FAILED: "bad",
};

const demoProposals = () => DEMO_PROPOSALS;

export default function ActionsPage() {
  const query = useBusinessData<Proposal[]>("/proposals", { general: true, fixture: demoProposals });
  return (
    <BusinessPage
      title="Actions"
      description="Suggestions from the assistant. Nothing happens until a named person approves it."
      query={query}
    >
      {(items) => {
        const waiting = items.filter((p) => p.status === "PENDING");
        const rest = items.filter((p) => p.status !== "PENDING");
        return (
          <div className="space-y-6">
            <ProposalSection title={`Waiting for a decision (${waiting.length})`} items={waiting} />
            {rest.length > 0 ? <ProposalSection title="Already handled" items={rest} /> : null}
            <p className="text-xs text-muted-foreground">
              To approve or decline, open the{" "}
              <Link href="/proposals" className="underline underline-offset-2 hover:text-foreground">
                approval queue in Operations
              </Link>
              .
            </p>
          </div>
        );
      }}
    </BusinessPage>
  );
}

function ProposalSection({ title, items }: { title: string; items: Proposal[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Nothing is waiting. You're all caught up.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {items.map((p) => (
            <li key={p.proposal_id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={STATUS_TONE[p.status]} label={STATUS_LABEL[p.status]} />
                <span className="text-xs text-muted-foreground">
                  {TYPE_LABEL[p.proposal_type] ?? p.proposal_type}
                </span>
              </div>
              <p className="text-sm font-medium">{p.recommended_action}</p>
              <p className="text-[13px] text-muted-foreground">{p.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
