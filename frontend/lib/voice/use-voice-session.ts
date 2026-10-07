"use client";

// Orchestrates one Gemini Live voice session: token → player → mic → socket → tools.
// UI state lives in `voiceReducer`; audio levels live in a ref store (never React state).

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { startAudioCapture, type AudioCapture } from "@/lib/voice/audio-capture";
import { createAudioPlayer, type AudioPlayer } from "@/lib/voice/audio-player";
import { detectCapabilities, type VoiceCapabilities } from "@/lib/voice/capabilities";
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

interface VoiceSessionResponse {
  token: string;
  model: string;
  expires_at: string;
  ws_url: string;
  voice_session_id: string;
  max_session_seconds: number;
}

interface VoiceStatusResponse {
  enabled: boolean;
  max_session_seconds: number;
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
  state: VoiceState;
  orbState: MatrixOrbState;
  /** 0..1 level for the orb/mouth: mic while listening, assistant audio otherwise. */
  getLevel: () => number;
  getOutputLevel: () => number;
  levels: LevelStore;
  maxSeconds: number;
  active: boolean;
  start: () => void;
  stop: () => void;
  pttDown: () => void;
  pttUp: () => void;
  toggleMute: () => void;
}

export function useVoiceSession(): VoiceSession {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [availability, setAvailability] = useState<VoiceAvailability>("checking");
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [maxSeconds, setMaxSeconds] = useState(DEFAULT_MAX_SECONDS);

  const levels = useRef<LevelStore>(createLevelStore()).current;
  const phaseRef = useRef<VoicePhase>("off");
  const mutedRef = useRef(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const clientRef = useRef<LiveClient | null>(null);
  const resumeRef = useRef<string | null>(null);
  const cancelledRef = useRef<Set<string>>(new Set());
  const runRef = useRef(0); // invalidates in-flight async work from a previous session
  const cleanupRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    phaseRef.current = state.phase;
    mutedRef.current = state.muted;
  }, [state.phase, state.muted]);

  // Availability: server flag + permission, then browser capabilities.
  useEffect(() => {
    const caps = detectCapabilities();
    setCapabilities(caps);
    const controller = new AbortController();
    fetchJson<VoiceStatusResponse>("/voice/status", { signal: controller.signal })
      .then((status) => {
        setMaxSeconds(status.max_session_seconds || DEFAULT_MAX_SECONDS);
        setAvailability(status.enabled ? (caps.supported ? "available" : "unsupported") : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  const teardown = useCallback(() => {
    runRef.current += 1;
    clientRef.current?.close();
    clientRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    void capture?.stop();
    const player = playerRef.current;
    playerRef.current = null;
    void player?.close();
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

  const start = useCallback(() => {
    if (phaseRef.current !== "off" && phaseRef.current !== "error") return;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    dispatch({ type: "start" });
    phaseRef.current = "connecting";

    // Created inside the click handler so the browser allows playback.
    let player: AudioPlayer;
    try {
      player = createAudioPlayer({ onDrained: () => dispatch({ type: "playback_drained" }) });
    } catch (error) {
      dispatch({ type: "error", message: micMessage(error) });
      return;
    }
    player.setMuted(mutedRef.current);
    playerRef.current = player;

    const fail = (message: string) => {
      if (!alive()) return;
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
            if (phaseRef.current === "listening") break; // user has the floor
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

      // Output level pump + session clock.
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
  }, [endWithNotice, levels, teardown]);

  const pttDown = useCallback(() => {
    if (!isConnected(phaseRef.current) || phaseRef.current === "listening") return;
    playerRef.current?.flush(); // barge-in
    captureRef.current?.setActive(true);
    dispatch({ type: "mic_down" });
  }, []);

  const pttUp = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    captureRef.current?.setActive(false);
    clientRef.current?.sendAudioEnd();
    dispatch({ type: "mic_up" });
  }, []);

  const toggleMute = useCallback(() => {
    playerRef.current?.setMuted(!mutedRef.current);
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

  return useMemo(
    () => ({
      availability,
      unsupportedReason: capabilities?.reason ?? null,
      state,
      orbState: orbStateFor(state.phase),
      getLevel,
      getOutputLevel: levels.getOutput,
      levels,
      maxSeconds,
      active: state.phase !== "off" && state.phase !== "error",
      start,
      stop,
      pttDown,
      pttUp,
      toggleMute,
    }),
    [availability, capabilities, state, getLevel, levels, maxSeconds, start, stop, pttDown, pttUp, toggleMute],
  );
}
