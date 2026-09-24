"use client";

import { useEffect, useState } from "react";
import { ApiBanner } from "@/components/api-banner";
import { Pill } from "@/components/pill";
import { ProposalCard, PROPOSAL_STATUS_TONE } from "@/components/proposal-card";
import { EmptyState, Loading } from "@/components/states";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    return <p className="text-xs text-muted-foreground">Audit trail unavailable ({error}).</p>;
  }
  if (entries === null) return <Loading label="Loading audit trail…" />;
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No transitions recorded yet.</p>;
  }
  return (
    <ol className="space-y-2.5">
      {entries.map((a) => (
        <li key={a.audit_id} className="relative pl-4">
          <span className="absolute left-0 top-1.5 size-1.5 rounded-full bg-chart-2" />
          <div className="text-sm">
            <span className="text-muted-foreground">{a.from_status ?? "—"}</span>
            {" → "}
            {a.to_status}
            {" · "}
            {a.actor}
          </div>
          {a.detail ? <div className="text-xs text-muted-foreground">{a.detail}</div> : null}
          <div className="text-xs text-muted-foreground">
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

  const rows = (all.data ?? []).filter((p) => filter === "ALL" || p.status === filter);
  const open =
    openId !== null ? (all.data ?? []).find((p) => p.proposal_id === openId) ?? null : null;

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

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as ProposalStatus | "ALL")}
        className="mb-4"
      >
        <TabsList variant="line">
          {counts.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
              <span className="text-xs tabular-nums text-muted-foreground">{f.count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {all.data === null ? (
        <Loading label="Loading proposals…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === "ALL" ? "No proposals yet" : `No ${filter.toLowerCase()} proposals`}
          hint={
            filter === "ALL"
              ? "Proposals are filed by the assistant or via POST /api/v1/proposals. The agent proposes; only a human approves."
              : "Try another status filter."
          }
        />
      ) : (
        <Card size="sm" className="py-0">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4 text-xs text-muted-foreground">id</TableHead>
                <TableHead className="text-xs text-muted-foreground">type</TableHead>
                <TableHead className="text-xs text-muted-foreground">scope</TableHead>
                <TableHead className="text-xs text-muted-foreground">action</TableHead>
                <TableHead className="text-xs text-muted-foreground">validation</TableHead>
                <TableHead className="text-xs text-muted-foreground">status</TableHead>
                <TableHead className="text-xs text-muted-foreground">created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={p.proposal_id}
                  onClick={() => setOpenId(p.proposal_id)}
                  className="cursor-pointer"
                >
                  <TableCell className="pl-4 text-muted-foreground">#{p.proposal_id}</TableCell>
                  <TableCell>{p.proposal_type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {scopeText(p.entity_scope)}
                  </TableCell>
                  <TableCell className="max-w-[340px] truncate">{p.recommended_action}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.validation_status ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Pill tone={PROPOSAL_STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Pill>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.created_at ? formatDateTime(p.created_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Approval is the only execution path: the API re-validates the stored proposal, then applies
        inventory changes in one PostgreSQL transaction with a movement row and an audit trail.
      </p>

      <Sheet
        open={open !== null}
        onOpenChange={(value) => {
          if (!value) setOpenId(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  Proposal #{open.proposal_id}
                  <Pill tone={PROPOSAL_STATUS_TONE[open.status] ?? "neutral"}>{open.status}</Pill>
                </SheetTitle>
                <SheetDescription className="text-xs">
                  {open.proposal_type} · filed{" "}
                  {open.created_at ? formatDateTime(open.created_at) : "—"}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-6">
                <ProposalCard
                  proposal={open}
                  demo={demo}
                  onChanged={() => {
                    all.reload();
                    setAuditRefresh((n) => n + 1);
                  }}
                />

                <div>
                  <h3 className="mb-1.5 text-xs text-muted-foreground">reasoning</h3>
                  <p className="text-sm">{open.reason}</p>
                </div>

                {open.evidence && open.evidence.length > 0 ? (
                  <div>
                    <h3 className="mb-1.5 text-xs text-muted-foreground">evidence</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {open.evidence.map((e, i) => (
                        <li key={i}>· {e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-border px-3 py-2">
                    <div className="text-xs text-muted-foreground">approved by</div>
                    <div className="mt-0.5">{open.approved_by ?? "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    <div className="text-xs text-muted-foreground">executed at</div>
                    <div className="mt-0.5">
                      {open.executed_at ? formatDateTime(open.executed_at) : "—"}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs text-muted-foreground">audit trail</h3>
                  <AuditTrail proposalId={open.proposal_id} refreshKey={auditRefresh} />
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
