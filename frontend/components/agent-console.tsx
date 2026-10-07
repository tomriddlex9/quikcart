"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, FileText, SendHorizonal, Sparkles, Wrench } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { ProposalCard } from "@/components/proposal-card";
import { EmptyState, ErrorState, Loading } from "@/components/states";
import { Badge } from "@/components/ui/badge";
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
import { streamAgentChat, type AgentStreamStage } from "@/lib/agent-stream";
import type { AgentEvidence, AgentToolTrace, Proposal } from "@/lib/types";
import { useApiData } from "@/lib/use-api";

interface LiveTool {
  name: string;
  ok: boolean;
  cache_hit: boolean;
  summary: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  evidence?: AgentEvidence[];
  toolTrace?: AgentToolTrace[];
  tools?: LiveTool[];
  model?: string | null;
  streaming?: boolean;
  error?: boolean;
}

const STORAGE_KEY = "qc_agent_chat:v1";
const STAGE_LABEL: Record<AgentStreamStage, string> = {
  classifying: "Classifying",
  planning: "Planning",
  tools: "Tools",
  action: "Action",
  answer: "Answering",
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m-${Date.now()}-${idCounter}`;
}

function evidenceLine(item: AgentEvidence): string {
  if (typeof item.summary === "string" && item.summary) return item.summary;
  const tool = item.tool ? `${item.tool} · ` : "";
  const type = item.type ? String(item.type) : "fact";
  return `${tool}${type}`;
}

function loadStored(): { sessionId: string; messages: ChatMessage[] } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: string; messages?: ChatMessage[] };
    if (!parsed.sessionId || !Array.isArray(parsed.messages)) return null;
    return { sessionId: parsed.sessionId, messages: parsed.messages };
  } catch {
    return null;
  }
}

export function AgentConsole() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<AgentStreamStage | null>(null);
  const [chatHealth, setChatHealth] = useState<"idle" | "live" | "down">("idle");
  const [sessionId, setSessionId] = useState(
    () => `console-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [sessionReady, setSessionReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const proposals = useApiData<Proposal[]>("/api/v1/proposals?status=PENDING");
  const pendingProposals = (proposals.data ?? []).filter((p) => p.status === "PENDING");

  useEffect(() => {
    const stored = loadStored();
    if (stored?.messages.length) {
      setSessionId(stored.sessionId);
      setMessages(stored.messages);
    }
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, messages }));
    } catch {
      /* quota / private mode */
    }
  }, [sessionId, messages, sessionReady]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setStage("classifying");
    const userId = nextId();
    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text },
      { id: assistantId, role: "assistant", text: "", streaming: true, tools: [] },
    ]);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    await streamAgentChat(
      text,
      sessionId,
      {
        onStatus: (nextStage, model) => {
          setStage(nextStage);
          if (model) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, model } : m)),
            );
          }
        },
        onTool: (tool) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, tools: [...(m.tools ?? []), tool] } : m,
            ),
          );
          if (tool.name === "create_restock_proposal") {
            proposals.reload();
          }
        },
        onToken: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: `${m.text}${chunk}` } : m,
            ),
          );
        },
        onDone: (payload) => {
          setChatHealth("live");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    text: payload.answer || m.text,
                    evidence: payload.evidence,
                    toolTrace: payload.tool_trace,
                    model: payload.model ?? m.model,
                    streaming: false,
                    error: Boolean(payload.degraded) && !payload.answer,
                  }
                : m,
            ),
          );
          proposals.reload();
        },
        onError: (detail) => {
          setChatHealth("down");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    error: true,
                    streaming: false,
                    text:
                      m.text ||
                      (detail.includes("503") || detail.includes("404")
                        ? "The assistant is not available — the API is down or the stream route is missing."
                        : `The assistant call failed: ${detail}`),
                  }
                : m,
            ),
          );
        },
      },
      controller.signal,
    );
    setSending(false);
    setStage(null);
  }, [input, sending, sessionId, proposals]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, stage]);

  const showProposalsBanner = proposals.mode === "stale" || Boolean(proposals.error);
  const proposalsLabel =
    proposals.mode === "live"
      ? "live"
      : proposals.mode === "stale"
        ? "last live"
        : proposals.error
          ? "unreachable"
          : "loading";
  const chatLabel = chatHealth === "down" ? "unavailable" : chatHealth === "live" ? "live" : "idle";

  return (
    <>
      <PageHeader
        title="Agent"
        description="A bounded assistant over Gold marts, ML predictions and SOP documents. It proposes changes; it never writes. Replies stream live from Gemini when configured."
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card size="sm" className="flex h-[560px] flex-col gap-0 py-0">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
              <Bot className="size-3.5 text-chart-2" strokeWidth={1.75} />
              session <code>{sessionId}</code>
              <Pill
                tone={chatHealth === "down" ? "red" : chatHealth === "live" ? "teal" : "neutral"}
                className="ml-auto"
              >
                chat · {chatLabel}
              </Pill>
              <span className="font-mono">POST /agent/chat/stream</span>
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
                        {m.model ? (
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Sparkles className="size-3" strokeWidth={1.75} />
                            {m.model}
                          </div>
                        ) : null}
                        <div className="whitespace-pre-wrap">
                          {m.text || (m.streaming ? "" : "(empty answer from agent)")}
                          {m.streaming && !m.text ? (
                            <span className="text-muted-foreground">working…</span>
                          ) : null}
                        </div>

                        {m.tools && m.tools.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {m.tools.map((t, i) => (
                              <li key={`${t.name}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <Badge variant={t.ok ? "secondary" : "destructive"}>{t.name}</Badge>
                                {t.cache_hit ? (
                                  <Badge variant="outline">cache</Badge>
                                ) : null}
                                <span className="text-muted-foreground">{t.summary}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {m.evidence && m.evidence.length > 0 ? (
                          <div className="mt-3 border-t border-border pt-2.5">
                            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileText className="size-3" strokeWidth={1.75} /> evidence
                            </div>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {m.evidence.map((e, i) => (
                                <li key={i}>· {evidenceLine(e)}</li>
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
                                  {i + 1}. {t.tool ?? "tool"}
                                  {t.cache_hit ? " · cache" : ""} — {t.result_summary ?? ""}
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
              {sending && stage ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="live-dot inline-block size-1.5 rounded-full bg-chart-2" />
                  {STAGE_LABEL[stage]}
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
              <Pill
                tone={
                  proposals.mode === "live" ? "teal" : proposals.mode === "demo" ? "neutral" : "amber"
                }
              >
                proposals · {proposalsLabel}
              </Pill>
            </CardAction>
          </CardHeader>
          <CardContent>
            {showProposalsBanner ? <ApiBanner mode={proposals.mode} error={proposals.error} /> : null}
            {proposals.data === null && proposals.error ? (
              <ErrorState message={proposals.error} />
            ) : proposals.data === null ? (
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
                    demo={false}
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
