import { describe, expect, it } from "vitest";
import { evaluateCapabilities } from "@/lib/voice/capabilities";
import { createLevelStore } from "@/lib/voice/level-store";
import {
  buildSetupMessage,
  buildToolResponseMessage,
  parseDuration,
  parseServerMessage,
} from "@/lib/voice/live-client";
import {
  base64ToInt16,
  floatToInt16,
  int16ToBase64,
  int16ToFloat,
  normalizeLevel,
  rateFromMime,
  resampleLinear,
  rms,
  rmsInt16,
} from "@/lib/voice/pcm";
import { toolUrl } from "@/lib/voice/tool-bridge";

describe("pcm helpers", () => {
  it("converts float ↔ int16 with clipping", () => {
    const pcm = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    const back = int16ToFloat(pcm);
    expect(back[1]).toBeCloseTo(1, 4);
    expect(back[2]).toBeCloseTo(-1, 4);
  });

  it("round-trips base64 little-endian PCM", () => {
    const samples = new Int16Array([0, 1, -1, 12345, -12345, 32767, -32768]);
    expect(Array.from(base64ToInt16(int16ToBase64(samples)))).toEqual(Array.from(samples));
    // Known bytes: 0x0100 little-endian = 1, 0xFFFF = -1.
    expect(Array.from(base64ToInt16(btoa(String.fromCharCode(1, 0, 255, 255))))).toEqual([1, -1]);
    expect(base64ToInt16(btoa("abc")).length).toBe(1); // odd trailing byte dropped
  });

  it("computes RMS and normalises it into 0..1", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
    expect(rmsInt16(new Int16Array([16384, -16384]))).toBeCloseTo(0.5, 3);
    expect(normalizeLevel(0.01)).toBeCloseTo(0.032, 5);
    expect(normalizeLevel(5)).toBe(1);
    expect(normalizeLevel(-1)).toBe(0);
  });

  it("resamples linearly and is a no-op at equal rates", () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
    const down = resampleLinear(input, 48000, 16000);
    expect(Array.from(down)).toEqual([0, 3]);
    expect(resampleLinear(new Float32Array([0, 2]), 8000, 16000).length).toBe(4);
  });

  it("reads the sample rate from a mime type", () => {
    expect(rateFromMime("audio/pcm;rate=24000")).toBe(24000);
    expect(rateFromMime("audio/pcm;rate=16000")).toBe(16000);
    expect(rateFromMime("audio/pcm")).toBe(24000);
    expect(rateFromMime(undefined, 1)).toBe(1);
  });
});

describe("level store", () => {
  it("attacks fast, releases slowly, and clamps", () => {
    const store = createLevelStore(0.5, 0.1);
    store.setOutput(1);
    expect(store.getOutput()).toBeCloseTo(0.5, 6);
    store.setOutput(0);
    expect(store.getOutput()).toBeCloseTo(0.45, 6);
    store.setInput(7);
    expect(store.getInput()).toBeCloseTo(0.5, 6);
    store.setInput(Number.NaN);
    expect(store.getInput()).toBeLessThan(0.5);
    store.reset();
    expect(store.getInput()).toBe(0);
    expect(store.getOutput()).toBe(0);
  });
});

describe("live protocol parsing", () => {
  it("parses setup, audio, transcripts and turn events in order", () => {
    const audio = btoa(String.fromCharCode(1, 0, 2, 0));
    const events = parseServerMessage({
      setupComplete: {},
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: audio, mimeType: "audio/pcm;rate=24000" } }] },
        inputTranscription: { text: "hi" },
        outputTranscription: { text: "hello" },
        turnComplete: true,
      },
    });
    expect(events.map((e) => e.type)).toEqual([
      "setup_complete",
      "audio",
      "input_transcript",
      "output_transcript",
      "turn_complete",
    ]);
    const audioEvent = events[1];
    expect(audioEvent.type === "audio" && Array.from(audioEvent.pcm)).toEqual([1, 2]);
  });

  it("emits interrupted before audio and parses tool calls, cancellation, goAway, resumption", () => {
    expect(parseServerMessage({ serverContent: { interrupted: true } })).toEqual([{ type: "interrupted" }]);
    const [call] = parseServerMessage({
      toolCall: { functionCalls: [{ id: "a", name: "get_metric", args: { metric: "sales" } }, { name: "get_alerts" }] },
    });
    expect(call).toEqual({
      type: "tool_call",
      calls: [
        { id: "a", name: "get_metric", args: { metric: "sales" } },
        { id: "call-1", name: "get_alerts", args: {} },
      ],
    });
    expect(parseServerMessage({ toolCallCancellation: { ids: ["a"] } })).toEqual([{ type: "tool_cancel", ids: ["a"] }]);
    expect(parseServerMessage({ goAway: { timeLeft: "30s" } })).toEqual([{ type: "go_away", timeLeftMs: 30000 }]);
    expect(parseServerMessage({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } })).toEqual([
      { type: "resumption", handle: "h1" },
    ]);
    expect(parseServerMessage({ sessionResumptionUpdate: { newHandle: "h1", resumable: false } })).toEqual([]);
    expect(parseServerMessage({})).toEqual([]);
  });

  it("parses durations", () => {
    expect(parseDuration("1.5s")).toBe(1500);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });

  it("builds setup and tool-response messages", () => {
    expect(buildSetupMessage("gemini-3.8-live")).toMatchObject({ setup: { model: "models/gemini-3.8-live" } });
    expect(buildSetupMessage("models/x", "h")).toMatchObject({
      setup: { model: "models/x", sessionResumption: { handle: "h" } },
    });
    expect(
      buildToolResponseMessage([
        { id: "a", name: "get_metric", response: { output: { x: 1 } }, scheduling: "INTERRUPT" },
      ]),
    ).toEqual({
      toolResponse: {
        functionResponses: [
          { id: "a", name: "get_metric", response: { output: { x: 1 } }, scheduling: "INTERRUPT" },
        ],
      },
    });
  });
});

describe("capabilities and tool bridge", () => {
  const ok = {
    isSecureContext: true,
    hasMediaDevices: true,
    hasWebSocket: true,
    hasAudioContext: true,
    hasAudioWorklet: true,
  };
  it("detects each missing capability with a reason", () => {
    expect(evaluateCapabilities(ok)).toEqual({ supported: true, reason: null });
    expect(evaluateCapabilities({ ...ok, isSecureContext: false }).supported).toBe(false);
    expect(evaluateCapabilities({ ...ok, hasMediaDevices: false }).reason).toMatch(/microphone/);
    expect(evaluateCapabilities({ ...ok, hasWebSocket: false }).supported).toBe(false);
    expect(evaluateCapabilities({ ...ok, hasAudioWorklet: false }).reason).toMatch(/audio/);
  });

  it("targets the assistant tools endpoint through the same-origin proxy", () => {
    expect(toolUrl("get_metric")).toBe("/qc-api/v1/assistant/tools/get_metric");
    expect(toolUrl("a b")).toBe("/qc-api/v1/assistant/tools/a%20b");
  });
});
