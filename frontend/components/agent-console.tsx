"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, FileText, SendHorizonal, Wrench } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { ProposalCard } from "@/components/proposal-card";
import { EmptyState, Loading } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPostJson } from "@/lib/api";
import { DEMO_PROPOSALS } from "@/lib/demo";
import { useApiData } from "@/lib/use-api";
import type { ChatResponse, Proposal } from "@/lib/types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  evidence?: string[];
  toolTrace?: string[];
  error?: boolean;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m-${Date.now()}-${idCounter}`;
}

export function AgentConsole() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => `console-${Math.random().toString(36).slice(2, 10)}`);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pending proposals rail: live list when the API answers, labeled demo otherwise.
  const proposals = useApiData<Proposal[]>(
    "/api/v1/proposals?status=PENDING",
    DEMO_PROPOSALS.filter((p) => p.status === "PENDING"),
  );
  const pendingProposals = (proposals.data ?? []).filter((p) => p.status === "PENDING");

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
    const result = await apiPostJson<ChatResponse>("/api/v1/agent/chat", {
      message: text,
      session_id: sessionId,
    });
    setSending(false);
    if (!result.ok) {
      const unavailable = result.status === 503 || result.status === 404 || result.status === 0;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          error: true,
          text: unavailable
            ? "The assistant is not available — the LangGraph agent is not wired into the API, or the API is down. No answer was generated and nothing here is fabricated."
            : `The assistant call failed: ${result.detail}`,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          text: result.data.answer ?? "(empty answer from agent)",
          evidence: Array.isArray(result.data.evidence) ? result.data.evidence : [],
          toolTrace: Array.isArray(result.data.tool_trace) ? result.data.tool_trace : [],
        },
      ]);
    }
    // The agent may have created a proposal for this request — refresh the rail.
    proposals.reload();
  }, [input, sending, sessionId, proposals]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const demo = proposals.mode !== "live";

  return (
    <>
      <PageHeader
        title="Agent"
        description="A bounded assistant over Gold marts, ML predictions and SOP documents. It proposes changes; it never writes."
      />

      {demo ? <ApiBanner mode={proposals.mode} error={proposals.error} /> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card size="sm" className="flex h-[560px] flex-col gap-0 py-0">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
              <Bot className="size-3.5 text-chart-2" strokeWidth={1.75} />
              session <code>{sessionId}</code>
              <span className="ml-auto font-mono">POST /agent/chat</span>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <EmptyState
                  title="Ask something operational"
                  hint="“Which stores have milk below reorder point?” · “Summarize anomalies from the last 24h.” When a restock is needed, the assistant files a proposal for approval."
                />
              ) : (
                messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-secondary px-3.5 py-2.5 text-sm">
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex justify-start">
                      <div
                        className={`max-w-[92%] rounded-lg px-3.5 py-2.5 text-sm ${
                          m.error
                            ? "border border-destructive/40 bg-destructive/5 text-destructive"
                            : "border border-border"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{m.text}</div>

                        {m.evidence && m.evidence.length > 0 ? (
                          <div className="mt-3 border-t border-border pt-2.5">
                            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileText className="size-3" strokeWidth={1.75} /> evidence
                            </div>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {m.evidence.map((e, i) => (
                                <li key={i}>· {e}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {m.toolTrace && m.toolTrace.length > 0 ? (
                          <details className="mt-3 border-t border-border pt-2.5">
                            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground">
                              <Wrench className="size-3" strokeWidth={1.75} />
                              tool trace ({m.toolTrace.length})
                            </summary>
                            <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                              {m.toolTrace.map((t, i) => (
                                <li key={i}>
                                  {i + 1}. {t}
                                </li>
                              ))}
                            </ol>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  ),
                )
              )}
              {sending ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="live-dot inline-block size-1.5 rounded-full bg-chart-2" />
                  thinking…
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <div className="flex items-center gap-2 border-t border-border p-3">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask about stores, inventory, anomalies, orders…"
                aria-label="Message the operations assistant"
              />
              <Button
                onClick={() => void send()}
                disabled={sending || input.trim().length === 0}
                size="sm"
              >
                <SendHorizonal strokeWidth={1.75} />
                send
              </Button>
            </div>
          </Card>
        </div>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Pending proposals</CardTitle>
            <CardDescription className="text-xs">
              Approvals execute against PostgreSQL in one audited transaction.
            </CardDescription>
            <CardAction>
              <Pill tone={demo ? "amber" : "teal"}>{demo ? "demo" : "live"}</Pill>
            </CardAction>
          </CardHeader>
          <CardContent>
            {proposals.data === null ? (
              <Loading label="Loading proposals…" />
            ) : pendingProposals.length === 0 ? (
              <EmptyState
                title="Nothing waiting"
                hint="Filed proposals appear here until a human approves or rejects them."
              />
            ) : (
              <div className="space-y-3">
                {pendingProposals.map((p) => (
                  <ProposalCard
                    key={p.proposal_id}
                    proposal={p}
                    demo={demo}
                    onChanged={() => proposals.reload()}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
