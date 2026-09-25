"use client";

import { useState } from "react";
import { Check, CircleSlash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      action === "approve"
        ? { approver: name }
        : { approver: name, reason: "rejected from console" },
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
    setFeedback({
      tone: "green",
      text: action === "approve" ? "Approved — executor will run." : "Rejected.",
    });
    onChanged?.();
  }

  return (
    <div className="rounded-lg border border-border px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={PROPOSAL_STATUS_TONE[proposal.status] ?? "neutral"}>{proposal.status}</Pill>
        <span className="text-xs text-muted-foreground">
          #{proposal.proposal_id} · {proposal.proposal_type}
        </span>
        {demo ? <Pill tone="amber">demo</Pill> : null}
      </div>
      <div className="mt-2 text-sm">{proposal.recommended_action}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {scopeSummary(proposal.entity_scope)}
        {proposal.created_at ? ` · ${formatDateTime(proposal.created_at)}` : ""}
      </div>

      {actionable ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="approver name"
            aria-label="Approver name"
            className="h-7 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void act("approve")}
            disabled={busy}
            className="text-chart-2"
          >
            <Check strokeWidth={2} /> approve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void act("reject")}
            disabled={busy}
            className="text-destructive"
          >
            <CircleSlash strokeWidth={2} /> reject
          </Button>
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`mt-2 text-xs ${
            feedback.tone === "red" ? "text-destructive" : "text-chart-2"
          }`}
          role="status"
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
