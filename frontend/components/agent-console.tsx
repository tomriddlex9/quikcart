"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, FileText, SendHorizonal, Wrench } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { ProposalCard } from "@/components/proposal-card";
import { EmptyState, Loading } from "@/components/states";
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
  const [sessionId] = useState(
    () => `console-${Math.random().toString(36).slice(2, 10)}`,
  );
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
      const unavailable =
        result.status === 503 || result.status === 404 || result.status === 0;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          error: true,
          text: unavailable
            ? "The operations assistant is not available. Phase 13 (the LangGraph agent over Ollama qwen3) is not wired into the API yet, or the API itself is down — no answer was generated, and nothing here is fabricated."
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
        title="Agent console"
        description="Chat with the bounded operations assistant. It answers from Gold marts, ML predictions and retrieved SOP documents — and when it wants to change something, it files a proposal for a human to approve, never a write."
      />

      {demo ? <ApiBanner mode={proposals.mode} error={proposals.error} /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="panel flex h-[560px] flex-col">
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-[11px] text-faint">
              <Bot className="h-3.5 w-3.5 text-teal" strokeWidth={1.75} />
              session <code>{sessionId}</code>
              <span className="ml-auto">POST /api/v1/agent/chat</span>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <EmptyState
                  title="Ask the assistant anything operational"
                  hint="Try: “Which stores have milk below reorder point?” or “Summarize anomalies from the last 24h.” When a restock is needed, the assistant files a proposal — approve it here."
                />
              ) : (
                messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] border border-line bg-panel-2 px-3.5 py-2.5 text-[12.5px] text-paper">
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex justify-start">
                      <div
                        className={`max-w-[92%] px-3.5 py-2.5 text-[12.5px] ${
                          m.error
                            ? "border border-red-dim/60 bg-red/10 text-red"
                            : "border border-line-soft bg-ink-2 text-paper-dim"
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{m.text}</div>

                        {m.evidence && m.evidence.length > 0 ? (
                          <div className="mt-3 border-t border-line-soft pt-2.5">
                            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-faint">
                              <FileText className="h-3 w-3" strokeWidth={1.75} /> evidence
                            </div>
                            <ul className="space-y-1">
                              {m.evidence.map((e, i) => (
                                <li key={i} className="text-[11px] leading-relaxed text-muted">
                                  · {e}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {m.toolTrace && m.toolTrace.length > 0 ? (
                          <details className="mt-3 border-t border-line-soft pt-2.5">
                            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10.5px] text-faint">
                              <Wrench className="h-3 w-3" strokeWidth={1.75} />
                              tool trace ({m.toolTrace.length})
                            </summary>
                            <ol className="mt-1.5 space-y-1">
                              {m.toolTrace.map((t, i) => (
                                <li key={i} className="text-[11px] text-muted">
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
                <div className="flex items-center gap-2 text-[11px] text-faint">
                  <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-teal" />
                  assistant is thinking…
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-line-soft p-3">
              <div className="flex items-center gap-2">
                <input
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
                  className="min-w-0 flex-1 rounded-xs border border-line bg-panel px-3 py-2.5 text-[12.5px] text-paper placeholder:text-faint focus:border-amber focus:outline-none"
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || input.trim().length === 0}
                  className="flex items-center gap-1.5 rounded-xs border border-amber-dim/70 bg-amber/10 px-3.5 py-2.5 text-[12px] text-amber transition-colors hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SendHorizonal className="h-3.5 w-3.5" strokeWidth={1.75} />
                  send
                </button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="panel px-4 py-3.5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[12px] font-medium text-paper-dim">Pending proposals</h2>
              <Pill tone={demo ? "amber" : "teal"}>{demo ? "demo" : "live"}</Pill>
            </div>
            <p className="mb-3 text-[10.5px] leading-relaxed text-faint">
              Anything the assistant files lands here (and on the proposals page) until a
              human approves or rejects it. Approvals execute against PostgreSQL in one
              audited transaction.
            </p>
            {proposals.data === null ? (
              <Loading label="Loading proposals…" />
            ) : pendingProposals.length === 0 ? (
              <EmptyState
                title="Nothing waiting for approval"
                hint="When the agent or an operator files a proposal, it appears here."
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
          </div>
        </div>
      </div>
    </>
  );
}
