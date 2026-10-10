/**
 * Persistent Grok voice: continuous STT → agent chat → TTS → listen again.
 * Mic is paused while the assistant thinks/speaks so it does not hear itself.
 */

import { chatActions, getChatSessionSnapshot } from "@/lib/assistant/chat-session";
import {
  getSpeechRecognitionCtor,
  speakWithBrowserTts,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultEventLike,
} from "@/lib/voice/grok-speech";

export type GrokVoiceStatus =
  | "connecting"
  | "listening"
  | "heard"
  | "thinking"
  | "speaking"
  | "paused"
  | "error";

export type GrokVoiceHandlers = {
  onStatus: (status: GrokVoiceStatus, detail: string) => void;
  onUserText: (text: string) => void;
  onAssistantText: (text: string) => void;
  onLevel: (level: number) => void;
  onError: (message: string) => void;
};

const COMMIT_MS = 900;
const RESTART_MS = 220;

export class GrokVoiceController {
  private recognition: SpeechRecognitionLike | null = null;
  private handlers: GrokVoiceHandlers;
  private running = false;
  private paused = false;
  private busy = false;
  private finals = "";
  private interim = "";
  private resultCursor = 0;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private mutedTts = false;

  constructor(handlers: GrokVoiceHandlers) {
    this.handlers = handlers;
  }

  get isRunning() {
    return this.running;
  }

  get isPaused() {
    return this.paused;
  }

  start() {
    if (this.running) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.handlers.onError("Speech recognition is unavailable in this browser (try Chrome).");
      return;
    }
    this.running = true;
    this.paused = false;
    this.busy = false;
    this.resetBuffers();
    this.handlers.onStatus("listening", "Listening — speak anytime");
    this.beginRecognition(Ctor);
  }

  stop() {
    this.running = false;
    this.clearTimers();
    this.stopRecognition(true);
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    this.handlers.onLevel(0);
  }

  /** Send the current transcript immediately (does nothing if empty / busy). */
  sendNow() {
    if (!this.running || this.busy) return;
    const pending = this.pendingText();
    if (!pending) {
      this.handlers.onStatus(
        this.paused ? "paused" : "listening",
        "Nothing to send yet — say something first",
      );
      return;
    }
    this.clearCommit();
    void this.commitUtterance(pending);
  }

  /** Pause or resume the open mic (does not send). */
  toggleListen() {
    if (!this.running) return;
    if (this.busy) {
      this.bargeIn();
      return;
    }
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean) {
    if (!this.running || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.clearCommit();
      this.stopRecognition(true);
      this.handlers.onLevel(0);
      this.handlers.onStatus("paused", "Mic paused — press Listen to continue");
    } else if (!this.busy) {
      this.handlers.onStatus("listening", "Listening — speak anytime");
      this.resumeListening();
    }
  }

  /** Space shortcut: send if there is text, otherwise toggle listen; interrupt if busy. */
  handleSpace() {
    if (!this.running) return;
    if (this.busy) {
      this.bargeIn();
      return;
    }
    if (this.pendingText()) {
      this.sendNow();
      return;
    }
    this.toggleListen();
  }

  setTtsMuted(muted: boolean) {
    this.mutedTts = muted;
    if (muted && typeof window !== "undefined") window.speechSynthesis?.cancel();
  }

  bargeIn() {
    if (!this.running) return;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    this.busy = false;
    this.paused = false;
    this.resetBuffers();
    this.handlers.onStatus("listening", "Listening — speak anytime");
    this.resumeListening();
  }

  private pendingText() {
    return [this.finals, this.interim].filter(Boolean).join(" ").trim();
  }

  private resetBuffers() {
    this.finals = "";
    this.interim = "";
    this.resultCursor = 0;
  }

  private beginRecognition(Ctor: new () => SpeechRecognitionLike) {
    this.stopRecognition(true);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";

    recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
      if (!this.running || this.paused || this.busy) return;
      const start = typeof event.resultIndex === "number" ? event.resultIndex : this.resultCursor;
      let gotFinal = false;
      for (let i = start; i < event.results.length; i += 1) {
        const row = event.results[i];
        const piece = (row?.[0]?.transcript ?? "").trim();
        if (!piece) continue;
        if (row.isFinal) {
          this.finals = `${this.finals} ${piece}`.replace(/\s+/g, " ").trim();
          gotFinal = true;
        } else {
          this.interim = piece;
        }
      }
      this.resultCursor = event.results.length;
      // Rebuild interim from non-final tails when API replaces them.
      let liveInterim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        if (!event.results[i].isFinal) {
          liveInterim += `${event.results[i]?.[0]?.transcript ?? ""} `;
        }
      }
      this.interim = liveInterim.trim();

      const shown = this.pendingText();
      if (shown) {
        this.handlers.onUserText(shown);
        this.handlers.onStatus("heard", gotFinal ? "Got it — sending soon…" : "Hearing you…");
      }
      this.handlers.onLevel(0.35 + Math.min(0.5, shown.length / 60));
      if (gotFinal) this.scheduleCommit();
    };

    recognition.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "aborted" || code === "no-speech") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.running = false;
        this.handlers.onError("Microphone access was blocked. Allow it and try again.");
        return;
      }
      if (this.running && !this.paused && !this.busy) this.scheduleRestart();
    };

    recognition.onend = () => {
      this.recognition = null;
      this.handlers.onLevel(0);
      if (!this.running || this.paused || this.busy) return;
      this.scheduleRestart();
    };

    this.recognition = recognition;
    try {
      recognition.start();
      if (!this.busy && !this.paused) {
        this.handlers.onStatus("listening", "Listening — speak anytime");
      }
    } catch {
      this.scheduleRestart();
    }
  }

  private scheduleRestart() {
    if (!this.running || this.paused || this.busy) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.running || this.paused || this.busy) return;
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;
      this.beginRecognition(Ctor);
    }, RESTART_MS);
  }

  private scheduleCommit() {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      const text = this.finals.trim();
      if (text) void this.commitUtterance(text);
    }, COMMIT_MS);
  }

  private clearCommit() {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = null;
  }

  private clearTimers() {
    this.clearCommit();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private stopRecognition(abort: boolean) {
    const rec = this.recognition;
    this.recognition = null;
    if (!rec) return;
    try {
      if (abort) rec.abort();
      else rec.stop();
    } catch {
      /* already stopped */
    }
  }

  private resumeListening() {
    if (!this.running || this.paused || this.busy) return;
    this.resetBuffers();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    this.beginRecognition(Ctor);
  }

  private async commitUtterance(message: string) {
    const text = message.trim();
    if (!text || !this.running || this.busy) return;

    this.busy = true;
    this.clearCommit();
    this.stopRecognition(true);
    this.resetBuffers();
    this.handlers.onUserText(text);
    this.handlers.onStatus("thinking", "Thinking…");
    this.handlers.onLevel(0);

    try {
      const waitStart = Date.now();
      while (getChatSessionSnapshot().busy && Date.now() - waitStart < 90_000) {
        this.handlers.onStatus("thinking", "Waiting for previous answer…");
        await new Promise((r) => setTimeout(r, 150));
      }

      this.handlers.onStatus("thinking", "Asking Grok…");
      const progress = setInterval(() => {
        const detail = getChatSessionSnapshot().stageDetail;
        if (detail) this.handlers.onStatus("thinking", detail);
      }, 200);
      let answer: string | null = null;
      try {
        answer = await chatActions.send(text, { skipTts: true });
      } finally {
        clearInterval(progress);
      }
      if (!this.running) return;

      if (!answer) {
        this.handlers.onAssistantText("I couldn't get an answer. Try asking again.");
        this.handlers.onStatus("error", "No answer — try again");
        return;
      }

      this.handlers.onAssistantText(answer);
      if (!this.mutedTts) {
        this.handlers.onStatus("speaking", "Speaking…");
        await new Promise<void>((resolve) => {
          speakWithBrowserTts(answer, () => resolve());
        });
      }
    } catch (error) {
      this.handlers.onError(error instanceof Error ? error.message : "Voice turn failed.");
    } finally {
      this.busy = false;
      if (this.running && !this.paused) {
        this.handlers.onStatus("listening", "Listening — speak anytime");
        this.resumeListening();
      } else if (this.running && this.paused) {
        this.handlers.onStatus("paused", "Paused — press Space to listen");
      }
    }
  }
}
