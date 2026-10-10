"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  chatActions,
  emotionFromVoicePhase,
  useChatSession,
} from "@/lib/assistant/chat-session";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { formatElapsed, isConnected } from "@/lib/voice/voice-machine";
import { cn } from "@/lib/utils";
import { botStyleFor } from "./bot-catalog";
import { ChatPanel } from "./chat-panel";
import { PersonaBot } from "./persona-bot";

const STATUS_TEXT = {
  off: "Opening voice…",
  connecting: "Connecting…",
  ready: "Listening for you…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Voice stopped.",
} as const;

export interface ChatDockProps {
  experience: "business" | "ops";
  persona?: string | null;
  /** When true, never show the FAB (expanded Ask/Agent page owns the UI). */
  forceHideFab?: boolean;
  /** Business preference: user opted into voice (ops defaults true when server allows). */
  voicePrefEnabled?: boolean;
  className?: string;
}

export default function ChatDock({
  experience,
  persona,
  forceHideFab = false,
  voicePrefEnabled = true,
  className,
}: ChatDockProps) {
  const session = useChatSession();
  const voice = useVoiceSession();
  const fabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void chatActions.warmReady();
    chatActions.ensureBotForExperience(experience, persona);
  }, [experience, persona]);

  const bot = botStyleFor(session.botId);

  useEffect(() => {
    if (!session.open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        chatActions.setOpen(false);
        fabRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.open]);

  // Open-mic: keep PTT down while enabled and connected.
  useEffect(() => {
    if (!session.openMic || !voice.active || !isConnected(voice.state.phase)) return;
    if (session.panelMode !== "voice") return;
    voice.pttDown();
    return () => voice.pttUp();
    // intentionally depend on openMic + phase, not voice object identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.openMic, session.panelMode, voice.active, voice.state.phase]);

  const voiceEmotion = emotionFromVoicePhase(voice.state.phase, session.busy);
  const emotion =
    session.panelMode === "voice" && voice.availability === "available"
      ? voiceEmotion
      : session.emotion;

  const voiceAvailable =
    voice.availability === "available" || voice.availability === "checking";
  const hideFab = forceHideFab || session.hideFab;

  const voiceModeLabel =
    voice.mode === "grok_browser"
      ? "Grok voice (browser)"
      : voice.mode === "gemini_live"
        ? "Gemini Live voice"
        : null;

  const voiceBlockedPref = !voicePrefEnabled;
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
    voiceBlockedPref
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
      : voice.availability === "unsupported"
      ? {
          available: false as const,
          unsupportedReason: voice.unsupportedReason,
          modeLabel: voiceModeLabel,
          active: false,
          connected: false,
          listening: false,
          muted: false,
          canSend: false,
          phaseLabel: voice.unsupportedReason ?? "Voice unavailable",
          ...voiceUnavailable,
        }
      : voice.availability === "unavailable" || voice.availability === "checking"
        ? {
            available: false as const,
            unsupportedReason:
              voice.availability === "checking"
                ? "Checking voice…"
                : "Voice is off on the server (set VOICE_ENABLED and XAI_API_KEY or GEMINI_API_KEY).",
            modeLabel: voiceModeLabel,
            active: false,
            connected: false,
            listening: false,
            muted: false,
            canSend: false,
            phaseLabel: "Voice unavailable",
            ...voiceUnavailable,
          }
        : {
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
          };

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col items-end gap-3 md:bottom-6 md:right-6",
        experience === "ops" && "md:bottom-24",
        className,
      )}
    >
      {session.open ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Chat assistant"
          className="pointer-events-auto relative flex h-[min(34rem,calc(100vh-7rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="absolute right-2 top-2 z-10">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close chat"
              className="pointer-events-auto"
              onClick={() => {
                chatActions.setOpen(false);
                fabRef.current?.focus();
              }}
            >
              <X aria-hidden />
            </Button>
          </div>
          {voice.active ? (
            <p className="sr-only">
              Voice session {formatElapsed(voice.state.elapsedSeconds)} of{" "}
              {formatElapsed(voice.maxSeconds)}
            </p>
          ) : null}
          <ChatPanel
            persona={persona}
            experience={experience}
            variant="dock"
            emotion={emotion}
            voice={voiceProps}
          />
        </section>
      ) : null}

      {!session.open && !hideFab ? (
        <button
          ref={fabRef}
          type="button"
          data-testid="chat-dock-fab"
          onClick={() => chatActions.setOpen(true)}
          aria-label={
            session.busy || voice.active
              ? `Open ${bot.displayName} (active)`
              : `Open ${bot.displayName}`
          }
          className={cn(
            "pointer-events-auto grid size-14 place-items-center rounded-2xl bg-card shadow-md ring-1 ring-foreground/15 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            (session.busy || voice.active) && "ring-2",
          )}
          style={
            session.busy || voice.active
              ? { boxShadow: `0 0 0 2px ${bot.accent}` }
              : undefined
          }
        >
          <PersonaBot
            persona={session.botId}
            emotion={emotion}
            size={48}
            compact
            mouthSource={voiceAvailable ? voice.getOutputLevel : undefined}
          />
        </button>
      ) : null}
    </div>
  );
}
