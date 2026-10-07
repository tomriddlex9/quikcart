import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  initialVoiceState,
  orbStateFor,
  voiceReducer,
  type VoiceAction,
  type VoiceState,
} from "@/lib/voice/voice-machine";

const run = (actions: VoiceAction[], from: VoiceState = initialVoiceState) =>
  actions.reduce(voiceReducer, from);

const ready = () => run([{ type: "start" }, { type: "connected", sessionId: "s1" }]);

describe("voiceReducer lifecycle", () => {
  it("connects: off → connecting → ready", () => {
    const connecting = run([{ type: "start" }]);
    expect(connecting.phase).toBe("connecting");
    expect(ready()).toMatchObject({ phase: "ready", sessionId: "s1" });
  });

  it("ignores events that do not apply to the current phase", () => {
    expect(run([{ type: "mic_down" }]).phase).toBe("off");
    expect(run([{ type: "start" }, { type: "mic_down" }]).phase).toBe("connecting");
    expect(run([{ type: "connected" }]).phase).toBe("off");
    expect(run([{ type: "audio" }]).phase).toBe("off");
  });

  it("push-to-talk: ready → listening → thinking", () => {
    expect(run([{ type: "mic_down" }], ready()).phase).toBe("listening");
    expect(run([{ type: "mic_down" }, { type: "mic_up" }], ready()).phase).toBe("thinking");
    expect(run([{ type: "mic_up" }], ready()).phase).toBe("ready");
  });

  it("speaks, then returns to ready only after the player drains and the turn is done", () => {
    const speaking = run([{ type: "mic_down" }, { type: "mic_up" }, { type: "audio" }], ready());
    expect(speaking).toMatchObject({ phase: "speaking", playing: true });
    const turnDone = voiceReducer(speaking, { type: "turn_complete" });
    expect(turnDone.phase).toBe("speaking"); // audio still queued
    expect(voiceReducer(turnDone, { type: "playback_drained" }).phase).toBe("ready");
    // Drain between chunks (turn not finished) keeps speaking.
    const gap = voiceReducer(speaking, { type: "playback_drained" });
    expect(gap.phase).toBe("speaking");
    expect(voiceReducer(gap, { type: "turn_complete" }).phase).toBe("ready");
  });

  it("repeated audio chunks do not produce new state objects", () => {
    const speaking = run([{ type: "audio" }], ready());
    expect(voiceReducer(speaking, { type: "audio" })).toBe(speaking);
  });

  it("barge-in: pressing talk while speaking stops playback and listens", () => {
    const speaking = run([{ type: "audio" }], ready());
    const barged = voiceReducer(speaking, { type: "mic_down" });
    expect(barged).toMatchObject({ phase: "listening", playing: false });
    // Late audio chunks while the user holds the button do not steal the floor.
    expect(voiceReducer(barged, { type: "audio" }).phase).toBe("listening");
  });

  it("interrupted clears playback and returns to ready (or stays listening)", () => {
    const speaking = run([{ type: "audio" }], ready());
    expect(voiceReducer(speaking, { type: "interrupted" })).toMatchObject({
      phase: "ready",
      playing: false,
    });
    const listening = run([{ type: "mic_down" }], ready());
    expect(voiceReducer(listening, { type: "interrupted" }).phase).toBe("listening");
  });

  it("tool calls show thinking until the turn completes", () => {
    const working = run([{ type: "tool_start" }], ready());
    expect(working).toMatchObject({ phase: "thinking", pendingTools: 1 });
    const done = voiceReducer(working, { type: "tool_end" });
    expect(done.pendingTools).toBe(0);
    expect(voiceReducer(done, { type: "turn_complete" }).phase).toBe("ready");
    expect(voiceReducer(initialVoiceState, { type: "tool_end" }).pendingTools).toBe(0);
  });

  it("errors are recoverable with start; stop and closed reset", () => {
    const failed = run([{ type: "start" }, { type: "error", message: "boom" }]);
    expect(failed).toMatchObject({ phase: "error", error: "boom" });
    expect(voiceReducer(failed, { type: "start" })).toMatchObject({ phase: "connecting", error: null });
    expect(run([{ type: "stop" }], ready()).phase).toBe("off");
    const closed = run([{ type: "closed", notice: "limit" }], ready());
    expect(closed).toMatchObject({ phase: "off", notice: "limit" });
  });

  it("start is a no-op while a session is active; mute survives a restart", () => {
    const active = ready();
    expect(voiceReducer(active, { type: "start" })).toBe(active);
    const muted = run([{ type: "toggle_mute" }, { type: "stop" }], active);
    expect(muted.muted).toBe(true);
    expect(voiceReducer(muted, { type: "start" }).muted).toBe(true);
  });

  it("ticks update the clock only during a session", () => {
    expect(run([{ type: "tick", elapsedSeconds: 5 }]).elapsedSeconds).toBe(0);
    expect(run([{ type: "tick", elapsedSeconds: 5 }], ready()).elapsedSeconds).toBe(5);
  });
});

describe("captions", () => {
  it("accumulates a turn and starts fresh lines for the next one", () => {
    let s = ready();
    s = run(
      [
        { type: "input_transcript", text: "how are " },
        { type: "input_transcript", text: "sales" },
        { type: "output_transcript", text: "Sales are " },
        { type: "output_transcript", text: "up." },
      ],
      s,
    );
    expect(s.caption).toEqual({ user: "how are sales", assistant: "Sales are up." });
    s = run([{ type: "turn_complete" }, { type: "input_transcript", text: "and orders" }], s);
    expect(s.caption).toEqual({ user: "and orders", assistant: "" });
    s = run([{ type: "output_transcript", text: "Orders are flat." }], s);
    expect(s.caption.assistant).toBe("Orders are flat.");
  });
});

describe("orb mapping and clock format", () => {
  it("maps phases to orb states", () => {
    expect(orbStateFor("connecting")).toBe("thinking");
    expect(orbStateFor("thinking")).toBe("thinking");
    expect(orbStateFor("listening")).toBe("listening");
    expect(orbStateFor("speaking")).toBe("speaking");
    expect(orbStateFor("ready")).toBe("idle");
    expect(orbStateFor("off")).toBe("idle");
    expect(orbStateFor("error")).toBe("idle");
  });

  it("formats elapsed time as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65.9)).toBe("1:05");
    expect(formatElapsed(600)).toBe("10:00");
    expect(formatElapsed(-3)).toBe("0:00");
  });
});
