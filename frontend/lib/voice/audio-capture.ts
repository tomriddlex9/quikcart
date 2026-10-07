"use client";

// Microphone → 16 kHz Int16 frames via an AudioWorklet. Frames are only forwarded while
// `setActive(true)` (push-to-talk), but the mic stream stays open for instant response.

import { normalizeLevel } from "@/lib/voice/pcm";

export const WORKLET_URL = "/worklets/pcm-capture.js";

export interface AudioCapture {
  /** Forward (true) or drop (false) frames — push-to-talk gate. */
  setActive: (active: boolean) => void;
  stop: () => Promise<void>;
}

export interface AudioCaptureOptions {
  onFrame: (pcm: Int16Array) => void;
  /** Called for every frame, active or not, with a 0..1 level (use refs, not state). */
  onLevel?: (level: number) => void;
}

type AudioContextCtor = typeof AudioContext;

export async function startAudioCapture(options: AudioCaptureOptions): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctor: AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  const context = new Ctor({ latencyHint: "interactive" });
  try {
    await context.audioWorklet.addModule(WORKLET_URL);
    if (context.state === "suspended") await context.resume();
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    await context.close().catch(() => undefined);
    throw error;
  }

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
  let active = false;
  node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    options.onLevel?.(active ? normalizeLevel(event.data.rms) : 0);
    if (active) options.onFrame(new Int16Array(event.data.pcm));
  };
  source.connect(node);

  return {
    setActive: (next) => {
      active = next;
      if (!next) options.onLevel?.(0);
    },
    stop: async () => {
      active = false;
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await context.close().catch(() => undefined);
    },
  };
}
