"use client";

// Floating voice assistant dock (bottom-right). Hidden unless the server reports voice as
// enabled for this user. Push-to-talk: hold the button (pointer or Space/Enter) and speak.

import Link from "next/link";
import { Mic, Square, Volume2, VolumeX, X } from "lucide-react";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { RareUiCredit } from "@/components/assistant/rare-ui-credit";
import { VoiceCharacter } from "@/components/assistant/voice-character";
import { MatrixOrb } from "@/components/ui/matrix-orb";
import { Button } from "@/components/ui/button";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { formatElapsed, isConnected, type VoicePhase } from "@/lib/voice/voice-machine";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<VoicePhase, string> = {
  off: "Tap start, then hold the button to talk.",
  connecting: "Connecting…",
  ready: "Hold the button and speak.",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Voice stopped.",
};

export default function CharacterDock() {
  const voice = useVoiceSession();
  const [open, setOpen] = useState(false);
  const { state } = voice;

  if (voice.availability === "checking" || voice.availability === "unavailable") return null;

  const connected = isConnected(state.phase);
  const listening = state.phase === "listening";

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      voice.pttDown();
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      voice.pttUp();
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    voice.pttDown();
  };

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col items-end gap-3 md:bottom-6 md:right-6">
      {open ? (
        <section
          role="dialog"
          aria-label="Voice assistant"
          className="pointer-events-auto w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-2xl bg-card p-4 text-card-foreground shadow-lg ring-1 ring-foreground/10"
        >
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Voice assistant</h2>
            <div className="flex items-center gap-1">
              {voice.active ? (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground" aria-label="Session time">
                  {formatElapsed(state.elapsedSeconds)} / {formatElapsed(voice.maxSeconds)}
                </span>
              ) : null}
              <Button variant="ghost" size="icon-xs" aria-label="Close voice panel" onClick={() => setOpen(false)}>
                <X aria-hidden />
              </Button>
            </div>
          </header>

          {voice.availability === "unsupported" ? (
            <div className="space-y-2 py-2 text-[13px] text-muted-foreground">
              <p>{voice.unsupportedReason ?? "Voice is not supported here."}</p>
              <p>
                You can still{" "}
                <Link href="/b/ask" className="underline underline-offset-2" onClick={() => setOpen(false)}>
                  type your question
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <VoiceCharacter
                  state={voice.orbState}
                  levelSource={voice.getLevel}
                  mouthSource={voice.getOutputLevel}
                  size={132}
                />
              </div>

              <p className="text-center text-[13px] text-muted-foreground" role="status">
                {state.phase === "error" ? (state.error ?? STATUS_TEXT.error) : (state.notice && !voice.active ? state.notice : STATUS_TEXT[state.phase])}
              </p>

              <div className="min-h-[3.5rem] space-y-1 text-[13px]" aria-live="polite" aria-label="Captions">
                {state.caption.user ? <p className="text-muted-foreground">You: {state.caption.user}</p> : null}
                {state.caption.assistant ? <p>{state.caption.assistant}</p> : null}
              </div>

              <div className="flex items-center gap-2">
                {voice.active ? (
                  <>
                    <Button
                      type="button"
                      variant={listening ? "default" : "secondary"}
                      className="h-9 flex-1 touch-none select-none"
                      disabled={!connected}
                      aria-pressed={listening}
                      onPointerDown={onPointerDown}
                      onPointerUp={voice.pttUp}
                      onPointerCancel={voice.pttUp}
                      onKeyDown={onKeyDown}
                      onKeyUp={onKeyUp}
                      onBlur={voice.pttUp}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <Mic aria-hidden />
                      {listening ? "Release to send" : "Hold to talk"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      aria-label={state.muted ? "Unmute assistant voice" : "Mute assistant voice"}
                      aria-pressed={state.muted}
                      onClick={voice.toggleMute}
                    >
                      {state.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
                    </Button>
                    <Button type="button" variant="outline" size="icon-lg" aria-label="End voice session" onClick={voice.stop}>
                      <Square aria-hidden />
                    </Button>
                  </>
                ) : (
                  <Button type="button" className="h-9 flex-1" onClick={voice.start}>
                    <Mic aria-hidden />
                    {state.phase === "error" ? "Try again" : "Start talking"}
                  </Button>
                )}
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                English only. Sessions end after {formatElapsed(voice.maxSeconds)}.
              </p>
            </>
          )}
          <RareUiCredit className="text-center" />
        </section>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={voice.active ? "Open voice assistant (session active)" : "Open voice assistant"}
          className={cn(
            "pointer-events-auto grid size-14 place-items-center rounded-full bg-card shadow-md ring-1 ring-foreground/15 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            voice.active && "ring-2 ring-foreground/40",
          )}
        >
          <MatrixOrb state={voice.orbState} levelSource={voice.getLevel} size={44} dots={13} />
        </button>
      ) : null}
    </div>
  );
}
