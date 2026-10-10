"use client";

import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/assistant/chat-dock/chat-panel";
import { PersonaBot } from "@/components/assistant/chat-dock/persona-bot";
import { PageHeader } from "@/components/page-header";
import { ProposalCard } from "@/components/proposal-card";
import { EmptyState, Loading } from "@/components/states";
import {
  chatActions,
  emotionFromVoicePhase,
  useChatSession,
} from "@/lib/assistant/chat-session";
import type { Proposal } from "@/lib/types";
import { useApiData } from "@/lib/use-api";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { isConnected } from "@/lib/voice/voice-machine";

const STATUS_TEXT = {
  off: "Opening voice…",
  connecting: "Connecting…",
  ready: "Listening for you…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Voice stopped.",
} as const;

export function OpsAgentView() {
  const [persona, setPersona] = useState("ops_manager");
  const session = useChatSession();
  const voice = useVoiceSession();
  const proposals = useApiData<Proposal[]>("/api/v1/proposals?status=PENDING");
  const pending = (proposals.data ?? []).filter((p) => p.status === "PENDING");

  useEffect(() => {
    chatActions.setHideFab(true);
    chatActions.setOpen(false);
    return () => chatActions.setHideFab(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/qc-api/v1/auth/me", { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { persona?: string } | null) => {
        if (body?.persona) setPersona(body.persona);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

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

  const voiceProps =
    voice.availability === "available"
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
          unsupportedReason:
            voice.availability === "unsupported"
              ? voice.unsupportedReason
              : "Voice needs VOICE_ENABLED and XAI_API_KEY (Grok) or GEMINI_API_KEY (Live).",
          modeLabel: voiceModeLabel,
          active: false,
          connected: false,
          listening: false,
          muted: false,
          canSend: false,
          phaseLabel: "Voice unavailable",
          onStart: () => undefined,
          onStop: () => undefined,
          onPttDown: () => undefined,
          onPttUp: () => undefined,
          onSend: () => undefined,
          onToggleListen: () => undefined,
          onInterrupt: () => undefined,
          onToggleMute: () => undefined,
        };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent console"
        description="Same floating assistant as the rest of ops — grounded tools, PENDING proposals only."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <ChatPanel
            persona={persona}
            experience="ops"
            variant="page"
            emotion={emotion}
            voice={voiceProps}
            className="flex-1"
          />
        </div>
        <aside className="space-y-4">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-5">
            <PersonaBot persona={persona} emotion={emotion} size={120} mouthSource={voice.getOutputLevel} />
            <p className="text-center text-xs text-muted-foreground">
              Corner bot stays with you on every ops screen.
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-medium">Pending proposals</h2>
            {proposals.mode === "offline" && !proposals.data ? <Loading label="Loading proposals" /> : null}
            {proposals.data && pending.length === 0 ? (
              <EmptyState title="No pending proposals" hint="Drafts from the assistant appear here." />
            ) : null}
            {pending.slice(0, 5).map((p) => (
              <ProposalCard key={p.proposal_id} proposal={p} demo={false} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
