"use client";

/**
 * Shared chat session for the floating ChatDock and expanded Ask/Agent pages.
 * Survives client-side navigations via module state + sessionStorage.
 */

import { useSyncExternalStore } from "react";
import {
  streamAgentChat,
  type AgentStreamStage,
  type ThinkingStep,
} from "@/lib/agent-stream";
import type { AssistantCard, Provenance } from "@/lib/assistant/types";
import { API_BASE } from "@/lib/api";
import { botStyleFor, STAGE_LABEL } from "@/components/assistant/chat-dock/bot-catalog";
import {
  clearLocalMemories,
  memoryPayload,
} from "@/lib/assistant/chat-memory";

export type ChatEmotion = "idle" | "listen" | "think" | "speak" | "error";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  failed?: boolean;
  cards?: AssistantCard[];
  followups?: string[];
  provenance?: Provenance | null;
  tools?: string[];
  working?: string | null;
  model?: string | null;
  thinking?: ThinkingStep[];
  botId?: string;
}

export type ChatPanelMode = "text" | "voice";

export interface ChatSessionState {
  sessionId: string;
  messages: ChatMessage[];
  draft: string;
  busy: boolean;
  stage: AgentStreamStage | null;
  stageDetail: string | null;
  emotion: ChatEmotion;
  open: boolean;
  hideFab: boolean;
  panelMode: ChatPanelMode;
  ttsEnabled: boolean;
  openMic: boolean;
  ready: boolean | null;
  readyModel: string | null;
  botId: string;
  pickerOpen: boolean;
  memoryOpen: boolean;
}

const STORAGE_KEY = "qc_chat_session_v1";

type Listener = () => void;

let nextMsgId = 1;
let thinkSeq = 0;
let abort: AbortController | null = null;
const listeners = new Set<Listener>();

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `qc-${crypto.randomUUID()}`;
  }
  return `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadPersisted(): Pick<
  ChatSessionState,
  "sessionId" | "messages" | "ttsEnabled" | "botId"
> | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      sessionId?: string;
      messages?: ChatMessage[];
      ttsEnabled?: boolean;
      botId?: string;
    };
    if (!parsed.sessionId || !Array.isArray(parsed.messages)) return null;
    const maxId = parsed.messages.reduce((m, msg) => Math.max(m, msg.id), 0);
    nextMsgId = Math.max(nextMsgId, maxId + 1);
    return {
      sessionId: parsed.sessionId,
      messages: parsed.messages.map((m) => ({ ...m, pending: false })),
      ttsEnabled: Boolean(parsed.ttsEnabled),
      botId: parsed.botId && botStyleFor(parsed.botId).id === parsed.botId
        ? parsed.botId
        : "business_exec",
    };
  } catch {
    return null;
  }
}

const persisted = loadPersisted();

let state: ChatSessionState = {
  sessionId: persisted?.sessionId ?? newSessionId(),
  messages: persisted?.messages ?? [],
  draft: "",
  busy: false,
  stage: null,
  stageDetail: null,
  emotion: "idle",
  open: false,
  hideFab: false,
  panelMode: "text",
  ttsEnabled: persisted?.ttsEnabled ?? false,
  openMic: false,
  ready: null,
  readyModel: null,
  botId: persisted?.botId ?? "business_exec",
  pickerOpen: false,
  memoryOpen: false,
};

function emit() {
  for (const l of listeners) l();
}

function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: state.sessionId,
        messages: state.messages.filter((m) => !m.pending),
        ttsEnabled: state.ttsEnabled,
        botId: state.botId,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

function setState(patch: Partial<ChatSessionState>) {
  state = { ...state, ...patch };
  emit();
}

function patchMessage(id: number, fn: (m: ChatMessage) => ChatMessage) {
  state = {
    ...state,
    messages: state.messages.map((m) => (m.id === id ? fn(m) : m)),
  };
  emit();
}

function pushThinking(
  id: number,
  step: Omit<ThinkingStep, "id" | "at"> & { id?: string },
) {
  thinkSeq += 1;
  const entry: ThinkingStep = {
    id: step.id ?? `t-${thinkSeq}`,
    stage: step.stage,
    label: step.label,
    detail: step.detail,
    at: Date.now(),
  };
  patchMessage(id, (m) => {
    const prev = m.thinking ?? [];
    const last = prev[prev.length - 1];
    if (
      last &&
      last.stage === entry.stage &&
      last.label === entry.label &&
      last.detail === entry.detail
    ) {
      return m;
    }
    return { ...m, thinking: [...prev, entry].slice(-12) };
  });
}

function speakText(text: string) {
  if (!state.ttsEnabled || typeof window === "undefined" || !window.speechSynthesis) return;
  const clean = text.trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1.05;
  window.speechSynthesis.speak(utter);
}

export function getChatSessionSnapshot(): ChatSessionState {
  return state;
}

export function subscribeChatSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatSession(): ChatSessionState {
  return useSyncExternalStore(subscribeChatSession, getChatSessionSnapshot, getChatSessionSnapshot);
}

export const chatActions = {
  setOpen(open: boolean) {
    setState({ open });
  },
  setHideFab(hideFab: boolean) {
    setState({ hideFab });
  },
  setDraft(draft: string) {
    setState({ draft });
  },
  setPanelMode(panelMode: ChatPanelMode) {
    setState({ panelMode });
  },
  setTtsEnabled(ttsEnabled: boolean) {
    setState({ ttsEnabled });
    persist();
  },
  setOpenMic(openMic: boolean) {
    setState({ openMic });
  },
  setEmotion(emotion: ChatEmotion) {
    setState({ emotion });
  },
  setBotId(botId: string) {
    if (!botStyleFor(botId) || botStyleFor(botId).id !== botId) return;
    setState({ botId, pickerOpen: false });
    persist();
  },
  setPickerOpen(pickerOpen: boolean) {
    setState({ pickerOpen: pickerOpen, memoryOpen: pickerOpen ? false : state.memoryOpen });
  },
  setMemoryOpen(memoryOpen: boolean) {
    setState({ memoryOpen, pickerOpen: memoryOpen ? false : state.pickerOpen });
  },
  ensureBotForExperience(side: "business" | "ops", persona?: string | null) {
    const current = botStyleFor(state.botId);
    if (current.side === side) return;
    const next =
      persona && botStyleFor(persona).side === side
        ? persona
        : side === "ops"
          ? "ops_manager"
          : "business_exec";
    setState({ botId: next });
    persist();
  },
  /** Wipe messages in the current chat; keep session id and global memories. */
  clearChat() {
    abort?.abort();
    abort = null;
    clearLocalMemories(state.sessionId);
    setState({
      messages: [],
      draft: "",
      busy: false,
      stage: null,
      stageDetail: null,
      emotion: "idle",
      memoryOpen: false,
    });
    persist();
  },
  /** Start a fresh chat session (new id); global memories stay. */
  newChat() {
    abort?.abort();
    abort = null;
    const nextId = newSessionId();
    setState({
      sessionId: nextId,
      messages: [],
      draft: "",
      busy: false,
      stage: null,
      stageDetail: null,
      emotion: "idle",
      memoryOpen: false,
    });
    persist();
  },
  /** @deprecated use newChat — kept for existing tests */
  clear() {
    chatActions.newChat();
  },
  async warmReady() {
    if (state.ready !== null) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/agent/ready`, { cache: "no-store" });
      if (!res.ok) {
        setState({ ready: false, readyModel: null });
        return;
      }
      const body = (await res.json()) as { ready?: boolean; model?: string | null };
      setState({ ready: Boolean(body.ready), readyModel: body.model ?? null });
    } catch {
      setState({ ready: false, readyModel: null });
    }
  },
  async send(
    question: string,
    opts?: { demo?: boolean; sampleAnswer?: string; skipTts?: boolean },
  ): Promise<string | null> {
    const text = question.trim();
    if (!text) return null;
    if (state.busy) return null;
    const userId = nextMsgId++;
    const assistantId = nextMsgId++;
    const botId = state.botId;
    const history = state.messages
      .filter((m) => !m.pending && !m.failed && m.text.trim())
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));
    const memories = memoryPayload(state.sessionId);
    setState({
      draft: "",
      busy: true,
      open: true,
      stage: "listening",
      stageDetail: `${botStyleFor(botId).displayName} received your question`,
      emotion: "think",
      messages: [
        ...state.messages,
        { id: userId, role: "user", text },
        {
          id: assistantId,
          role: "assistant",
          text: "",
          pending: true,
          thinking: [],
          botId,
        },
      ],
    });

    if (opts?.demo) {
      const bot = botStyleFor(botId);
      patchMessage(assistantId, (m) => ({
        ...m,
        text:
          opts.sampleAnswer ??
          `Sample answer from ${bot.displayName} (${bot.blurb}). Connect live data for real numbers.`,
        pending: false,
        thinking: [
          {
            id: "demo-1",
            stage: "listening",
            label: "Received",
            detail: "Demo mode — no live tools",
            at: Date.now(),
          },
        ],
      }));
      setState({ busy: false, stage: null, stageDetail: null, emotion: "idle" });
      persist();
      return getChatSessionSnapshot().messages.find((m) => m.id === assistantId)?.text ?? null;
    }

    abort?.abort();
    abort = new AbortController();
    await streamAgentChat(
      text,
      state.sessionId,
      {
        onStatus: (stage, model, meta) => {
          const emotion: ChatEmotion =
            stage === "listening"
              ? "listen"
              : stage === "answer"
                ? "speak"
                : "think";
          const detail =
            meta?.detail ||
            meta?.reasoning ||
            STAGE_LABEL[stage] ||
            stage;
          setState({ stage, stageDetail: detail, emotion });
          pushThinking(assistantId, {
            stage,
            label: STAGE_LABEL[stage] ?? stage,
            detail: meta?.reasoning || meta?.detail,
          });
          if (model) {
            patchMessage(assistantId, (m) => ({ ...m, model: model ?? m.model }));
          }
        },
        onToolStart: (tool) => {
          patchMessage(assistantId, (m) => ({
            ...m,
            working: tool.name,
            tools: m.tools?.includes(tool.name) ? m.tools : [...(m.tools ?? []), tool.name],
          }));
          pushThinking(assistantId, {
            stage: "tool",
            label: tool.name,
            detail: "Starting…",
          });
        },
        onTool: (tool) => {
          patchMessage(assistantId, (m) => ({
            ...m,
            working: tool.name,
            tools: m.tools?.includes(tool.name) ? m.tools : [...(m.tools ?? []), tool.name],
          }));
          pushThinking(assistantId, {
            stage: "tool",
            label: tool.name,
            detail: tool.summary || (tool.ok ? "ok" : "failed"),
          });
        },
        onToken: (t) => {
          setState({ emotion: "speak", stage: "answer", stageDetail: "Writing answer" });
          patchMessage(assistantId, (m) => ({ ...m, text: m.text + t }));
        },
        onCard: (card) =>
          patchMessage(assistantId, (m) => ({ ...m, cards: [...(m.cards ?? []), card] })),
        onFollowups: (items) => patchMessage(assistantId, (m) => ({ ...m, followups: items })),
        onDone: (payload) => {
          patchMessage(assistantId, (m) => ({
            ...m,
            text: payload.answer || m.text,
            cards: payload.cards.length > 0 ? payload.cards : m.cards,
            followups: payload.followups.length > 0 ? payload.followups : m.followups,
            provenance: payload.provenance,
            model: payload.model ?? m.model,
            pending: false,
            working: null,
          }));
          if (
            !opts?.skipTts &&
            getChatSessionSnapshot().ttsEnabled &&
            payload.answer
          ) {
            speakText(payload.answer);
          }
        },
        onError: () =>
          patchMessage(assistantId, (m) => ({
            ...m,
            pending: false,
            failed: true,
            text:
              m.text ||
              "The assistant isn't connected yet. Set XAI_API_KEY on the API, then try again.",
          })),
      },
      abort.signal,
      { botId, history, memories },
    );
    const last = getChatSessionSnapshot().messages.find((m) => m.id === assistantId);
    if (last?.pending) {
      patchMessage(assistantId, (m) => ({ ...m, pending: false }));
    }
    setState({
      busy: false,
      stage: null,
      stageDetail: null,
      emotion: last?.failed ? "error" : "idle",
    });
    persist();
    if (last?.failed) return null;
    return (last?.text ?? "").trim() || null;
  },
};

export function emotionFromVoicePhase(
  phase: string,
  textBusy: boolean,
): ChatEmotion {
  if (textBusy && phase === "off") return getChatSessionSnapshot().emotion;
  switch (phase) {
    case "listening":
      return "listen";
    case "thinking":
    case "connecting":
      return "think";
    case "speaking":
      return "speak";
    case "error":
      return "error";
    default:
      return textBusy ? "think" : "idle";
  }
}
