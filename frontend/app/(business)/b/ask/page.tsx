"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { ChatPanel } from "@/components/assistant/chat-dock/chat-panel";
import { PersonaBot } from "@/components/assistant/chat-dock/persona-bot";
import { BusinessPage } from "@/components/business/business-page";
import { useMarkChecklist } from "@/components/business/getting-started-checklist";
import { useBusiness } from "@/lib/business/business-context";
import {
  chatActions,
  emotionFromVoicePhase,
  useChatSession,
} from "@/lib/assistant/chat-session";
import { useDataMode } from "@/lib/data-mode";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { isConnected } from "@/lib/voice/voice-machine";
import { cn } from "@/lib/utils";
import { botStyleFor } from "@/components/assistant/chat-dock/bot-catalog";

const SAMPLE_ANSWER =
  "This is a sample answer because you are viewing sample data. With live data connected, the assistant looks at today's numbers and explains what changed and what to do next.";

const STATUS_TEXT = {
  off: "Opening voice…",
  connecting: "Connecting…",
  ready: "Listening for you…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Voice stopped.",
} as const;

function AskView() {
  const { source } = useDataMode();
  const { persona, sessionPersona, prefs } = useBusiness();
  const mark = useMarkChecklist();
  const params = useSearchParams();
  const session = useChatSession();
  const voice = useVoiceSession();
  const autoSent = useRef(false);
  const botPersona = session.botId || (sessionPersona && sessionPersona.length > 0 ? sessionPersona : persona);
  const bot = botStyleFor(botPersona);

  const initialQ = params.get("q");
  const contextBits = Array.from(params.entries())
    .filter(([key]) => key.startsWith("ctx_") && key.length > 4)
    .map(([key, value]) => `${key.slice(4)}=${value}`);
  const initial =
    initialQ && contextBits.length > 0
      ? `${initialQ} (context: ${contextBits.join(", ")})`
      : initialQ;

  useEffect(() => {
    chatActions.setHideFab(true);
    chatActions.setOpen(false);
    return () => chatActions.setHideFab(false);
  }, []);

  useEffect(() => {
    if (initial && !autoSent.current) {
      autoSent.current = true;
      mark("ask_question");
      void chatActions.send(initial, {
        demo: source === "demo",
        sampleAnswer: SAMPLE_ANSWER,
      });
    }
  }, [initial, mark, source]);

  useEffect(() => {
    if (prefs.first_question && session.messages.length === 0 && !initial) {
      chatActions.setDraft(prefs.first_question);
    }
  }, [prefs.first_question, session.messages.length, initial]);

  const emotion =
    session.panelMode === "voice" && voice.availability === "available"
      ? emotionFromVoicePhase(voice.state.phase, session.busy)
      : session.emotion;

  const voiceModeLabel =
    voice.mode === "grok_browser"
      ? "Grok voice (browser)"
      : voice.mode === "gemini_live"
        ? "Gemini Live voice"
        : null;

  const voiceUnavailable = {
    onStart: () => undefined,
    onStop: () => undefined,
    onPttDown: () => undefined,
    onPttUp: () => undefined,
    onSend: () => undefined,
    onToggleListen: () => undefined,
    onInterrupt: () => undefined,
    onToggleMute: () => undefined,
  };
  const voiceProps =
    !prefs.voice_enabled
      ? {
          available: false as const,
          unsupportedReason: "Enable voice in Settings to talk to the assistant.",
          modeLabel: voiceModeLabel,
          active: false,
          connected: false,
          listening: false,
          muted: false,
          canSend: false,
          phaseLabel: "Voice off in settings",
          ...voiceUnavailable,
        }
      : voice.availability === "available"
      ? {
          available: true as const,
          modeLabel: voiceModeLabel,
          persistent: voice.persistent,
          active: voice.active,
          connected: isConnected(voice.state.phase),
          listening: voice.state.phase === "listening",
          muted: voice.state.muted,
          canSend: voice.canSend,
          phase: voice.state.phase,
          phaseLabel:
            voice.state.phase === "error"
              ? (voice.state.error ?? STATUS_TEXT.error)
              : STATUS_TEXT[voice.state.phase],
          statusDetail: voice.statusDetail,
          captionUser: voice.state.caption.user,
          captionAssistant: voice.state.caption.assistant,
          getLevel: voice.getLevel,
          getOutputLevel: voice.getOutputLevel,
          onStart: () => void voice.start(),
          onStop: () => voice.stop(),
          onPttDown: () => voice.pttDown(),
          onPttUp: () => voice.pttUp(),
          onSend: () => voice.sendNow(),
          onToggleListen: () => voice.toggleListen(),
          onInterrupt: () => voice.interrupt(),
          onToggleMute: () => voice.toggleMute(),
        }
      : {
          available: false as const,
          modeLabel: voiceModeLabel,
          unsupportedReason:
            voice.availability === "unsupported"
              ? voice.unsupportedReason
              : "Voice needs VOICE_ENABLED and XAI_API_KEY (Grok) or GEMINI_API_KEY (Live).",
          active: false,
          connected: false,
          listening: false,
          muted: false,
          canSend: false,
          phaseLabel: "Voice unavailable",
          ...voiceUnavailable,
        };

  return (
    <BusinessPage
      title="Ask center"
      description="Ask about your stores in plain English. Same assistant as the floating bot — grounded in your numbers, actions always need a human."
    >
      <div className="grid min-h-[calc(100vh-14rem)] gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div
          className={cn(
            "overflow-hidden rounded-xl border border-border bg-card shadow-sm",
            "flex min-h-[32rem] flex-col",
          )}
        >
          <ChatPanel
            persona={botPersona}
            experience="business"
            variant="page"
            demo={source === "demo"}
            sampleAnswer={SAMPLE_ANSWER}
            emotion={emotion}
            voice={voiceProps}
            className="flex-1"
          />
        </div>
        <aside className="hidden flex-col items-center justify-start gap-4 rounded-xl border border-dashed border-border bg-muted/30 p-6 lg:flex">
          <PersonaBot
            persona={botPersona}
            emotion={emotion}
            size={160}
            mouthSource={voice.getOutputLevel}
          />
          <p className="text-center text-sm font-medium" style={{ color: bot.accent }}>
            {bot.displayName}
          </p>
          <p className="text-center text-sm text-muted-foreground">{bot.blurb}</p>
          <p className="text-center text-xs text-muted-foreground">
            Tap the bot name in chat to switch personality. Same corner dock on every screen.
          </p>
        </aside>
      </div>
    </BusinessPage>
  );
}

export default function AskPage() {
  return (
    <Suspense>
      <AskView />
    </Suspense>
  );
}
