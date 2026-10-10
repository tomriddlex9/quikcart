/** Browser SpeechRecognition helpers for Grok voice (STT → agent → TTS). */

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionResultEventLike = {
  resultIndex?: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

export function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserSupportsGrokVoice(): { ok: boolean; reason: string | null } {
  if (typeof window === "undefined") {
    return { ok: false, reason: "Voice runs in the browser." };
  }
  if (window.isSecureContext === false) {
    return { ok: false, reason: "Voice needs a secure (https or localhost) page." };
  }
  if (!getSpeechRecognitionCtor()) {
    return {
      ok: false,
      reason: "This browser does not support speech recognition for Grok voice.",
    };
  }
  return { ok: true, reason: null };
}

export function speakWithBrowserTts(text: string, onEnd?: () => void): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  const clean = text.trim();
  if (!clean) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1.05;
  utter.onend = () => onEnd?.();
  utter.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utter);
}
