"use client";

import { Loader2, Mic, MicOff, Send, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatEmotion } from "@/lib/assistant/chat-session";
import { cn } from "@/lib/utils";
import { botStyleFor } from "./bot-catalog";
import { PersonaBot } from "./persona-bot";

export interface VoiceStageProps {
  botId: string;
  emotion: ChatEmotion;
  phase: string;
  statusDetail: string;
  /** Live agent stage line while processing (tools / writing). */
  processingDetail?: string | null;
  /** Recent thinking/tool steps for the current turn. */
  processingSteps?: string[];
  captionUser?: string;
  captionAssistant?: string;
  listening: boolean;
  connected: boolean;
  active: boolean;
  muted: boolean;
  canSend?: boolean;
  persistent?: boolean;
  modeLabel?: string | null;
  getLevel?: () => number;
  getOutputLevel?: () => number;
  onSend: () => void;
  onToggleListen: () => void;
  onInterrupt: () => void;
  onToggleMute: () => void;
  onEnd: () => void;
  onRetry: () => void;
  size?: number;
}

const PHASE_LABEL: Record<string, string> = {
  off: "Off",
  connecting: "Connecting",
  ready: "Ready",
  listening: "Listening",
  thinking: "Working",
  speaking: "Speaking",
  error: "Error",
};

export function VoiceStage({
  botId,
  emotion,
  phase,
  statusDetail,
  processingDetail,
  processingSteps = [],
  captionUser,
  captionAssistant,
  listening,
  connected,
  active,
  muted,
  canSend = false,
  persistent,
  modeLabel,
  getLevel,
  getOutputLevel,
  onSend,
  onToggleListen,
  onInterrupt,
  onToggleMute,
  onEnd,
  onRetry,
  size = 148,
}: VoiceStageProps) {
  const bot = botStyleFor(botId);
  const processing = phase === "thinking";
  const speaking = phase === "speaking";
  const ringActive = listening || speaking || processing;
  const phaseLabel = PHASE_LABEL[phase] ?? phase;
  const statusLine =
    processing && processingDetail
      ? processingDetail
      : speaking && !statusDetail.toLowerCase().includes("speak")
        ? "Speaking answer…"
        : statusDetail;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-4">
      <div className="flex justify-center">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide",
            phase === "listening" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
            processing && "bg-amber-500/15 text-amber-800 dark:text-amber-200",
            speaking && "bg-sky-500/15 text-sky-800 dark:text-sky-200",
            phase === "error" && "bg-destructive/15 text-destructive",
            (phase === "ready" || phase === "connecting" || phase === "off") &&
              "bg-muted text-muted-foreground",
          )}
        >
          {processing ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <span
              className={cn(
                "size-1.5 rounded-full",
                phase === "listening" && "animate-pulse bg-emerald-500",
                speaking && "animate-pulse bg-sky-500",
                phase === "error" && "bg-destructive",
                (phase === "ready" || phase === "connecting" || phase === "off") &&
                  "bg-muted-foreground/50",
              )}
            />
          )}
          {phaseLabel}
        </span>
      </div>

      <div
        className="relative mx-auto grid place-items-center"
        style={{ width: size + 36, height: size + 36 }}
      >
        <span
          className={cn(
            "absolute inset-0 rounded-full transition-all duration-500",
            ringActive ? "animate-pulse opacity-100" : "opacity-30",
          )}
          style={{
            background: `radial-gradient(circle, ${bot.fill}33 0%, transparent 68%)`,
            boxShadow: ringActive ? `0 0 0 2px ${bot.accent}55` : undefined,
          }}
        />
        <PersonaBot
          persona={botId}
          emotion={emotion}
          size={size}
          mouthSource={getOutputLevel ?? getLevel}
        />
      </div>

      <div className="space-y-1 text-center" aria-live="polite">
        <p className="text-[13px] font-medium leading-snug text-foreground">{statusLine}</p>
        {processing ? (
          <p className="text-[11px] text-muted-foreground">
            {bot.displayName} is working on your voice question…
          </p>
        ) : null}
      </div>

      {processing || processingSteps.length > 0 ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-200">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Bot activity
          </p>
          {processingSteps.length > 0 ? (
            <ol className="space-y-1 text-[12px] leading-snug text-foreground">
              {processingSteps.slice(-5).map((step, i) => (
                <li key={`${i}-${step}`} className="flex gap-2">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-amber-500" />
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12px] text-muted-foreground">{statusLine}</p>
          )}
        </div>
      ) : null}

      <div className="min-h-[4.5rem] space-y-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[13px]">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">You</p>
          <p className={cn("leading-snug", !captionUser && "text-muted-foreground")}>
            {captionUser || (listening ? "Listening for speech…" : "—")}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {bot.displayName}
          </p>
          <p className={cn("leading-snug", !captionAssistant && "text-muted-foreground")}>
            {captionAssistant ||
              (processing
                ? statusLine || "Working on it…"
                : speaking
                  ? "Speaking…"
                  : "—")}
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-col items-stretch gap-2 pt-1">
        {!active ? (
          <Button type="button" className="h-10" onClick={onRetry}>
            <Mic aria-hidden />
            Start voice
          </Button>
        ) : processing || speaking ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" className="h-10 flex-1" onClick={onInterrupt}>
              <Mic aria-hidden />
              Interrupt
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              onClick={onToggleMute}
            >
              {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            </Button>
            <Button type="button" variant="outline" size="icon-lg" aria-label="End voice" onClick={onEnd}>
              <Square aria-hidden />
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-10",
                  listening && "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
                )}
                disabled={!connected}
                onClick={onToggleListen}
                aria-pressed={listening}
              >
                {listening ? (
                  <>
                    <MicOff aria-hidden />
                    Pause mic
                  </>
                ) : (
                  <>
                    <Mic aria-hidden />
                    Listen
                  </>
                )}
              </Button>
              <Button
                type="button"
                className="h-10"
                style={
                  canSend
                    ? { background: bot.accent, color: "white", borderColor: bot.accent }
                    : undefined
                }
                disabled={!connected || !canSend}
                onClick={onSend}
                title={canSend ? "Send what you said" : "Speak first, then send"}
              >
                <Send aria-hidden />
                Send
              </Button>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                aria-label={muted ? "Unmute" : "Mute"}
                aria-pressed={muted}
                onClick={onToggleMute}
              >
                {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
              </Button>
              <Button type="button" variant="outline" size="icon-lg" aria-label="End voice" onClick={onEnd}>
                <Square aria-hidden />
              </Button>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        {persistent ? (
          <>
            Speak, then <span className="font-medium text-foreground">Send</span> — or wait a moment
            to auto-send.{" "}
            <kbd className="rounded border border-border bg-background px-1 py-0.5">Space</kbd> also
            sends when there is text.
          </>
        ) : (
          <>
            Hold <kbd className="rounded border border-border bg-background px-1 py-0.5">Space</kbd> to
            talk.
          </>
        )}
        {modeLabel ? ` · ${modeLabel}` : null}
      </p>
    </div>
  );
}
