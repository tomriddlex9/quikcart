"use client";

import { useState } from "react";
import { Check, CircleSlash, UserRound } from "lucide-react";
import { apiPostJson } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Proposal } from "@/lib/types";
import { Pill } from "./pill";

export const PROPOSAL_STATUS_TONE: Record<string, "amber" | "teal" | "red" | "green" | "neutral"> = {
  PENDING: "amber",
  APPROVED: "teal",
  REJECTED: "red",
  EXECUTED: "green",
  FAILED: "red",
};

function scopeSummary(scope: Proposal["entity_scope"]): string {
  const parts: string[] = [];
  if (typeof scope.store_id === "number") parts.push(`store ${scope.store_id}`);
  if (typeof scope.product_id === "number") parts.push(`product ${scope.product_id}`);
  if (typeof scope.quantity === "number") parts.push(`qty ${scope.quantity}`);
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(scope);
}

/**
 * Compact proposal card with inline approve/reject. Used in the agent rail and
 * inside chat answers. Actions hit the proposals API directly; the parent is
 * notified via onChanged so it can refresh its list.
 */
export function ProposalCard({
  proposal,
  demo,
  onChanged,
}: {
  proposal: Proposal;
  demo: boolean;
  onChanged?: () => void;
}) {
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  const actionable = proposal.status === "PENDING";

  async function act(action: "approve" | "reject") {
    const name = approver.trim();
    if (!name) {
      setFeedback({ tone: "red", text: "Enter your name first — approvals are audited." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await apiPostJson<Proposal>(
      `/api/v1/proposals/${proposal.proposal_id}/${action}`,
      action === "approve" ? { approver: name } : { approver: name, reason: "rejected from console" },
    );
    setBusy(false);
    if (!result.ok) {
      setFeedback({
        tone: "red",
        text:
          result.status === 0
            ? "API unreachable — nothing was approved."
            : `Action failed: ${result.detail}`,
      });
      return;
    }
    setFeedback({ tone: "green", text: action === "approve" ? "Approved — executor will run." : "Rejected." });
    onChanged?.();
  }

  return (
    <div className="border border-line-soft bg-ink-2 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={PROPOSAL_STATUS_TONE[proposal.status] ?? "neutral"}>{proposal.status}</Pill>
        <span className="text-[10.5px] text-faint">
          #{proposal.proposal_id} · {proposal.proposal_type}
        </span>
        {demo ? <Pill tone="amber">demo</Pill> : null}
      </div>
      <div className="mt-2 text-[12px] text-paper-dim">{proposal.recommended_action}</div>
      <div className="mt-1 text-[10.5px] text-faint">{scopeSummary(proposal.entity_scope)}</div>
      {proposal.created_at ? (
        <div className="mt-0.5 text-[10px] text-faint">{formatDateTime(proposal.created_at)}</div>
      ) : null}

      {actionable ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <UserRound
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              strokeWidth={1.75}
            />
            <input
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              placeholder="approver name"
              aria-label="Approver name"
              className="w-full rounded-xs border border-line bg-panel px-7 py-1.5 text-[12px] text-paper placeholder:text-faint focus:border-amber focus:outline-none"
            />
          </div>
          <button
            onClick={() => void act("approve")}
            disabled={busy}
            className="flex items-center gap-1 rounded-xs border border-teal-dim/70 bg-teal/10 px-2.5 py-1.5 text-[11.5px] text-teal transition-colors hover:bg-teal/20 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} /> approve
          </button>
          <button
            onClick={() => void act("reject")}
            disabled={busy}
            className="flex items-center gap-1 rounded-xs border border-red-dim/70 bg-red/10 px-2.5 py-1.5 text-[11.5px] text-red transition-colors hover:bg-red/20 disabled:opacity-50"
          >
            <CircleSlash className="h-3.5 w-3.5" strokeWidth={2} /> reject
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`mt-2 text-[11px] ${feedback.tone === "red" ? "text-red" : "text-green"}`}
          role="status"
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
