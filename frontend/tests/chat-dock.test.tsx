import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonaBot } from "@/components/assistant/chat-dock/persona-bot";
import { botStyleFor, botsForSide, ALL_BOTS } from "@/components/assistant/chat-dock/bot-catalog";
import { emotionFromVoicePhase, getChatSessionSnapshot, chatActions } from "@/lib/assistant/chat-session";

vi.mock("@/lib/voice/use-voice-session", () => ({
  useVoiceSession: () => ({
    availability: "unavailable",
    unsupportedReason: null,
    mode: "off",
    provider: null,
    persistent: false,
    statusDetail: "Voice off",
    state: {
      phase: "off",
      muted: false,
      error: null,
      notice: null,
      caption: { user: "", assistant: "" },
      elapsedSeconds: 0,
    },
    active: false,
    maxSeconds: 600,
    orbState: "idle",
    getLevel: () => 0,
    getOutputLevel: () => 0,
    canSend: false,
    start: vi.fn(),
    stop: vi.fn(),
    pttDown: vi.fn(),
    pttUp: vi.fn(),
    sendNow: vi.fn(),
    toggleListen: vi.fn(),
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  chatActions.clear();
});

describe("bot catalog", () => {
  it("maps each business persona to a distinct shape", () => {
    const shapes = [
      "business_exec",
      "city_manager",
      "store_manager",
      "category_manager",
      "leadership",
    ].map((p) => botStyleFor(p).shape);
    expect(new Set(shapes).size).toBe(5);
  });

  it("falls back to exec for unknown persona", () => {
    expect(botStyleFor("nope").id).toBe("business_exec");
  });
});

describe("emotionFromVoicePhase", () => {
  it("maps voice phases to bot emotions", () => {
    expect(emotionFromVoicePhase("listening", false)).toBe("listen");
    expect(emotionFromVoicePhase("thinking", false)).toBe("think");
    expect(emotionFromVoicePhase("speaking", false)).toBe("speak");
    expect(emotionFromVoicePhase("error", false)).toBe("error");
    expect(emotionFromVoicePhase("off", false)).toBe("idle");
  });
});

describe("PersonaBot", () => {
  it("renders bible-strong avatar for store manager with data attributes", () => {
    const { container } = render(
      <PersonaBot persona="store_manager" emotion="think" size={64} />,
    );
    const root = container.querySelector("[data-bot]");
    expect(root?.getAttribute("data-bot")).toBe("store_manager");
    expect(root?.getAttribute("data-emotion")).toBe("think");
    expect(container.querySelector(".bs-avatar, svg, [class*='bs-avatar']")).toBeTruthy();
  });
});

describe("chat session", () => {
  it("persists session id across clear+new and tracks open state", () => {
    const before = getChatSessionSnapshot().sessionId;
    expect(before).toBeTruthy();
    chatActions.setOpen(true);
    expect(getChatSessionSnapshot().open).toBe(true);
    chatActions.clear();
    expect(getChatSessionSnapshot().messages).toEqual([]);
    expect(getChatSessionSnapshot().sessionId).not.toBe(before);
  });

  it("clearChat keeps session id; newChat rotates it", () => {
    const before = getChatSessionSnapshot().sessionId;
    chatActions.clearChat();
    expect(getChatSessionSnapshot().sessionId).toBe(before);
    chatActions.newChat();
    expect(getChatSessionSnapshot().sessionId).not.toBe(before);
  });

  it("switches bot personality", () => {
    chatActions.setBotId("store_manager");
    expect(getChatSessionSnapshot().botId).toBe("store_manager");
    expect(botStyleFor(getChatSessionSnapshot().botId).displayName).toBe("Priya");
  });
});

describe("bot catalog personalities", () => {
  it("exposes distinct bright colors and blurbs per side", () => {
    expect(botsForSide("business").length).toBeGreaterThanOrEqual(4);
    expect(botsForSide("ops").length).toBeGreaterThanOrEqual(2);
    const fills = new Set(ALL_BOTS.map((b) => b.fill));
    expect(fills.size).toBe(ALL_BOTS.length);
    for (const bot of ALL_BOTS) {
      expect(bot.personality.length).toBeGreaterThan(8);
      expect(bot.businessPersona).toBeTruthy();
      // Bodies should be mid/bright — not near-black fills.
      const hex = bot.fill.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      expect(r + g + b).toBeGreaterThan(120);
    }
  });
});
