"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { Brain, ChevronDown, Eraser, MessageSquarePlus } from "lucide-react";
import { AnswerCard } from "@/components/assistant/answer-card";
import { FollowUpChips } from "@/components/assistant/follow-up-chips";
import { HowIGotThis } from "@/components/assistant/how-i-got-this";
import { Button } from "@/components/ui/button";
import { chatActions, useChatSession, type ChatEmotion } from "@/lib/assistant/chat-session";
import { cn } from "@/lib/utils";
import { BOT_EMOTION_LABEL, botStyleFor } from "./bot-catalog";
import { BotPicker } from "./bot-picker";
import { MemoryPanel } from "./memory-panel";
import { PersonaBot } from "./persona-bot";
import { ThinkingTrail } from "./thinking-trail";
import { VoiceStage } from "./voice-stage";

export interface ChatPanelProps {
  persona?: string | null;
  experience: "business" | "ops";
  variant: "dock" | "page";
  demo?: boolean;
  sampleAnswer?: string;
  emotion: ChatEmotion;
  voice?: {
    available: boolean;
    unsupportedReason?: string | null;
    modeLabel?: string | null;
    active: boolean;
    connected: boolean;
    listening: boolean;
    muted: boolean;
    persistent?: boolean;
    canSend?: boolean;
    phase?: string;
    phaseLabel: string;
    statusDetail?: string;
    captionUser?: string;
    captionAssistant?: string;
    getLevel?: () => number;
    getOutputLevel?: () => number;
    onStart: () => void;
    onStop: () => void;
    onPttDown: () => void;
    onPttUp: () => void;
    onSend: () => void;
    onToggleListen: () => void;
    onInterrupt: () => void;
    onToggleMute: () => void;
  };
  className?: string;
}

export function ChatPanel({
  persona,
  experience,
  variant,
  demo,
  sampleAnswer,
  emotion,
  voice,
  className,
}: ChatPanelProps) {
  const session = useChatSession();
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bot = botStyleFor(session.botId);
  const suggested = bot.suggestedQuestions;

  useEffect(() => {
    chatActions.ensureBotForExperience(experience, persona);
  }, [experience, persona]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [session.messages, session.busy, session.stageDetail]);

  useEffect(() => {
    void chatActions.warmReady();
  }, []);

  const showVoice = Boolean(voice?.available) && session.panelMode === "voice";
  const voiceStartedRef = useRef(false);
  const pttDownRef = useRef(voice?.onPttDown);
  const pttUpRef = useRef(voice?.onPttUp);
  const startRef = useRef(voice?.onStart);
  const stopRef = useRef(voice?.onStop);
  pttDownRef.current = voice?.onPttDown;
  pttUpRef.current = voice?.onPttUp;
  startRef.current = voice?.onStart;
  stopRef.current = voice?.onStop;
  const persistent = Boolean(voice?.persistent);

  const lastAssistant = [...session.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const voiceProcessing =
    showVoice && (voice?.phase === "thinking" || session.busy);
  const processingDetail = voiceProcessing
    ? session.stageDetail || voice?.statusDetail || "Working on your question…"
    : null;
  const processingSteps =
    voiceProcessing && lastAssistant?.thinking?.length
      ? lastAssistant.thinking.map((step) =>
          step.detail ? `${step.label}: ${step.detail}` : step.label,
        )
      : voiceProcessing && session.stageDetail
        ? [session.stageDetail]
        : [];

  // Entering Voice auto-starts once; leaving Voice ends the session.
  useEffect(() => {
    if (!voice?.available) return;
    if (session.panelMode === "voice") {
      if (!voiceStartedRef.current) {
        voiceStartedRef.current = true;
        startRef.current?.();
      }
      return;
    }
    if (voiceStartedRef.current) {
      voiceStartedRef.current = false;
      stopRef.current?.();
    }
  }, [session.panelMode, voice?.available]);

  // Space: Grok = send-if-text else toggle listen / barge-in; Gemini = hold-to-talk.
  useEffect(() => {
    if (!showVoice || !voice?.active || !voice.connected) return;

    const typingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingTarget(event.target)) return;
      event.preventDefault();
      pttDownRef.current?.();
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (persistent) return; // toggle on keydown only
      if (event.code !== "Space" && event.key !== " ") return;
      if (typingTarget(event.target)) return;
      event.preventDefault();
      pttUpRef.current?.();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [showVoice, voice?.active, voice?.connected, persistent]);

  const send = (q: string) => {
    void chatActions.send(q, { demo, sampleAnswer });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(session.draft);
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card text-card-foreground",
        variant === "dock" && "h-full",
        variant === "page" && "min-h-[28rem]",
        className,
      )}
      style={{ ["--bot-accent" as string]: bot.accent }}
    >
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <PersonaBot
          persona={session.botId}
          emotion={emotion}
          size={variant === "page" ? 72 : 56}
          mouthSource={voice?.getOutputLevel ?? voice?.getLevel}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="flex max-w-full items-center gap-1 text-left text-sm font-medium"
            onClick={() => chatActions.setPickerOpen(!session.pickerOpen)}
            aria-expanded={session.pickerOpen}
            aria-controls="bot-picker-panel"
          >
            <span className="truncate">{bot.displayName}</span>
            <span className="truncate text-muted-foreground">· {bot.label}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          <p className="truncate text-[12px] text-muted-foreground" role="status">
            {showVoice && voice
              ? processingDetail || voice.statusDetail || voice.phaseLabel
              : session.busy
                ? session.stageDetail || `${BOT_EMOTION_LABEL[emotion]}…`
                : session.ready === false
                  ? "Configure XAI_API_KEY"
                  : bot.blurb}
            {!showVoice && session.readyModel ? ` · ${session.readyModel}` : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant={session.panelMode === "text" ? "default" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => chatActions.setPanelMode("text")}
          >
            Text
          </Button>
          <Button
            type="button"
            size="sm"
            variant={session.panelMode === "voice" ? "default" : "ghost"}
            className="h-7 px-2 text-[11px]"
            disabled={!voice?.available}
            title={voice?.unsupportedReason ?? undefined}
            onClick={() => chatActions.setPanelMode("voice")}
          >
            Voice
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant={session.memoryOpen ? "default" : "ghost"}
            aria-label="Memories"
            title="Local & global memories"
            onClick={() => chatActions.setMemoryOpen(!session.memoryOpen)}
          >
            <Brain aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Clear chat"
            title="Clear this chat"
            disabled={session.busy || session.messages.length === 0}
            onClick={() => {
              voice?.onStop();
              chatActions.clearChat();
            }}
          >
            <Eraser aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="New chat"
            title="Start a new chat"
            disabled={session.busy}
            onClick={() => {
              voice?.onStop();
              chatActions.newChat();
            }}
          >
            <MessageSquarePlus aria-hidden />
          </Button>
        </div>
      </header>

      {session.pickerOpen ? (
        <div id="bot-picker-panel" className="border-b border-border px-3 py-2">
          <BotPicker experience={experience} />
        </div>
      ) : null}

      {session.memoryOpen ? (
        <div className="max-h-48 overflow-y-auto border-b border-border px-3 py-2">
          <MemoryPanel sessionId={session.sessionId} />
        </div>
      ) : null}

      {showVoice && voice ? (
        <div
          className="flex min-h-0 flex-1 flex-col outline-none"
          tabIndex={0}
          role="region"
          aria-label="Voice chat"
        >
          <VoiceStage
            botId={session.botId}
            emotion={emotion}
            phase={
              voiceProcessing
                ? "thinking"
                : (voice.phase ??
                  (voice.listening ? "listening" : voice.active ? "ready" : "off"))
            }
            statusDetail={voice.statusDetail || voice.phaseLabel}
            processingDetail={processingDetail}
            processingSteps={processingSteps}
            captionUser={voice.captionUser}
            captionAssistant={voice.captionAssistant}
            listening={voice.listening}
            connected={voice.connected}
            active={voice.active}
            muted={voice.muted}
            canSend={Boolean(voice.canSend)}
            persistent={persistent}
            modeLabel={voice.modeLabel}
            getLevel={voice.getLevel}
            getOutputLevel={voice.getOutputLevel}
            onSend={() => voice.onSend()}
            onToggleListen={() => voice.onToggleListen()}
            onInterrupt={() => voice.onInterrupt()}
            onToggleMute={voice.onToggleMute}
            onEnd={() => {
              voiceStartedRef.current = false;
              voice.onStop();
              chatActions.setPanelMode("text");
            }}
            onRetry={() => {
              voiceStartedRef.current = true;
              voice.onStart();
            }}
            size={variant === "page" ? 168 : 140}
          />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {session.messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[13px] text-muted-foreground">
                  Ask {bot.displayName} about {bot.focus.toLowerCase()}…
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggested.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="rounded-md border border-border bg-background px-2 py-1 text-left text-[12px] hover:bg-muted"
                      onClick={() => send(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              session.messages.map((m, index) => (
                <div
                  key={m.id}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "flex min-w-0 flex-col gap-1.5",
                      m.role === "user" ? "max-w-[90%] items-end" : "w-full max-w-[95%] items-start",
                    )}
                  >
                    {m.role === "assistant" && (m.thinking?.length || m.pending) ? (
                      <ThinkingTrail
                        steps={m.thinking ?? []}
                        pending={Boolean(m.pending && !m.text)}
                        accent={botStyleFor(m.botId ?? session.botId).accent}
                      />
                    ) : null}
                    <div
                      className={cn(
                        "whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-background",
                        m.failed && "text-muted-foreground",
                      )}
                      style={
                        m.role === "assistant" && !m.failed
                          ? { borderLeftWidth: 3, borderLeftColor: botStyleFor(m.botId ?? session.botId).accent }
                          : undefined
                      }
                    >
                      {m.text ||
                        (m.pending
                          ? m.working
                            ? `Looking at ${m.working.replace(/_/g, " ")}…`
                            : session.stageDetail || "Thinking…"
                          : "")}
                    </div>
                    {m.cards && m.cards.length > 0 ? (
                      <div className="grid w-full gap-2">
                        {m.cards.map((card, i) => (
                          <AnswerCard key={`${m.id}-${i}`} card={card} />
                        ))}
                      </div>
                    ) : null}
                    {m.role === "assistant" && !m.pending && !m.failed ? (
                      <HowIGotThis provenance={m.provenance ?? null} tools={m.tools} />
                    ) : null}
                    {m.followups &&
                    m.followups.length > 0 &&
                    !m.pending &&
                    index === session.messages.length - 1 ? (
                      <FollowUpChips
                        items={m.followups}
                        onPick={(q) => send(q)}
                        disabled={session.busy}
                      />
                    ) : null}
                  </div>
                </div>
              ))
            )}
            <div ref={bottom} />
          </div>

          <form className="flex flex-col gap-1.5 border-t border-border p-2.5" onSubmit={onSubmit}>
            <div className="flex gap-2">
              <label htmlFor={`chat-input-${variant}`} className="sr-only">
                Your question
              </label>
              <input
                ref={inputRef}
                id={`chat-input-${variant}`}
                value={session.draft}
                onChange={(e) => chatActions.setDraft(e.target.value)}
                placeholder={`Ask ${bot.displayName}…`}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button type="submit" size="sm" disabled={session.busy || !session.draft.trim()}>
                {session.busy ? "…" : "Ask"}
              </Button>
            </div>
            <label className="flex items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={session.ttsEnabled}
                onChange={(e) => chatActions.setTtsEnabled(e.target.checked)}
              />
              Read answers aloud (browser TTS)
            </label>
          </form>
        </>
      )}
    </div>
  );
}
