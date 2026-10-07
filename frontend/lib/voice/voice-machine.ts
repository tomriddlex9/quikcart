// Pure reducer for the voice session UI state. No timers, no I/O — the hook feeds it events.

import type { MatrixOrbState } from "@/components/ui/matrix-orb";

export type VoicePhase =
  | "off" // no session
  | "connecting" // minting token / opening socket / waiting for setup
  | "ready" // connected, idle
  | "listening" // push-to-talk held, mic streaming
  | "thinking" // waiting on the model or a tool
  | "speaking" // assistant audio playing
  | "error";

export interface VoiceState {
  phase: VoicePhase;
  /** Speaker mute (assistant audio is silenced; captions keep flowing). */
  muted: boolean;
  elapsedSeconds: number;
  pendingTools: number;
  /** Assistant audio is still queued/playing. */
  playing: boolean;
  /** The model finished its turn (audio may still be draining). */
  turnDone: boolean;
  caption: { user: string; assistant: string };
  userClosed: boolean;
  assistantClosed: boolean;
  error: string | null;
  /** Why the last session ended (session limit, server goAway, …). */
  notice: string | null;
  sessionId: string | null;
}

export type VoiceAction =
  | { type: "start" }
  | { type: "connected"; sessionId?: string }
  | { type: "mic_down" }
  | { type: "mic_up" }
  | { type: "audio" }
  | { type: "playback_drained" }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "tool_start" }
  | { type: "tool_end" }
  | { type: "input_transcript"; text: string }
  | { type: "output_transcript"; text: string }
  | { type: "toggle_mute" }
  | { type: "tick"; elapsedSeconds: number }
  | { type: "error"; message: string }
  | { type: "closed"; notice?: string }
  | { type: "stop" };

export const initialVoiceState: VoiceState = {
  phase: "off",
  muted: false,
  elapsedSeconds: 0,
  pendingTools: 0,
  playing: false,
  turnDone: false,
  caption: { user: "", assistant: "" },
  userClosed: false,
  assistantClosed: false,
  error: null,
  notice: null,
  sessionId: null,
};

const CONNECTED: ReadonlySet<VoicePhase> = new Set(["ready", "listening", "thinking", "speaking"]);

export function isConnected(phase: VoicePhase): boolean {
  return CONNECTED.has(phase);
}

/** connecting/thinking → thinking; mic → listening; speaking → speaking; the rest idle. */
export function orbStateFor(phase: VoicePhase): MatrixOrbState {
  switch (phase) {
    case "connecting":
    case "thinking":
      return "thinking";
    case "listening":
      return "listening";
    case "speaking":
      return "speaking";
    default:
      return "idle";
  }
}

export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Leave `speaking` once the model is done and the player has drained. */
function settle(state: VoiceState): VoiceState {
  if (state.phase === "speaking" && state.turnDone && !state.playing) {
    return { ...state, phase: state.pendingTools > 0 ? "thinking" : "ready" };
  }
  return state;
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "start":
      if (state.phase !== "off" && state.phase !== "error") return state;
      return { ...initialVoiceState, muted: state.muted, phase: "connecting" };

    case "connected":
      if (state.phase !== "connecting") return state;
      return { ...state, phase: "ready", sessionId: action.sessionId ?? state.sessionId };

    case "mic_down":
      if (!isConnected(state.phase)) return state;
      // Barge-in: holding the button while the assistant talks hands the turn to the user.
      return { ...state, phase: "listening", playing: false, turnDone: false, userClosed: true };

    case "mic_up":
      if (state.phase !== "listening") return state;
      return { ...state, phase: "thinking" };

    case "audio": {
      if (!isConnected(state.phase)) return state;
      if (state.playing && !state.turnDone && state.phase !== "ready") return state; // per-chunk no-op
      const base = { ...state, playing: true, turnDone: false, userClosed: true };
      return state.phase === "listening" ? base : { ...base, phase: "speaking" };
    }

    case "playback_drained":
      return settle({ ...state, playing: false });

    case "turn_complete": {
      if (!isConnected(state.phase)) return state;
      const next = { ...state, turnDone: true, assistantClosed: true };
      if (state.phase === "thinking" && state.pendingTools === 0) return { ...next, phase: "ready" };
      return settle(next);
    }

    case "interrupted":
      if (!isConnected(state.phase)) return state;
      return {
        ...state,
        phase: state.phase === "listening" ? "listening" : "ready",
        playing: false,
        turnDone: false,
        assistantClosed: true,
      };

    case "tool_start":
      if (!isConnected(state.phase)) return state;
      return {
        ...state,
        pendingTools: state.pendingTools + 1,
        phase: state.phase === "listening" ? "listening" : "thinking",
      };

    case "tool_end": {
      const pendingTools = Math.max(0, state.pendingTools - 1);
      return { ...state, pendingTools };
    }

    case "input_transcript": {
      if (!action.text) return state;
      const user = state.userClosed ? action.text : state.caption.user + action.text;
      return {
        ...state,
        userClosed: false,
        caption: { user, assistant: state.userClosed ? "" : state.caption.assistant },
      };
    }

    case "output_transcript": {
      if (!action.text) return state;
      const assistant = state.assistantClosed ? action.text : state.caption.assistant + action.text;
      return {
        ...state,
        userClosed: true,
        assistantClosed: false,
        caption: { ...state.caption, assistant },
      };
    }

    case "toggle_mute":
      return { ...state, muted: !state.muted };

    case "tick":
      return state.phase === "off" ? state : { ...state, elapsedSeconds: action.elapsedSeconds };

    case "error":
      return { ...state, phase: "error", error: action.message, playing: false, pendingTools: 0 };

    case "closed":
      if (state.phase === "off" || state.phase === "error") return state;
      return {
        ...initialVoiceState,
        muted: state.muted,
        caption: state.caption,
        notice: action.notice ?? null,
      };

    case "stop":
      return { ...initialVoiceState, muted: state.muted, caption: state.caption };

    default:
      return state;
  }
}
