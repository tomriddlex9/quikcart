// Gemini Live WebSocket client (ephemeral-token, constrained endpoint).
//
// State machine: idle → connecting → setup → open → closed. `open` starts only after the
// server's `setupComplete`. The token locks model/tools/config server-side, so the setup
// message only names the model (extra fields are overridden by the token's constraints).

import { INPUT_MIME, base64ToInt16, int16ToBase64, rateFromMime } from "@/lib/voice/pcm";
import type { ToolBridgeResult, ToolCall } from "@/lib/voice/tool-bridge";

export type LiveStatus = "idle" | "connecting" | "setup" | "open" | "closed";

export type LiveEvent =
  | { type: "setup_complete" }
  | { type: "audio"; pcm: Int16Array; sampleRate: number }
  | { type: "input_transcript"; text: string }
  | { type: "output_transcript"; text: string }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "tool_call"; calls: ToolCall[] }
  | { type: "tool_cancel"; ids: string[] }
  | { type: "go_away"; timeLeftMs: number | null }
  | { type: "resumption"; handle: string };

interface RawPart {
  inlineData?: { data?: string; mimeType?: string };
}
interface RawMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: RawPart[] };
    turnComplete?: boolean;
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
}

/** "12s" / "1.5s" → milliseconds. */
export function parseDuration(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value ?? "");
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

/** One raw server message → zero or more typed events (pure; exported for tests). */
export function parseServerMessage(message: RawMessage): LiveEvent[] {
  const events: LiveEvent[] = [];
  if (message.setupComplete !== undefined) events.push({ type: "setup_complete" });

  const content = message.serverContent;
  if (content) {
    if (content.interrupted) events.push({ type: "interrupted" });
    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data && (inline.mimeType ?? "").startsWith("audio/")) {
        events.push({
          type: "audio",
          pcm: base64ToInt16(inline.data),
          sampleRate: rateFromMime(inline.mimeType),
        });
      }
    }
    if (content.inputTranscription?.text) {
      events.push({ type: "input_transcript", text: content.inputTranscription.text });
    }
    if (content.outputTranscription?.text) {
      events.push({ type: "output_transcript", text: content.outputTranscription.text });
    }
    if (content.turnComplete) events.push({ type: "turn_complete" });
  }

  const calls = message.toolCall?.functionCalls;
  if (calls?.length) {
    events.push({
      type: "tool_call",
      calls: calls
        .filter((c) => c.name)
        .map((c, i) => ({ id: c.id ?? `call-${i}`, name: c.name as string, args: c.args ?? {} })),
    });
  }
  if (message.toolCallCancellation?.ids?.length) {
    events.push({ type: "tool_cancel", ids: message.toolCallCancellation.ids });
  }
  if (message.goAway) events.push({ type: "go_away", timeLeftMs: parseDuration(message.goAway.timeLeft) });
  const update = message.sessionResumptionUpdate;
  if (update?.newHandle && update.resumable !== false) {
    events.push({ type: "resumption", handle: update.newHandle });
  }
  return events;
}

export function buildSetupMessage(model: string, resumeHandle?: string | null): Record<string, unknown> {
  const name = model.startsWith("models/") ? model : `models/${model}`;
  const setup: Record<string, unknown> = {
    model: name,
    generationConfig: { responseModalities: ["AUDIO"] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
  if (resumeHandle) setup.sessionResumption = { handle: resumeHandle };
  return { setup };
}

export function buildToolResponseMessage(results: ToolBridgeResult[]): Record<string, unknown> {
  return {
    toolResponse: {
      functionResponses: results.map((r) => ({
        id: r.id,
        name: r.name,
        response: r.response,
        scheduling: r.scheduling,
      })),
    },
  };
}

export interface LiveClientOptions {
  wsUrl: string;
  token: string;
  model: string;
  resumeHandle?: string | null;
  onEvent: (event: LiveEvent) => void;
  onStatus?: (status: LiveStatus) => void;
  onClose: (info: { code: number; reason: string; clean: boolean }) => void;
  onError: (message: string) => void;
}

export interface LiveClient {
  status: () => LiveStatus;
  connect: () => void;
  sendAudio: (pcm: Int16Array) => void;
  sendAudioEnd: () => void;
  sendToolResponses: (results: ToolBridgeResult[]) => void;
  close: (code?: number, reason?: string) => void;
}

const SETUP_TIMEOUT_MS = 12_000;

async function decode(data: unknown): Promise<RawMessage | null> {
  try {
    if (typeof data === "string") return JSON.parse(data) as RawMessage;
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data)) as RawMessage;
    if (typeof Blob !== "undefined" && data instanceof Blob) return JSON.parse(await data.text()) as RawMessage;
  } catch {
    // Malformed frame: ignore, the socket stays up.
  }
  return null;
}

export function createLiveClient(options: LiveClientOptions): LiveClient {
  let socket: WebSocket | null = null;
  let status: LiveStatus = "idle";
  let setupTimer: ReturnType<typeof setTimeout> | null = null;
  // Blob decoding is async; chain handling so events keep arrival order.
  let chain: Promise<void> = Promise.resolve();

  const setStatus = (next: LiveStatus) => {
    status = next;
    options.onStatus?.(next);
  };
  const clearSetupTimer = () => {
    if (setupTimer) clearTimeout(setupTimer);
    setupTimer = null;
  };
  const send = (payload: Record<string, unknown>) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  return {
    status: () => status,
    connect: () => {
      if (status !== "idle") return;
      setStatus("connecting");
      const url = `${options.wsUrl}?access_token=${encodeURIComponent(options.token)}`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      socket = ws;
      ws.onopen = () => {
        setStatus("setup");
        send(buildSetupMessage(options.model, options.resumeHandle));
        setupTimer = setTimeout(() => {
          options.onError("The voice service did not respond in time.");
          ws.close(4000, "setup timeout");
        }, SETUP_TIMEOUT_MS);
      };
      ws.onmessage = (event: MessageEvent) => {
        chain = chain.then(async () => {
          const message = await decode(event.data);
          if (!message) return;
          for (const parsed of parseServerMessage(message)) {
            if (parsed.type === "setup_complete") {
              clearSetupTimer();
              setStatus("open");
            }
            options.onEvent(parsed);
          }
        });
      };
      ws.onerror = () => options.onError("The voice connection failed.");
      ws.onclose = (event) => {
        clearSetupTimer();
        setStatus("closed");
        options.onClose({ code: event.code, reason: event.reason, clean: event.wasClean });
      };
    },
    sendAudio: (pcm) => {
      if (status !== "open") return;
      send({ realtimeInput: { audio: { data: int16ToBase64(pcm), mimeType: INPUT_MIME } } });
    },
    sendAudioEnd: () => {
      if (status === "open") send({ realtimeInput: { audioStreamEnd: true } });
    },
    sendToolResponses: (results) => {
      if (status === "open" && results.length) send(buildToolResponseMessage(results));
    },
    close: (code = 1000, reason = "client closed") => {
      clearSetupTimer();
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(code, reason);
      else if (status !== "closed") setStatus("closed");
    },
  };
}
