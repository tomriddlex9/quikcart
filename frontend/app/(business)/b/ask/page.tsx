"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnswerCard } from "@/components/assistant/answer-card";
import { FollowUpChips } from "@/components/assistant/follow-up-chips";
import { HowIGotThis } from "@/components/assistant/how-i-got-this";
import { RareUiCredit } from "@/components/assistant/rare-ui-credit";
import { QuickQuestionChips } from "@/components/business/quick-question-chips";
import { useMarkChecklist } from "@/components/business/getting-started-checklist";
import { Button } from "@/components/ui/button";
import { useBusiness } from "@/lib/business/business-context";
import { streamAgentChat } from "@/lib/agent-stream";
import type { AssistantCard, Provenance } from "@/lib/assistant/types";
import { useDataMode } from "@/lib/data-mode";
import { cn } from "@/lib/utils";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  failed?: boolean;
  cards?: AssistantCard[];
  followups?: string[];
  provenance?: Provenance | null;
  tools?: string[];
  /** Tool the assistant is currently using, shown while pending. */
  working?: string | null;
}

const SUGGESTED = [
  "How are sales today compared with last week?",
  "Which stores need help right now?",
  "What is about to run out?",
  "Why are deliveries slow?",
  "How much have we given away in discounts?",
];

const SAMPLE_ANSWER =
  "This is a sample answer because you are viewing sample data. With live data connected, the assistant looks at today's numbers and explains what changed and what to do next.";

function AskView() {
  const { source } = useDataMode();
  const { prefs } = useBusiness();
  const mark = useMarkChecklist();
  const params = useSearchParams();
  const initialQ = params.get("q");
  const contextBits = Array.from(params.entries())
    .filter(([key]) => key.startsWith("ctx_") && key.length > 4)
    .map(([key, value]) => `${key.slice(4)}=${value}`);
  const initial =
    initialQ && contextBits.length > 0
      ? `${initialQ} (context: ${contextBits.join(", ")})`
      : initialQ;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialQ ?? "");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string>("");
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  useEffect(() => {
    sessionId.current = `biz-${crypto.randomUUID()}`;
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      const assistantId = nextId.current + 1;
      nextId.current += 2;
      setDraft("");
      setBusy(true);
      mark("ask_question");
      setMessages((prev) => [
        ...prev,
        { id: assistantId - 1, role: "user", text },
        { id: assistantId, role: "assistant", text: "", pending: true },
      ]);
      const patch = (fn: (m: Message) => Message) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      if (source === "demo") {
        patch((m) => ({ ...m, text: SAMPLE_ANSWER, pending: false }));
        setBusy(false);
        return;
      }
      abort.current = new AbortController();
      await streamAgentChat(
        text,
        sessionId.current,
        {
          onToolStart: (tool) =>
            patch((m) => ({
              ...m,
              working: tool.name,
              tools: m.tools?.includes(tool.name) ? m.tools : [...(m.tools ?? []), tool.name],
            })),
          onToken: (t) => patch((m) => ({ ...m, text: m.text + t })),
          onCard: (card) => patch((m) => ({ ...m, cards: [...(m.cards ?? []), card] })),
          onFollowups: (items) => patch((m) => ({ ...m, followups: items })),
          onDone: (payload) =>
            patch((m) => ({
              ...m,
              text: payload.answer || m.text,
              // `done` carries the final verified set; prefer it over streamed partials.
              cards: payload.cards.length > 0 ? payload.cards : m.cards,
              followups: payload.followups.length > 0 ? payload.followups : m.followups,
              provenance: payload.provenance,
              pending: false,
              working: null,
            })),
          onError: () =>
            patch((m) => ({
              ...m,
              pending: false,
              failed: true,
              text:
                m.text ||
                "The assistant isn't connected yet. Your question wasn't lost. Try again in a moment, or use the pages on the left to look it up.",
            })),
        },
        abort.current.signal,
      );
      patch((m) => (m.pending ? { ...m, pending: false } : m));
      setBusy(false);
    },
    [busy, mark, source],
  );

  // A question handed over by an "Ask about this" button is sent once on arrival.
  useEffect(() => {
    if (initial && !autoSent.current) {
      autoSent.current = true;
      void send(initial);
    }
  }, [initial, send]);

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ask center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask about your stores in plain English. The assistant reads the same numbers you see here
          and can suggest actions, but a person always approves them.
        </p>
      </header>

      <div className="flex-1 space-y-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-border p-5">
            <p className="text-sm font-medium">Try one of these</p>
            <QuickQuestionChips questions={SUGGESTED} />
            {prefs.first_question ? (
              <p className="text-xs text-muted-foreground">
                You picked this during setup:{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void send(prefs.first_question ?? "")}
                >
                  {prefs.first_question}
                </button>
              </p>
            ) : null}
          </div>
        ) : (
          messages.map((m, index) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("flex min-w-0 flex-col gap-2", m.role === "user" ? "max-w-[85%] items-end" : "w-full max-w-[85%] items-start")}>
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card ring-1 ring-foreground/10",
                    m.failed && "text-muted-foreground",
                  )}
                >
                  {m.text || (m.pending ? (m.working ? `Looking at ${m.working.replace(/_/g, " ")}…` : "Thinking…") : "")}
                </div>
                {m.cards && m.cards.length > 0 ? (
                  <div className="grid w-full gap-2 sm:grid-cols-2">
                    {m.cards.map((card, i) => (
                      <AnswerCard
                        key={`${m.id}-${i}`}
                        card={card}
                        className={card.type === "table" || card.type === "risk_list" ? "sm:col-span-2" : undefined}
                      />
                    ))}
                  </div>
                ) : null}
                {m.role === "assistant" && !m.pending && !m.failed ? (
                  <HowIGotThis provenance={m.provenance ?? null} tools={m.tools} />
                ) : null}
                {m.followups && m.followups.length > 0 && !m.pending && index === messages.length - 1 ? (
                  <FollowUpChips items={m.followups} onPick={(q) => void send(q)} disabled={busy} />
                ) : null}
              </div>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-16 flex gap-2 rounded-xl bg-background/90 py-2 backdrop-blur md:bottom-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <input
          id="ask-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about sales, stores, delivery…"
          autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="submit" size="lg" disabled={busy || draft.trim() === ""}>
          {busy ? "Working…" : "Ask"}
        </Button>
      </form>
      <RareUiCredit className="text-center" />
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense>
      <AskView />
    </Suspense>
  );
}
