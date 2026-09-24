"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill } from "@/components/pill";
import { PROPOSAL_STATUS_TONE } from "@/components/proposal-card";
import { ProposalCard } from "@/components/proposal-card";
import { EmptyState, Loading } from "@/components/states";
import { apiGetJson } from "@/lib/api";
import { DEMO_PROPOSALS } from "@/lib/demo";
import { formatDateTime } from "@/lib/format";
import { useApiData } from "@/lib/use-api";
import type { AuditEntry, Proposal, ProposalStatus } from "@/lib/types";

const FILTERS: Array<{ value: ProposalStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "all" },
  { value: "PENDING", label: "pending" },
  { value: "APPROVED", label: "approved" },
  { value: "REJECTED", label: "rejected" },
  { value: "EXECUTED", label: "executed" },
  { value: "FAILED", label: "failed" },
];

function scopeText(scope: Proposal["entity_scope"]): string {
  const parts: string[] = [];
  if (typeof scope.store_id === "number") parts.push(`store ${scope.store_id}`);
  if (typeof scope.product_id === "number") parts.push(`product ${scope.product_id}`);
  if (typeof scope.quantity === "number") parts.push(`×${scope.quantity}`);
  if (typeof scope.order_id === "number") parts.push(`order ${scope.order_id}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function AuditTrail({ proposalId, refreshKey }: { proposalId: number; refreshKey: number }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    apiGetJson<AuditEntry[]>(`/api/v1/proposals/${proposalId}/audit`)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "audit unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [proposalId, refreshKey]);

  if (error) {
    return (
      <p className="text-[11px] text-faint">
        Audit trail unavailable{` (${error})`}. The API may not expose{" "}
        <code>/audit</code> yet.
      </p>
    );
  }
  if (entries === null) return <Loading label="Loading audit trail…" />;
  if (entries.length === 0) {
    return <p className="text-[11px] text-faint">No transitions recorded yet.</p>;
  }
  return (
    <ol className="space-y-2.5">
      {entries.map((a) => (
        <li key={a.audit_id} className="relative pl-4">
          <span className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-amber" />
          <div className="text-[11.5px] text-paper-dim">
            <span className="text-faint">{a.from_status ?? "—"}</span>
            {" → "}
            <span className="text-paper">{a.to_status}</span>
            {" · "}
            {a.actor}
          </div>
          {a.detail ? <div className="text-[10.5px] text-muted">{a.detail}</div> : null}
          <div className="text-[10px] text-faint">
            {formatDateTime(a.created_at)}
            {a.correlation_id ? ` · ${a.correlation_id.slice(0, 8)}…` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ProposalsBoard() {
  const [filter, setFilter] = useState<ProposalStatus | "ALL">("ALL");
  const [openId, setOpenId] = useState<number | null>(null);
  const [auditRefresh, setAuditRefresh] = useState(0);

  const all = useApiData<Proposal[]>("/api/v1/proposals", DEMO_PROPOSALS, 30_000);
  const demo = all.mode !== "live";

  const rows = (all.data ?? []).filter(
    (p) => filter === "ALL" || p.status === filter,
  );
  const open = openId !== null ? (all.data ?? []).find((p) => p.proposal_id === openId) ?? null : null;

  const close = useCallback(() => setOpenId(null), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const counts = FILTERS.map((f) => ({
    ...f,
    count:
      f.value === "ALL"
        ? (all.data ?? []).length
        : (all.data ?? []).filter((p) => p.status === f.value).length,
  }));

  return (
    <>
      {demo ? <ApiBanner mode={all.mode} error={all.error} /> : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {counts.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`rounded-xs border px-2.5 py-1 text-[11.5px] transition-colors ${
              filter === f.value
                ? "border-amber-dim/70 bg-amber/10 text-amber"
                : "border-line text-muted hover:text-paper-dim"
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-[10px] text-faint">{f.count}</span>
          </button>
        ))}
      </div>

      {all.data === null ? (
        <Loading label="Loading proposals…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            filter === "ALL"
              ? "No proposals yet"
              : `No ${filter.toLowerCase()} proposals`
          }
          hint={
            filter === "ALL"
              ? "Proposals are filed by the operations assistant (Phase 13) or created directly via POST /api/v1/proposals. The agent proposes; only a human approves."
              : "Try another status filter."
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-line-soft text-[10.5px] tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">id</th>
                <th className="px-3 py-2.5 font-medium">type</th>
                <th className="px-3 py-2.5 font-medium">scope</th>
                <th className="px-3 py-2.5 font-medium">recommended action</th>
                <th className="px-3 py-2.5 font-medium">validation</th>
                <th className="px-3 py-2.5 font-medium">status</th>
                <th className="px-3 py-2.5 font-medium">created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.proposal_id}
                  onClick={() => setOpenId(p.proposal_id)}
                  className="cursor-pointer border-b border-line-soft/60 transition-colors last:border-0 hover:bg-panel-2/60"
                >
                  <td className="px-4 py-2.5 text-faint">#{p.proposal_id}</td>
                  <td className="px-3 py-2.5 text-paper-dim">{p.proposal_type}</td>
                  <td className="px-3 py-2.5 text-muted">{scopeText(p.entity_scope)}</td>
                  <td className="max-w-[340px] truncate px-3 py-2.5 text-paper-dim">
                    {p.recommended_action}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{p.validation_status ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Pill tone={PROPOSAL_STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Pill>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {p.created_at ? formatDateTime(p.created_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
        Approvals are the only execution path: the API re-validates the stored proposal,
        then applies inventory changes in a single PostgreSQL transaction with a movement
        row and a full audit trail. Nothing here executes client-supplied payloads.
      </p>

      {/* Detail drawer */}
      {open ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Proposal ${open.proposal_id}`}>
          <button
            aria-label="Close drawer"
            onClick={close}
            className="absolute inset-0 bg-ink/70"
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-line bg-ink-2 px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-[19px] font-semibold text-paper">
                    Proposal #{open.proposal_id}
                  </h2>
                  <Pill tone={PROPOSAL_STATUS_TONE[open.status] ?? "neutral"}>{open.status}</Pill>
                </div>
                <div className="mt-1 text-[11px] text-faint">
                  {open.proposal_type} · filed {open.created_at ? formatDateTime(open.created_at) : "—"}
                </div>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="rounded-xs border border-line p-1.5 text-muted hover:text-paper"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="mt-4">
              <ProposalCard
                proposal={open}
                demo={demo}
                onChanged={() => {
                  all.reload();
                  setAuditRefresh((n) => n + 1);
                }}
              />
            </div>

            <div className="mt-5">
              <h3 className="mb-1.5 text-[10.5px] tracking-wide text-faint">reasoning</h3>
              <p className="text-[12px] leading-relaxed text-paper-dim">{open.reason}</p>
            </div>

            {open.evidence && open.evidence.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[10.5px] tracking-wide text-faint">evidence</h3>
                <ul className="space-y-1">
                  {open.evidence.map((e, i) => (
                    <li key={i} className="text-[11.5px] leading-relaxed text-muted">
                      · {e}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2 text-[11px]">
              <div className="panel px-3 py-2">
                <div className="text-faint">approved by</div>
                <div className="mt-0.5 text-paper-dim">{open.approved_by ?? "—"}</div>
              </div>
              <div className="panel px-3 py-2">
                <div className="text-faint">executed at</div>
                <div className="mt-0.5 text-paper-dim">
                  {open.executed_at ? formatDateTime(open.executed_at) : "—"}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="mb-2 text-[10.5px] tracking-wide text-faint">audit trail</h3>
              <AuditTrail proposalId={open.proposal_id} refreshKey={auditRefresh} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
