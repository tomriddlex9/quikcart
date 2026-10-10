"use client";

// Voice session: Gemini Live when keyed; otherwise persistent Grok browser voice
// (continuous STT → agent → TTS → listen again).

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { startAudioCapture, type AudioCapture } from "@/lib/voice/audio-capture";
import { createAudioPlayer, type AudioPlayer } from "@/lib/voice/audio-player";
import { detectCapabilities, type VoiceCapabilities } from "@/lib/voice/capabilities";
import { browserSupportsGrokVoice } from "@/lib/voice/grok-speech";
import { GrokVoiceController } from "@/lib/voice/grok-voice-controller";
import { createLiveClient, type LiveClient, type LiveEvent } from "@/lib/voice/live-client";
import { createLevelStore, type LevelStore } from "@/lib/voice/level-store";
import { callTool, voiceApiRoot, type ToolBridgeResult } from "@/lib/voice/tool-bridge";
import {
  initialVoiceState,
  isConnected,
  orbStateFor,
  voiceReducer,
  type VoicePhase,
  type VoiceState,
} from "@/lib/voice/voice-machine";
import type { MatrixOrbState } from "@/components/ui/matrix-orb";

export type VoiceAvailability = "checking" | "unavailable" | "unsupported" | "available";
export type VoiceMode = "gemini_live" | "grok_browser" | "off";

interface VoiceSessionResponse {
  token: string;
  model: string;
  expires_at: string;
  ws_url: string;
  voice_session_id: string;
  max_session_seconds: number;
  mode?: VoiceMode;
}

interface VoiceStatusResponse {
  enabled: boolean;
  max_session_seconds: number;
  mode?: VoiceMode;
  provider?: string;
}

const DEFAULT_MAX_SECONDS = 600;

function credentials(): RequestCredentials {
  return process.env.NEXT_PUBLIC_API_BASE ? "include" : "same-origin";
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${voiceApiRoot()}${path}`, {
    ...init,
    credentials: credentials(),
    cache: "no-store",
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Non-JSON body.
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

function micMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access was blocked. Allow it in your browser and try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found.";
  return error instanceof Error ? error.message : "Voice could not start.";
}

export interface VoiceSession {
  availability: VoiceAvailability;
  unsupportedReason: string | null;
  mode: VoiceMode;
  provider: string | null;
  state: VoiceState;
  orbState: MatrixOrbState;
  /** Human-readable voice pipeline status for the UI. */
  statusDetail: string;
  getLevel: () => number;
  getOutputLevel: () => number;
  levels: LevelStore;
  maxSeconds: number;
  active: boolean;
  persistent: boolean;
  /** True when there is transcript ready to send (Grok). */
  canSend: boolean;
  start: () => void;
  stop: () => void;
  /** Grok Space shortcut / Gemini PTT down. */
  pttDown: () => void;
  pttUp: () => void;
  sendNow: () => void;
  toggleListen: () => void;
  interrupt: () => void;
  toggleMute: () => void;
}

export function useVoiceSession(): VoiceSession {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [availability, setAvailability] = useState<VoiceAvailability>("checking");
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [maxSeconds, setMaxSeconds] = useState(DEFAULT_MAX_SECONDS);
  const [mode, setMode] = useState<VoiceMode>("off");
  const [provider, setProvider] = useState<string | null>(null);
  const [statusDetail, setStatusDetail] = useState("Checking voice…");
  const [canSend, setCanSend] = useState(false);

  const levels = useRef<LevelStore>(createLevelStore()).current;
  const phaseRef = useRef<VoicePhase>("off");
  const mutedRef = useRef(false);
  const modeRef = useRef<VoiceMode>("off");
  const startingRef = useRef(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const clientRef = useRef<LiveClient | null>(null);
  const grokRef = useRef<GrokVoiceController | null>(null);
  const resumeRef = useRef<string | null>(null);
  const cancelledRef = useRef<Set<string>>(new Set());
  const runRef = useRef(0);
  const cleanupRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    phaseRef.current = state.phase;
    mutedRef.current = state.muted;
  }, [state.phase, state.muted]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<VoiceStatusResponse>("/voice/status", { signal: controller.signal })
      .then((status) => {
        const nextMode = (status.mode ?? (status.enabled ? "gemini_live" : "off")) as VoiceMode;
        setMode(nextMode);
        modeRef.current = nextMode;
        setProvider(status.provider ?? null);
        setMaxSeconds(status.max_session_seconds || DEFAULT_MAX_SECONDS);
        if (!status.enabled || nextMode === "off") {
          setAvailability("unavailable");
          setCapabilities({ supported: false, reason: "Voice is off on the server." });
          return;
        }
        if (nextMode === "grok_browser") {
          const grok = browserSupportsGrokVoice();
          setCapabilities({ supported: grok.ok, reason: grok.reason });
          setAvailability(grok.ok ? "available" : "unsupported");
          return;
        }
        const caps = detectCapabilities();
        setCapabilities(caps);
        setAvailability(caps.supported ? "available" : "unsupported");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  const teardown = useCallback(() => {
    runRef.current += 1;
    startingRef.current = false;
    grokRef.current?.stop();
    grokRef.current = null;
    clientRef.current?.close();
    clientRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    void capture?.stop();
    const player = playerRef.current;
    playerRef.current = null;
    void player?.close();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    cancelledRef.current.clear();
    levels.reset();
  }, [levels]);

  const stop = useCallback(() => {
    cleanupRef.current();
    cleanupRef.current = () => undefined;
    resumeRef.current = null;
    teardown();
    dispatch({ type: "stop" });
  }, [teardown]);

  const endWithNotice = useCallback(
    (notice: string, keepResume: boolean) => {
      cleanupRef.current();
      cleanupRef.current = () => undefined;
      if (!keepResume) resumeRef.current = null;
      teardown();
      dispatch({ type: "closed", notice });
    },
    [teardown],
  );

  const startGrok = useCallback(() => {
    if (startingRef.current) return;
    if (phaseRef.current !== "off" && phaseRef.current !== "error") return;
    startingRef.current = true;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    dispatch({ type: "start" });
    phaseRef.current = "connecting";

    void (async () => {
      try {
        const session = await fetchJson<VoiceSessionResponse>("/voice/session", { method: "POST" });
        if (!alive()) return;
        dispatch({ type: "connected", sessionId: session.voice_session_id || "grok-browser" });
        phaseRef.current = "ready";
        startingRef.current = false;

        const grok = new GrokVoiceController({
          onStatus: (status, detail) => {
            setStatusDetail(detail);
            switch (status) {
              case "listening":
              case "heard":
                if (phaseRef.current !== "listening") dispatch({ type: "mic_down" });
                break;
              case "thinking":
                setCanSend(false);
                dispatch({ type: "mic_up" });
                break;
              case "speaking":
                setCanSend(false);
                dispatch({ type: "audio" });
                break;
              case "paused":
                dispatch({ type: "idle" });
                break;
              case "error":
                setCanSend(false);
                break;
              default:
                break;
            }
          },
          onUserText: (text) => {
            setCanSend(Boolean(text.trim()));
            dispatch({ type: "input_transcript", text });
          },
          onAssistantText: (text) => {
            setCanSend(false);
            dispatch({ type: "output_transcript", text });
          },
          onLevel: (level) => levels.setInput(level),
          onError: (message) => {
            if (!alive()) return;
            setStatusDetail(message);
            setCanSend(false);
            grokRef.current?.stop();
            grokRef.current = null;
            startingRef.current = false;
            dispatch({ type: "error", message });
          },
        });
        grokRef.current = grok;
        grok.setTtsMuted(mutedRef.current);
        setStatusDetail("Starting microphone…");
        setCanSend(false);
        grok.start();

        const startedAt = Date.now();
        const limit = session.max_session_seconds || DEFAULT_MAX_SECONDS;
        const timer = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          dispatch({ type: "tick", elapsedSeconds: elapsed });
          if (elapsed >= limit) endWithNotice("Session time limit reached.", false);
        }, 1000);
        cleanupRef.current = () => clearInterval(timer);
      } catch (error) {
        if (!alive()) return;
        startingRef.current = false;
        teardown();
        dispatch({
          type: "error",
          message: error instanceof Error ? error.message : "Voice is unavailable.",
        });
      }
    })();
  }, [endWithNotice, levels, teardown]);

  const startGemini = useCallback(() => {
    if (startingRef.current) return;
    if (phaseRef.current !== "off" && phaseRef.current !== "error") return;
    startingRef.current = true;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    dispatch({ type: "start" });
    phaseRef.current = "connecting";

    let player: AudioPlayer;
    try {
      player = createAudioPlayer({ onDrained: () => dispatch({ type: "playback_drained" }) });
    } catch (error) {
      startingRef.current = false;
      dispatch({ type: "error", message: micMessage(error) });
      return;
    }
    player.setMuted(mutedRef.current);
    playerRef.current = player;

    const fail = (message: string) => {
      if (!alive()) return;
      startingRef.current = false;
      teardown();
      dispatch({ type: "error", message });
    };

    void (async () => {
      let session: VoiceSessionResponse;
      try {
        session = await fetchJson<VoiceSessionResponse>("/voice/session", { method: "POST" });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Voice is unavailable.");
        return;
      }
      if (!alive()) return;

      // Server chose Grok — switch without a second accidental Gemini path loop.
      if (session.mode === "grok_browser" || !session.ws_url) {
        startingRef.current = false;
        teardown();
        dispatch({ type: "stop" });
        modeRef.current = "grok_browser";
        setMode("grok_browser");
        startGrok();
        return;
      }

      const send = (pcm: Int16Array) => clientRef.current?.sendAudio(pcm);
      let capture: AudioCapture;
      try {
        capture = await startAudioCapture({ onFrame: send, onLevel: (v) => levels.setInput(v) });
      } catch (error) {
        fail(micMessage(error));
        return;
      }
      if (!alive()) {
        void capture.stop();
        return;
      }
      captureRef.current = capture;
      startingRef.current = false;

      const handleTools = (event: Extract<LiveEvent, { type: "tool_call" }>) => {
        event.calls.forEach(() => dispatch({ type: "tool_start" }));
        void Promise.all(
          event.calls.map(async (call): Promise<ToolBridgeResult | null> => {
            const result = await callTool(call);
            dispatch({ type: "tool_end" });
            return cancelledRef.current.delete(call.id) ? null : result;
          }),
        ).then((results) => {
          if (!alive()) return;
          clientRef.current?.sendToolResponses(results.filter((r): r is ToolBridgeResult => r !== null));
        });
      };

      const onEvent = (event: LiveEvent) => {
        if (!alive()) return;
        switch (event.type) {
          case "setup_complete":
            dispatch({ type: "connected", sessionId: session.voice_session_id });
            break;
          case "audio":
            if (phaseRef.current === "listening") break;
            playerRef.current?.enqueue(event.pcm, event.sampleRate);
            dispatch({ type: "audio" });
            break;
          case "input_transcript":
            dispatch({ type: "input_transcript", text: event.text });
            break;
          case "output_transcript":
            dispatch({ type: "output_transcript", text: event.text });
            break;
          case "turn_complete":
            dispatch({ type: "turn_complete" });
            break;
          case "interrupted":
            playerRef.current?.flush();
            dispatch({ type: "interrupted" });
            break;
          case "tool_call":
            handleTools(event);
            break;
          case "tool_cancel":
            event.ids.forEach((id) => cancelledRef.current.add(id));
            break;
          case "resumption":
            resumeRef.current = event.handle;
            break;
          case "go_away":
            endWithNotice("The voice service is ending this session. Start again to continue.", true);
            break;
        }
      };

      const client = createLiveClient({
        wsUrl: session.ws_url,
        token: session.token,
        model: session.model,
        resumeHandle: resumeRef.current,
        onEvent,
        onError: (message) => fail(message),
        onClose: ({ clean }) => {
          if (!alive() || !isConnected(phaseRef.current)) return;
          endWithNotice(clean ? "The voice session ended." : "The voice connection dropped.", !clean);
        },
      });
      clientRef.current = client;
      client.connect();

      let raf = 0;
      const pump = () => {
        levels.setOutput(playerRef.current?.getLevel() ?? 0);
        raf = requestAnimationFrame(pump);
      };
      raf = requestAnimationFrame(pump);
      const startedAt = Date.now();
      const limit = session.max_session_seconds || DEFAULT_MAX_SECONDS;
      const timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        dispatch({ type: "tick", elapsedSeconds: elapsed });
        if (elapsed >= limit) endWithNotice("Session time limit reached.", false);
      }, 1000);
      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        clearInterval(timer);
      };
    })();
  }, [endWithNotice, levels, startGrok, teardown]);

  const start = useCallback(() => {
    if (startingRef.current) return;
    if (phaseRef.current !== "off" && phaseRef.current !== "error") return;
    const m = modeRef.current;
    if (m === "grok_browser") {
      startGrok();
      return;
    }
    if (m === "gemini_live") {
      startGemini();
      return;
    }
    // Mode not resolved yet — prefer Grok when the browser supports it.
    if (browserSupportsGrokVoice().ok) startGrok();
    else startGemini();
  }, [startGemini, startGrok]);

  // Grok Space shortcut; Gemini classic PTT down.
  const pttDown = useCallback(() => {
    if (modeRef.current === "grok_browser") {
      grokRef.current?.handleSpace();
      return;
    }
    if (!isConnected(phaseRef.current) || phaseRef.current === "listening") return;
    playerRef.current?.flush();
    captureRef.current?.setActive(true);
    dispatch({ type: "mic_down" });
  }, []);

  const pttUp = useCallback(() => {
    if (modeRef.current === "grok_browser") return;
    if (phaseRef.current !== "listening") return;
    captureRef.current?.setActive(false);
    clientRef.current?.sendAudioEnd();
    dispatch({ type: "mic_up" });
  }, []);

  const sendNow = useCallback(() => {
    if (modeRef.current === "grok_browser") {
      grokRef.current?.sendNow();
      return;
    }
    pttUp();
  }, [pttUp]);

  const toggleListen = useCallback(() => {
    if (modeRef.current === "grok_browser") {
      grokRef.current?.toggleListen();
      return;
    }
    if (phaseRef.current === "listening") pttUp();
    else pttDown();
  }, [pttDown, pttUp]);

  const interrupt = useCallback(() => {
    if (modeRef.current === "grok_browser") {
      grokRef.current?.bargeIn();
      return;
    }
    playerRef.current?.flush();
    dispatch({ type: "interrupted" });
  }, []);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    playerRef.current?.setMuted(next);
    grokRef.current?.setTtsMuted(next);
    if (next && typeof window !== "undefined") window.speechSynthesis?.cancel();
    dispatch({ type: "toggle_mute" });
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current();
      teardown();
    };
  }, [teardown]);

  const getLevel = useCallback(
    () => (phaseRef.current === "listening" ? levels.getInput() : levels.getOutput()),
    [levels],
  );

  const persistent = mode === "grok_browser";

  return useMemo(
    () => ({
      availability,
      unsupportedReason: capabilities?.reason ?? null,
      mode,
      provider,
      state,
      orbState: orbStateFor(state.phase),
      statusDetail:
        state.phase === "error"
          ? (state.error ?? statusDetail)
          : statusDetail || STATUS_FALLBACK[state.phase] || "Ready",
      getLevel,
      getOutputLevel: levels.getOutput,
      levels,
      maxSeconds,
      active: state.phase !== "off" && state.phase !== "error",
      persistent,
      canSend,
      start,
      stop,
      pttDown,
      pttUp,
      sendNow,
      toggleListen,
      interrupt,
      toggleMute,
    }),
    [
      availability,
      capabilities,
      mode,
      provider,
      state,
      statusDetail,
      getLevel,
      levels,
      maxSeconds,
      persistent,
      canSend,
      start,
      stop,
      pttDown,
      pttUp,
      sendNow,
      toggleListen,
      interrupt,
      toggleMute,
    ],
  );
}

const STATUS_FALLBACK: Record<string, string> = {
  off: "Voice off",
  connecting: "Connecting…",
  ready: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Voice error",
};
