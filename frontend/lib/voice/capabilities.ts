// Feature detection so the dock can degrade to a plain explanation (and the text assistant).

export interface VoiceCapabilities {
  supported: boolean;
  /** Human-readable reason when unsupported. */
  reason: string | null;
}

export interface CapabilityEnv {
  isSecureContext?: boolean;
  hasMediaDevices: boolean;
  hasWebSocket: boolean;
  hasAudioContext: boolean;
  hasAudioWorklet: boolean;
}

export function evaluateCapabilities(env: CapabilityEnv): VoiceCapabilities {
  if (env.isSecureContext === false) {
    return { supported: false, reason: "Voice needs a secure (https or localhost) page." };
  }
  if (!env.hasMediaDevices) return { supported: false, reason: "This browser cannot use a microphone." };
  if (!env.hasWebSocket) return { supported: false, reason: "This browser does not support live connections." };
  if (!env.hasAudioContext || !env.hasAudioWorklet) {
    return { supported: false, reason: "This browser cannot process live audio." };
  }
  return { supported: true, reason: null };
}

export function detectCapabilities(): VoiceCapabilities {
  if (typeof window === "undefined") return { supported: false, reason: "Voice runs in the browser." };
  const w = window as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
    AudioWorkletNode?: unknown;
  };
  return evaluateCapabilities({
    isSecureContext: window.isSecureContext,
    hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
    hasWebSocket: typeof WebSocket !== "undefined",
    hasAudioContext: !!(w.AudioContext ?? w.webkitAudioContext),
    hasAudioWorklet: !!w.AudioWorkletNode,
  });
}
