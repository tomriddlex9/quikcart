"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, apiGetJson, type ApiMode } from "@/lib/api";
import {
  DEMO_LIVE_PIPELINE,
  DEMO_LIVE_SNAPSHOT,
  type LivePipeline,
  type LiveSnapshot,
} from "@/lib/live-types";

const PIPELINE_POLL_MS = 5_000;
const MAX_RECONNECT_MS = 10_000;

interface LiveStreamState {
  snapshot: LiveSnapshot | null;
  pipeline: LivePipeline | null;
  mode: ApiMode;
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Live API unreachable";
}

export function useLiveStream(): LiveStreamState {
  const [state, setState] = useState<LiveStreamState>({
    snapshot: null,
    pipeline: null,
    mode: "offline",
    error: null,
  });
  const hadSnapshot = useRef(false);
  const hadPipeline = useRef(false);
  const streamHealthy = useRef(false);
  const pipelineHealthy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let pipelineTimer: number | null = null;
    let reconnectAttempt = 0;

    const modeAfterFailure = (): ApiMode =>
      hadSnapshot.current || hadPipeline.current ? "stale" : "demo";

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(`${API_BASE}/api/v1/live/stream`);

      source.onopen = () => {
        streamHealthy.current = true;
        reconnectAttempt = 0;
      };

      source.onmessage = (event) => {
        try {
          const snapshot = JSON.parse(event.data) as LiveSnapshot;
          hadSnapshot.current = true;
          streamHealthy.current = true;
          reconnectAttempt = 0;
          setState((previous) => ({
            ...previous,
            snapshot,
            mode: pipelineHealthy.current || !hadPipeline.current ? "live" : "stale",
            error: pipelineHealthy.current || !hadPipeline.current ? null : previous.error,
          }));
        } catch (error) {
          setState((previous) => ({
            ...previous,
            mode: modeAfterFailure(),
            error: `Invalid live event: ${errorMessage(error)}`,
          }));
        }
      };

      source.onerror = () => {
        streamHealthy.current = false;
        source?.close();
        source = null;
        setState((previous) => ({
          ...previous,
          snapshot: hadSnapshot.current ? previous.snapshot : DEMO_LIVE_SNAPSHOT,
          mode: modeAfterFailure(),
          error: "Live stream disconnected",
        }));

        const delay = Math.min(1_000 * 2 ** reconnectAttempt, MAX_RECONNECT_MS);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    const pollPipeline = async () => {
      try {
        const pipeline = await apiGetJson<LivePipeline>("/api/v1/live/pipeline");
        if (cancelled) return;
        hadPipeline.current = true;
        pipelineHealthy.current = true;
        setState((previous) => ({
          ...previous,
          pipeline,
          mode: streamHealthy.current && hadSnapshot.current ? "live" : previous.mode,
          error: streamHealthy.current && hadSnapshot.current ? null : previous.error,
        }));
      } catch (error) {
        if (cancelled) return;
        pipelineHealthy.current = false;
        setState((previous) => ({
          ...previous,
          pipeline: hadPipeline.current ? previous.pipeline : DEMO_LIVE_PIPELINE,
          mode: modeAfterFailure(),
          error: errorMessage(error),
        }));
      } finally {
        if (!cancelled) {
          pipelineTimer = window.setTimeout(pollPipeline, PIPELINE_POLL_MS);
        }
      }
    };

    connect();
    void pollPipeline();

    return () => {
      cancelled = true;
      source?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (pipelineTimer !== null) window.clearTimeout(pipelineTimer);
    };
  }, []);

  return state;
}
